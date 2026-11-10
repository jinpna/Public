"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const crypto_1 = __importDefault(require("crypto"));
const db_1 = require("../db");
const ws_1 = require("../ws");
const dispatcher_1 = require("../dispatcher");
const paths_1 = require("../paths");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const child_process_1 = require("child_process");
const {inspectGeneration}=require('../generationGuard');
const router = (0, express_1.Router)();
router.use((req,res,next)=>{if(req.method==='POST'&&['/preflight','/enqueue'].includes(req.path)){try{req.body=require('../videoReferences.cjs').normalizeVideoBody(req.body||{})}catch(e){return res.status(422).json({error:e.message,errors:[e.message]})}}next()});
router.post('/preflight',(req,res)=>{try{res.json(inspectGeneration(req.body||{}))}catch(e){res.status(422).json({error:'Không kiểm tra được đầu vào: '+e.message})}});
function generateTaskId() {
    return `task_${crypto_1.default.randomBytes(4).toString('hex')}`;
}
db_1.db.exec('CREATE TABLE IF NOT EXISTS job_context (job_id TEXT PRIMARY KEY, payload TEXT NOT NULL)');
router.get('/context/:id',(req,res)=>{const row=db_1.db.prepare('SELECT payload FROM job_context WHERE job_id=?').get(req.params.id);if(!row)return res.status(404).json({error:'Không có bản lưu nguồn của tác vụ cũ'});res.json(JSON.parse(row.payload))});
// POST /api/queue/enqueue - create jobs
router.post('/enqueue', (req, res) => {
    try {
        const guard=inspectGeneration(req.body||{});if(!guard.valid)return res.status(422).json({error:guard.errors.join('\n'),errors:guard.errors});
        let { prompts, duration, ratio, refTags, batchRefImage } = req.body;
        const mediaType = req.body.mediaType === "image" ? "image" : "video";
        // Handle single string with multiple lines or array
        let promptList = [];
        if (Array.isArray(prompts)) {
            promptList = prompts.map((p) => String(p).trim()).filter((p) => p.length > 0);
        }
        else if (typeof prompts === 'string') {
            promptList = prompts
                .split('\n')
                .map((p) => p.trim())
                .filter((p) => p.length > 0);
        }
        if (promptList.length === 0) {
            return res.status(400).json({ error: 'Danh sách câu lệnh (prompts) không được để trống' });
        }
        const durationNum = Number(duration) || 10;
        const ratioStr = (ratio || '9:16').trim();
        let tags = [];
        if (Array.isArray(refTags)) {
            tags = refTags.map((t) => String(t).trim()).filter(Boolean);
        }
        else if (batchRefImage) {
            tags = [String(batchRefImage).trim()];
        }
        // Get settings for retries and timeout
        const retrySetting = db_1.db.prepare(`SELECT value FROM settings WHERE key = 'retry_count'`).get();
        const timeoutSetting = db_1.db.prepare(`SELECT value FROM settings WHERE key = 'timeout_minutes'`).get();
        const autoRunSetting = db_1.db.prepare(`SELECT value FROM settings WHERE key = 'paste_auto_run'`).get();
        const maxRetries = mediaType === "image" ? 0 : Math.max(0,parseInt(retrySetting?.value||"0",10)||0);
        const timeoutMinutes = mediaType === "image" ? 1 : timeoutSetting ? parseInt(timeoutSetting.value, 10) : 15;
        const autoRun = false; // Explicit process request starts new batches.
        const batchId = `batch_${crypto_1.default.randomBytes(4).toString('hex')}`;
        const createdJobs = [];
        const insertJobStmt = db_1.db.prepare(`
      INSERT INTO jobs (
        id, prompt, ref_tags, media_type, status, progress, duration, ratio,
        attempts, max_retries, timeout_minutes, batch_id, sort_order, created_at
      ) VALUES (?, ?, ?, ?, 'pending', 0, ?, ?, 0, ?, ?, ?, ?, datetime('now'))
    `);
        const enqueueTransaction = db_1.db.transaction(() => {
            promptList.forEach((promptText, index) => {
                const taskId = generateTaskId();
                insertJobStmt.run(taskId, promptText, JSON.stringify(tags), mediaType, durationNum, ratioStr, maxRetries, timeoutMinutes, batchId, index);
                if(req.body.clientContext&&typeof req.body.clientContext==='object'){const c=req.body.clientContext;db_1.db.prepare('INSERT INTO job_context(job_id,payload) VALUES (?,?)').run(taskId,JSON.stringify({annotation:c.annotation&&typeof c.annotation==='object'?{sourceTag:String(c.annotation.sourceTag||'').slice(0,200),guideTag:String(c.annotation.guideTag||'').slice(0,200),notes:String(c.annotation.notes||'').slice(0,5000)}:undefined,prompt:String(c.prompt||promptText).slice(0,20000),ratio:ratioStr,duration:durationNum,mode:String(c.mode||mediaType).slice(0,40),references:Array.isArray(c.references)?c.references.slice(0,10).map(r=>({tag:String(r.tag||'').slice(0,200),url:/^\/(uploads|videos)\/[^/]+$/.test(r.url||'')?r.url:undefined})):[]}))}
                createdJobs.push({
                    id: taskId,
                    media_type: mediaType,
                    prompt: promptText,
                    ref_tags: JSON.stringify(tags),
                    status: 'pending',
                    progress: 0,
                    duration: durationNum,
                    ratio: ratioStr,
                    account_id: null,
                    attempts: 0,
                    max_retries: maxRetries,
                    timeout_minutes: timeoutMinutes,
                    created_at: new Date().toISOString(),
                    started_at: null,
                    finished_at: null,
                    elapsed_sec: 0,
                    video_url: null,
                    thumbnail_url: null,
                    error: null,
                    batch_id: batchId,
                    sort_order: index
                });
            });
        });
        enqueueTransaction();
        (0, ws_1.broadcast)('QUEUE_ENQUEUED', {
            batchId,
            count: createdJobs.length,
            jobs: createdJobs
        });
        // Auto-run if enabled or trigger dispatcher
        if (autoRun) {
            if (!dispatcher_1.dispatcher.isRunning()) {
                dispatcher_1.dispatcher.start(ws_1.broadcast);
            }
            else {
                dispatcher_1.dispatcher.trigger();
            }
        }
        return res.status(201).json({
            success: true,
            message: `Đã thêm thành công ${createdJobs.length} tác vụ vào hàng đợi`,
            batch_id: batchId,
            count: createdJobs.length,
            jobs: createdJobs
        });
    }
    catch (error) {
        console.error('Error enqueueing jobs:', error);
        return res.status(500).json({ error: 'Đã xảy ra lỗi khi tạo tác vụ vào hàng đợi' });
    }
});
// GET /api/queue/jobs - list jobs with filtering, search, pagination
router.post('/image/archive/:id', (req, res) => {
    const job = db_1.db.prepare("SELECT * FROM jobs WHERE id = ? AND media_type = 'image'").get(req.params.id);
    if (!job) return res.status(404).json({error:'Không tìm thấy kết quả ảnh'});
    if (['running','pending'].includes(job.status)) return res.status(409).json({error:'Dừng tác vụ trước khi xóa'});
    db_1.db.prepare("UPDATE jobs SET archived_at = COALESCE(archived_at, datetime('now')) WHERE id = ?").run(job.id);
    return res.json({success:true});
});
router.post('/image/restore/:id', (req, res) => {
    require('../imageTrashRuntime.cjs').clean({expiredOnly:true});
    const result = db_1.db.prepare("UPDATE jobs SET archived_at = NULL WHERE id = ? AND media_type = 'image'").run(req.params.id);
    return result.changes ? res.json({success:true}) : res.status(404).json({error:'Không tìm thấy kết quả ảnh'});
});
// Stop only selected video tasks. Image jobs and the dispatcher itself keep running.
router.post('/video/stop',(req,res)=>{try{const ids=Array.isArray(req.body?.ids)?[...new Set(req.body.ids.filter(id=>typeof id==='string'))].slice(0,5000):[];if(!ids.length)return res.status(400).json({error:'Chọn video đang chờ hoặc đang chạy'});let stopped=0;for(const id of ids){const job=db_1.db.prepare("SELECT id,status FROM jobs WHERE id=? AND media_type='video' AND archived_at IS NULL").get(id);if(!job||!['pending','running'].includes(job.status))continue;if(job.status==='running')dispatcher_1.dispatcher.stopJob(id);else db_1.db.prepare("UPDATE jobs SET status='stopped',finished_at=datetime('now') WHERE id=? AND status='pending'").run(id);stopped++}(0,ws_1.broadcast)('QUEUE_STATE',{counts:dispatcher_1.dispatcher.getQueueCounts()});res.json({success:true,stopped})}catch(error){res.status(500).json({error:'Không dừng được video: '+error.message})}});
router.post('/video/archive/:id', (req, res) => {
    const job = db_1.db.prepare("SELECT * FROM jobs WHERE id = ? AND media_type = 'video'").get(req.params.id);
    if (!job) return res.status(404).json({error:'Không tìm thấy kết quả video'});
    if (['running','pending'].includes(job.status)) return res.status(409).json({error:'Dừng tác vụ trước khi xóa'});
    db_1.db.prepare("UPDATE jobs SET archived_at = COALESCE(archived_at, datetime('now')) WHERE id = ?").run(job.id);
    return res.json({success:true});
});
router.post('/video/restore/:id', (req, res) => {
    const result = db_1.db.prepare("UPDATE jobs SET archived_at = NULL WHERE id = ? AND media_type = 'video'").run(req.params.id);
    return result.changes ? res.json({success:true}) : res.status(404).json({error:'Không tìm thấy kết quả video'});
});
router.post('/image/stop/:id', (req, res) => {
    const job = db_1.db.prepare('SELECT * FROM jobs WHERE id = ? AND media_type = ?').get(req.params.id, 'image');
    if (!job) return res.status(404).json({error:'Không tìm thấy tác vụ ảnh'});
    if (!['pending','running'].includes(job.status)) return res.status(409).json({error:'Tác vụ không còn chạy'});
    dispatcher_1.dispatcher.stopJob(job.id);
    return res.json({success:true});
});
router.get('/jobs', (req, res) => {
    try {
        const { status, search, page = '1', limit = '5000', batch_id } = req.query;
        const pageNum = Math.max(1, parseInt(String(page), 10) || 1);
        const limitNum = Math.min(5000, Math.max(1, parseInt(String(limit), 10) || 5000));
        const offset = (pageNum - 1) * limitNum;
        const conditions = ["media_type = ?"];
        const mediaType = req.query.media === "image" ? "image" : "video";
        const params = [mediaType];
        if (mediaType === "image") require('../imageTrashRuntime.cjs').clean({expiredOnly:true});
        conditions.push(req.query.archived === "1" ? "archived_at IS NOT NULL" : "archived_at IS NULL");
        if (status && status !== 'all') {
            conditions.push('status = ?');
            params.push(String(status));
        }
        if (batch_id) {
            conditions.push('batch_id = ?');
            params.push(String(batch_id));
        }
        if (search && String(search).trim()) {
            const keyword = `%${String(search).trim()}%`;
            conditions.push('(prompt LIKE ? OR id LIKE ?)');
            params.push(keyword, keyword);
        }
        if(mediaType==='image'&&['create','edit','design'].includes(String(req.query.workspace))){
 const workspace=String(req.query.workspace);
 const classification="CASE WHEN COALESCE((SELECT json_extract(payload,'$.mode') FROM job_context WHERE job_id=jobs.id),'')='design' OR prompt LIKE 'DESIGN TASK:%' THEN 'design' WHEN COALESCE((SELECT json_extract(payload,'$.mode') FROM job_context WHERE job_id=jobs.id),'') IN ('edit','replace','refine','inpaint') OR prompt LIKE '[MUSE EDIT PLAN]%' OR prompt LIKE 'Edit image %' OR prompt LIKE 'EDIT:%' THEN 'edit' ELSE 'create' END";
 conditions.push('('+classification+') = ?');params.push(workspace);
 }
 const whereClause = conditions.join(' AND ');
        // Total count
        const countRow = db_1.db.prepare(`SELECT count(*) as total FROM jobs WHERE ${whereClause}`).get(...params);
        const total = countRow ? countRow.total : 0;
        // Fetch items
        const query = `
      SELECT * FROM jobs
      WHERE ${whereClause}
      ORDER BY ${req.query.order === 'latest' ? 'created_at DESC, id DESC' : `
        CASE status 
          WHEN 'running' THEN 1 
          WHEN 'pending' THEN 2 
          WHEN 'failed' THEN 3 
          WHEN 'stopped' THEN 4 
          ELSE 5 
        END,
        sort_order ASC,
        created_at DESC`}
      LIMIT ? OFFSET ?
    `;
        const jobs = db_1.db.prepare(query).all(...params, limitNum, offset);
        const formatted = jobs.map((j) => {
            let parsedTags = [];
            try {
                parsedTags = JSON.parse(j.ref_tags || '[]');
            }
            catch {
                parsedTags = [];
            }
            return {
                ...j,
                tags: parsedTags
            };
        });
        return res.json({
            jobs: formatted,
            total,
            page: pageNum,
            limit: limitNum,
            totalPages: Math.ceil(total / limitNum)
        });
    }
    catch (error) {
        console.error('Error listing jobs:', error);
        return res.status(500).json({ error: 'Lỗi khi tải danh sách tác vụ trong hàng đợi' });
    }
});
// POST /api/queue/process - start the dispatcher
router.post('/process', (_req, res) => {
    try {
        dispatcher_1.dispatcher.start(ws_1.broadcast);
        dispatcher_1.dispatcher.trigger();
        return res.json({
            success: true,
            message: 'Đã bắt đầu xử lý hàng đợi tác vụ'
        });
    }
    catch (error) {
        console.error('Error starting queue process:', error);
        return res.status(500).json({ error: 'Không thể khởi động bộ xử lý hàng đợi' });
    }
});
// POST /api/queue/stop - stop all running jobs
router.post('/stop', (_req, res) => {
    try {
        dispatcher_1.dispatcher.stop();
        return res.json({
            success: true,
            message: 'Đã dừng tất cả tác vụ đang chạy'
        });
    }
    catch (error) {
        console.error('Error stopping queue:', error);
        return res.status(500).json({ error: 'Không thể dừng các tác vụ đang chạy' });
    }
});
// POST /api/queue/retry/:id - retry a failed/stopped job
router.post('/retry/:id', (req, res) => {
    try {
        if(String(req.params.id).startsWith('mag_'))return res.status(409).json({error:'Tác vụ Magnific không tự chạy lại. Dùng Kiểm tra kết quả Magnific hoặc tạo yêu cầu mới và xác nhận credit.'});
        const { id } = req.params;
        const job = db_1.db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
        if (!job) {
            return res.status(404).json({ error: 'Không tìm thấy tác vụ cần thử lại' });
        }
        const newPrompt = typeof req.body?.prompt === 'string' && req.body.prompt.trim() ? req.body.prompt.trim() : null;
        db_1.db.prepare(`
      UPDATE jobs
      SET status = 'pending',
          prompt = COALESCE(?, prompt),
          progress = 0,
          attempts = 0,
          elapsed_sec = 0,
          error = NULL,
          started_at = NULL,
          finished_at = NULL,
          account_id = NULL
      WHERE id = ?
    `).run(newPrompt, id);
        // Also update studio card if attached
        db_1.db.prepare(`UPDATE studio_cards SET status = 'idle', progress = 0 WHERE job_id = ?`).run(id);
        (0, ws_1.broadcast)('JOB_UPDATED', { jobId: id, status: 'pending', ...(newPrompt ? { prompt: newPrompt } : {}) });
        dispatcher_1.dispatcher.trigger();
        return res.json({
            success: true,
            message: newPrompt ? 'Đã cập nhật prompt mới và đưa tác vụ trở lại hàng đợi' : 'Đã đưa tác vụ trở lại hàng đợi để thử lại'
        });
    }
    catch (error) {
        console.error('Error retrying job:', error);
        return res.status(500).json({ error: 'Lỗi khi thử lại tác vụ' });
    }
});
// DELETE /api/queue/job/:id - delete a single job
router.delete('/job/:id', (req, res) => {
    try {
        const { id } = req.params;
        const job = db_1.db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
        if (!job) {
            return res.status(404).json({ error: 'Không tìm thấy tác vụ cần xóa' });
        }
        if (job.status === 'running') {
            dispatcher_1.dispatcher.stopJob(id);
        }
        db_1.db.prepare('DELETE FROM jobs WHERE id = ?').run(id);
        db_1.db.prepare(`UPDATE studio_cards SET job_id = NULL WHERE job_id = ?`).run(id);
        (0, ws_1.broadcast)('QUEUE_STATE', {
            counts: dispatcher_1.dispatcher.getQueueCounts(),
            deletedJobId: id
        });
        return res.json({
            success: true,
            message: 'Đã xóa tác vụ thành công'
        });
    }
    catch (error) {
        console.error('Error deleting job:', error);
        return res.status(500).json({ error: 'Lỗi khi xóa tác vụ' });
    }
});
function parseIds(body) {
    return Array.isArray(body?.ids) ? body.ids.map((x) => String(x)).filter(Boolean).slice(0, 5000) : [];
}
// POST /api/queue/delete-many { ids } - xóa nhiều job (job đang chạy được dừng trước)
router.post('/delete-many', (req, res) => {
    try {
        const ids = parseIds(req.body);
        if (ids.length === 0)
            return res.status(400).json({ error: 'Không có tác vụ nào để xóa' });
        let deleted = 0;
        for (const id of ids) {
            const job = db_1.db.prepare('SELECT status FROM jobs WHERE id = ?').get(id);
            if (!job)
                continue;
            if (job.status === 'running')
                dispatcher_1.dispatcher.stopJob(id);
            db_1.db.prepare('DELETE FROM jobs WHERE id = ?').run(id);
            db_1.db.prepare(`UPDATE studio_cards SET job_id = NULL WHERE job_id = ?`).run(id);
            deleted++;
        }
        (0, ws_1.broadcast)('QUEUE_STATE', { counts: dispatcher_1.dispatcher.getQueueCounts() });
        return res.json({ success: true, deleted, message: `Đã xóa ${deleted} tác vụ` });
    }
    catch (error) {
        console.error('Error deleting jobs:', error);
        return res.status(500).json({ error: 'Lỗi khi xóa các tác vụ' });
    }
});
// POST /api/queue/export { ids } - copy video đã xong vào 1 thư mục mới trong Downloads/Muse Videos rồi mở thư mục đó
router.post('/export', (req, res) => {
    try {
        const ids = parseIds(req.body);
        const jobs = ids
            .map((id) => db_1.db.prepare(`SELECT id, prompt, video_url FROM jobs WHERE id = ? AND status = 'completed' AND video_url IS NOT NULL`).get(id))
            .filter(Boolean);
        if (jobs.length === 0)
            return res.status(400).json({ error: 'Không có video đã hoàn thành nào trong danh sách' });
        const stamp = new Date().toLocaleString('sv-SE').replace(/[: ]/g, '-').slice(0, 16);
        const dir = path_1.default.join((0, dispatcher_1.getDownloadDir)(), `Tai-ve-${stamp}`);
        fs_1.default.mkdirSync(dir, { recursive: true });
        let copied = 0;
        for (const j of jobs) {
            const src = path_1.default.join(paths_1.DATA_DIR, j.video_url.replace(/^\//, ''));
            if (!fs_1.default.existsSync(src))
                continue;
            fs_1.default.copyFileSync(src, path_1.default.join(dir, `${j.id}_${(0, dispatcher_1.slugifyPrompt)(j.prompt)}.mp4`.replace(/_\.mp4$/, '.mp4')));
            copied++;
        }
        // Mở thư mục cho người dùng (app chạy trên chính máy họ)
        const opener = process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
        (0, child_process_1.spawn)(opener, [dir], { detached: true, stdio: 'ignore' }).on('error', () => { }).unref();
        return res.json({ success: true, copied, folder: dir, message: `Đã tải ${copied} video vào ${dir}` });
    }
    catch (error) {
        console.error('Error exporting videos:', error);
        return res.status(500).json({ error: 'Lỗi khi tải video về máy' });
    }
});
// POST /api/queue/clear-finished - clear completed jobs
router.post('/clear-finished', (_req, res) => {
    try {
        const result = db_1.db.prepare(`DELETE FROM jobs WHERE status = 'completed' AND media_type = 'video'`).run();
        (0, ws_1.broadcast)('QUEUE_STATE', {
            counts: dispatcher_1.dispatcher.getQueueCounts()
        });
        return res.json({
            success: true,
            message: `Đã dọn dẹp ${result.changes} tác vụ đã hoàn thành`
        });
    }
    catch (error) {
        console.error('Error clearing finished jobs:', error);
        return res.status(500).json({ error: 'Lỗi khi xóa các tác vụ đã hoàn thành' });
    }
});
// GET /api/queue/state - return overview state
router.get('/state', (_req, res) => {
    try {
        const counts = dispatcher_1.dispatcher.getQueueCounts();
        const runningJobs = db_1.db.prepare(`
      SELECT id, prompt, progress, elapsed_sec, started_at, account_id, duration, ratio
      FROM jobs WHERE status = 'running'
    `).all();
        let vaultProxyCount = 0;
        try {
            const { getVaultProxyCount } = require('../proxyManager');
            vaultProxyCount = getVaultProxyCount();
        }
        catch { }
        return res.json({
            counts,
            runningJobs,
            isDispatcherRunning: dispatcher_1.dispatcher.isRunning(),
            vaultProxyCount
        });
    }
    catch (error) {
        console.error('Error getting queue state:', error);
        return res.status(500).json({ error: 'Không thể lấy thông tin trạng thái hàng đợi' });
    }
});
exports.default = router;
