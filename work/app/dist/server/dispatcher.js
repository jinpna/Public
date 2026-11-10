"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.dispatcher = void 0;
exports.getDownloadDir = getDownloadDir;
exports.slugifyPrompt = slugifyPrompt;
exports.saveVideoToComputer = saveVideoToComputer;
const fs_1 = __importDefault(require("fs"));
const os_1 = __importDefault(require("os"));
const path_1 = __importDefault(require("path"));
const db_1 = require("./db");
const museWorker_1 = require("./museWorker");
const refManifest_1 = require("./refManifest");
const paths_1 = require("./paths");
/** Thư mục tự lưu video xong (đổi được qua setting "download_dir"). */
function getDownloadDir() {
    const row = db_1.db.prepare(`SELECT value FROM settings WHERE key = 'download_dir'`).get();
    return row?.value?.trim() || path_1.default.join(os_1.default.homedir(), 'Downloads', 'Muse Videos');
}
/** Đầu prompt dạng không dấu để đặt tên file: "Cảnh quay cận..." -> "Canh-quay-can..." */
function slugifyPrompt(prompt) {
    return prompt
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/đ/g, 'd')
        .replace(/Đ/g, 'D')
        .replace(/@[\w-]+/g, '')
        .replace(/[^a-zA-Z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 50);
}
/** Copy video vừa xong vào thư mục của người dùng: <ngày>/<task>_<đầu prompt>.mp4 */
function saveVideoToComputer(jobId, prompt, videoUrl) {
    try {
        const src = path_1.default.join(paths_1.DATA_DIR, videoUrl.replace(/^\//, ''));
        const day = new Date().toLocaleDateString('sv-SE'); // yyyy-mm-dd
        const dir = path_1.default.join(getDownloadDir(), day);
        fs_1.default.mkdirSync(dir, { recursive: true });
        const slug = slugifyPrompt(prompt);
        const dest = path_1.default.join(dir, `${jobId}${slug ? '_' + slug : ''}${path_1.default.extname(src) || '.mp4'}`);
        fs_1.default.copyFileSync(src, dest);
        return dest;
    }
    catch (err) {
        console.error('[Dispatcher] Không lưu được video vào máy:', err);
        return null;
    }
}
// Muse không báo % tiến độ, nên ước lượng theo thời gian chạy so với thời gian tạo video thường gặp.
const EXPECTED_SECONDS = 240;
const {IMAGE_TIMEOUT_MS,IMAGE_CONCURRENCY,IMAGE_MAX_TIMEOUT_RETRIES,imageExpired,canAssign,isImageTimeoutMessage,imageTimeoutDecision,attemptOwns,canStartAttempt}=require('./imageExecutionPolicy.cjs');
let attemptSeq=0;
class Dispatcher {
    running = false;
    /** Job đang được worker xử lý thật (jobId -> accountId). */
    active = new Map();
    /** Per-attempt registry (jobId -> {token,accountId,timer,expired,finished}). An entry lives until the attempt's own
     *  finally has run, so a retry of the same jobId can never start (or be clobbered) while the old runJob unwinds. */
    attempts = new Map();
    loopTimer = null;
    healthTimer = null;
    broadcastFn = null;
    checking = new Set();
    lastProxyLimitBroadcast = new Map();
    lastAutoReassignCheck = 0;
    /** Tự động kiểm tra và phân phối lại proxy cho tài khoản rảnh đang bị lỗi proxy */
    checkFailingProxies() {
        if (Date.now() - this.lastAutoReassignCheck < 25000)
            return;
        this.lastAutoReassignCheck = Date.now();
        try {
            const { autoReassignFailingAccounts } = require('./proxyManager');
            autoReassignFailingAccounts().catch(() => { });
        }
        catch { }
    }
    isRunning() {
        return this.running;
    }
    start(broadcast) {
        this.broadcastFn = broadcast;
        if (this.running) {
            this.assignJobs();
            return;
        }
        this.running = true;
        console.log('[Dispatcher] Engine started.');
        this.loopTimer = setInterval(() => {
            if (!this.running)
                return;
            this.checkTimeouts();
            this.checkDisconnectedAccounts();
            this.resumePausedAccounts();
            this.clearExpiredUsageLimits();
            this.resumeRateLimitedProxies();
            this.checkFailingProxies();
            this.assignJobs();
        }, 2000);
        // Mở app: giữ nguyên tài khoản đã đăng nhập, không kiểm tra lại ngay (đỡ mở hàng loạt trình duyệt).
        // Phiên hết hạn sẽ tự lộ ra khi chạy job (SESSION_EXPIRED) hoặc ở lần kiểm tra định kỳ 10 phút.
        this.healthTimer = setInterval(() => this.checkAllAccounts(true), 10 * 60 * 1000);
        this.assignJobs();
        this.broadcastState();
    }
    stop() {
        this.running = false;
        console.log('[Dispatcher] Engine stopped.');
        if (this.loopTimer) {
            clearInterval(this.loopTimer);
            this.loopTimer = null;
        }
        if (this.healthTimer) {
            clearInterval(this.healthTimer);
            this.healthTimer = null;
        }
        for (const jobId of this.active.keys())
            museWorker_1.museWorker.cancel(jobId);
        for (const entry of this.attempts.values()) {
            entry.expired = true;
            if (entry.timer) { clearTimeout(entry.timer); entry.timer = null; }
        }
        this.active.clear();
        db_1.db.prepare(`UPDATE jobs SET status = 'stopped' WHERE status = 'running'`).run();
        db_1.db.prepare(`UPDATE accounts SET jobs_running = 0`).run();
        db_1.db.prepare(`UPDATE studio_cards SET status = 'idle' WHERE status = 'running'`).run();
        this.broadcast('QUEUE_STOPPED', { message: 'Đã dừng tất cả tác vụ đang chạy' });
        this.broadcastState();
    }
    /** Bỏ theo dõi job và đóng tab Muse của nó (không đổi trạng thái DB). */
    release(jobId) {
        if (this.active.has(jobId)) {
            this.active.delete(jobId);
            museWorker_1.museWorker.cancel(jobId);
        }
        const entry = this.attempts.get(jobId);
        if (entry && entry.timer) { clearTimeout(entry.timer); entry.timer = null; }
    }
    stopJob(jobId) {
        this.release(jobId);
        const job = db_1.db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
        if (job) {
            if (job.account_id && job.status === 'running') {
                db_1.db.prepare('UPDATE accounts SET jobs_running = MAX(0, jobs_running - 1) WHERE id = ?').run(job.account_id);
            }
            db_1.db.prepare(`UPDATE jobs SET status = 'stopped', finished_at=datetime('now'), error=NULL WHERE id = ?`).run(jobId);
            db_1.db.prepare(`UPDATE studio_cards SET status = 'idle' WHERE job_id = ?`).run(jobId);
        }
        this.broadcastState();
        if (this.running)
            this.assignJobs();
    }
    trigger() {
        if (this.running) {
            this.assignJobs();
            this.broadcastState();
        }
    }
    handleAccountDisabled(accountId) {
        const runningJobs = db_1.db.prepare(`SELECT id FROM jobs WHERE account_id = ? AND status = 'running'`).all(accountId);
        for (const row of runningJobs) {
            this.release(row.id);
            db_1.db.prepare(`UPDATE jobs SET status = 'pending', account_id = NULL, progress = 0 WHERE id = ?`).run(row.id);
        }
        db_1.db.prepare(`UPDATE accounts SET jobs_running = 0 WHERE id = ?`).run(accountId);
        this.broadcastState();
        if (this.running)
            this.assignJobs();
    }
    // ---------- Kiểm tra phiên thật ----------
    broadcastAccounts() {
        // import trễ để tránh vòng import accounts -> dispatcher
        const { getSanitizedAccounts } = require('./routes/accounts');
        this.broadcast('ACCOUNTS_UPDATED', getSanitizedAccounts());
    }
    /** Mở muse.ai bằng phiên của tài khoản, cập nhật Online/Offline theo kết quả thật. */
    async checkAccount(accountId) {
        if (this.checking.has(accountId))
            return { ok: false, reason: 'Đang kiểm tra' };
        const acc = db_1.db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId);
        if (!acc)
            return { ok: false, reason: 'Không tìm thấy tài khoản' };
        if (museWorker_1.museWorker.lockedProfiles.has(accountId))
            return { ok: false, reason: 'Cửa sổ đăng nhập đang mở' };
        // Đang tạm dừng do hết hạn mức: không cho Online lại trước giờ hẹn (kể cả health check định kỳ)
        if (this.isPaused(accountId))
            return { ok: false, reason: acc.session_status };
        this.checking.add(accountId);
        db_1.db.prepare(`UPDATE accounts SET session_status = 'Đang kiểm tra phiên...' WHERE id = ?`).run(accountId);
        this.broadcastAccounts();
        try {
            const result = await museWorker_1.museWorker.checkSession(accountId);
            // Đọc lại sau khi kiểm tra: checkSession vừa cập nhật hạn mức mới nhất (vd. Muse vừa mở lại lượt)
            const fresh = db_1.db.prepare('SELECT usage_limit_reached, usage_percent, usage_checked_at FROM accounts WHERE id = ?').get(accountId);
            const isLimitReached = (fresh?.usage_limit_reached === 1) || (Number(fresh?.usage_percent) >= 100);
            const isProxyDead = result.reason && (result.reason.includes('PROXY_LIMIT') || result.reason.includes('Key không hợp lệ') || result.reason.includes('key het han'));
            let newStatus = 'online';
            let newSessionStatus = result.reason;
            if (isLimitReached) {
                newStatus = 'offline';
                newSessionStatus = `Hết hạn mức Muse (${fresh?.usage_percent || 100}% used)`;
            }
            else if (isProxyDead) {
                newStatus = 'offline';
                newSessionStatus = `Proxy hết hạn gói / không hợp lệ`;
            }
            else if (result.ok) {
                newStatus = 'online';
            }
            else if (!result.definitive && acc.credentials_encrypted && acc.enabled === 1) {
                // Chỉ khi Muse báo RÕ là chưa đăng nhập (cookie hết hạn) mới Offline (definitive = true, rơi xuống nhánh dưới).
                // QUAN TRỌNG: Tài khoản đã đăng nhập và lưu thì GIỮ NGUYÊN ONLINE!
                // Kể cả proxy timeout (ERR_TIMED_OUT), mạng chập chờn hay lỗi check tạm thời,
                // tuyệt đối KHÔNG chuyển thành Offline để không chặn hàng đợi của người dùng.
                newStatus = 'online';
                if (result.reason && (result.reason.includes('detached Frame') || result.reason.includes('Target closed') || result.reason.includes('Protocol error'))) {
                    newSessionStatus = 'Phiên Muse hoạt động';
                }
                else if (result.reason && (result.reason.includes('ERR_') || result.reason.toLowerCase().includes('time') || result.reason.toLowerCase().includes('proxy'))) {
                    newSessionStatus = `Phiên Muse hoạt động (Mạng kiểm tra chậm: ${result.reason.slice(0, 70)})`;
                }
                else {
                    newSessionStatus = result.reason || 'Phiên Muse hoạt động';
                }
            }
            else {
                newStatus = 'offline';
            }
            db_1.db.prepare(`
        UPDATE accounts SET status = ?, session_status = ?, last_health_check = datetime('now') WHERE id = ?
      `).run(newStatus, newSessionStatus, accountId);
            if (newStatus === 'offline')
                this.handleAccountDisabled(accountId);
            return result;
        }
        finally {
            this.checking.delete(accountId);
            this.broadcastAccounts();
            this.trigger();
        }
    }
    /**
     * Đối chiếu với trình duyệt đang chọn: tài khoản đăng nhập bằng trình duyệt mà profile của trình duyệt hiện tại
     * chưa có phiên (vd. vừa đổi Edge -> Chrome) thì không được hiện Online. Tài khoản dán cookie giữ nguyên (tự nạp lại).
     */
    reconcileProfilesWithBrowser() {
        let browserName = 'trình duyệt hiện tại';
        try {
            browserName = museWorker_1.museWorker.currentBrowserName();
        }
        catch {
            // không có trình duyệt: để lỗi báo khi chạy
        }
        const rows = db_1.db.prepare(`SELECT id, credentials_encrypted FROM accounts WHERE enabled = 1 AND status = 'online'`).all();
        let changed = false;
        for (const r of rows) {
            if (museWorker_1.museWorker.isCookieAccount(r.id))
                continue;
            if (museWorker_1.museWorker.profileHasSession(r.id))
                continue;
            db_1.db.prepare(`UPDATE accounts SET status = 'offline', session_status = ? WHERE id = ?`).run(`Chưa đăng nhập trên ${browserName}: bấm "Mở duyệt" để đăng nhập 1 lần`, r.id);
            changed = true;
        }
        if (changed)
            this.broadcastAccounts();
    }
    async checkAllAccounts(skipBusy = false) {
        const accounts = db_1.db.prepare(`SELECT id, jobs_running FROM accounts WHERE enabled = 1`).all();
        // Chạy lần lượt từng tài khoản thay vì Promise.all đồng loạt để không làm nghẽn proxy
        for (const a of accounts) {
            if (skipBusy && a.jobs_running > 0)
                continue;
            await this.checkAccount(a.id).catch((e) => console.error('[Dispatcher] Health check error:', e));
            await new Promise((r) => setTimeout(r, 1200));
        }
    }
    // ---------- Broadcast ----------
    broadcast(type, payload) {
        if (this.broadcastFn) {
            try {
                this.broadcastFn(type, payload);
            }
            catch (err) {
                console.error('[Dispatcher] Broadcast error:', err);
            }
        }
    }
    broadcastState() {
        const counts = this.getQueueCounts();
        const runningJobs = db_1.db.prepare(`
      SELECT id, prompt, progress, elapsed_sec, started_at, account_id, duration, ratio
      FROM jobs WHERE status = 'running'
    `).all();
        let vaultProxyCount = 0;
        try {
            const { getVaultProxyCount } = require('./proxyManager');
            vaultProxyCount = getVaultProxyCount();
        }
        catch { }
        this.broadcast('QUEUE_STATE', {
            counts,
            runningJobs,
            isDispatcherRunning: this.running,
            vaultProxyCount
        });
    }
    getQueueCounts() {
        const rows = db_1.db.prepare(`SELECT status, count(*) as count FROM jobs GROUP BY status`).all();
        const counts = {
            pending: 0,
            running: 0,
            completed: 0,
            failed: 0,
            stopped: 0,
            total: 0
        };
        for (const r of rows) {
            counts[r.status] = r.count;
            counts.total += r.count;
        }
        return counts;
    }
    getConcurrencySetting() {
        const row = db_1.db.prepare(`SELECT value FROM settings WHERE key = 'concurrency'`).get();
        const val = row ? parseInt(row.value, 10) : 10;
        const baseConcurrency = isNaN(val) || val <= 0 ? 10 : val;
        // Luôn cho phép số luồng song song tối thiểu bằng số tài khoản Online thực tế
        const onlineRow = db_1.db.prepare(`SELECT COUNT(*) as c FROM accounts WHERE enabled = 1 AND status = 'online'`).get();
        const onlineCount = onlineRow?.c || 0;
        return Math.max(baseConcurrency, onlineCount);
    }
    getUsagePauseMinutes() {
        const row = db_1.db.prepare(`SELECT value FROM settings WHERE key = 'usage_pause_minutes'`).get();
        const val = row ? parseInt(row.value, 10) : 60;
        return isNaN(val) || val <= 0 ? 60 : val;
    }
    /** Hết giờ tạm dừng do hạn mức -> bỏ tạm dừng và kiểm tra lại phiên để chạy tiếp. */
    resumePausedAccounts() {
        const rows = db_1.db.prepare(`SELECT id, paused_until FROM accounts WHERE paused_until IS NOT NULL AND enabled = 1`).all();
        for (const r of rows) {
            if (new Date(r.paused_until).getTime() <= Date.now()) {
                db_1.db.prepare(`UPDATE accounts SET paused_until = NULL WHERE id = ?`).run(r.id);
                this.checkAccount(r.id).catch((e) => console.error('[Dispatcher] Resume check error:', e));
            }
        }
    }
    /** Tự động kiểm tra và mở lại proxy xoay khi hết thời gian chờ cooldown (rate limit) - Người dùng KHÔNG phải bấm tay. */
    proxyRateLimitRechecking = new Set();
    resumeRateLimitedProxies() {
        const rows = db_1.db.prepare(`
      SELECT id, identifier, proxy, proxy_status, status 
      FROM accounts 
      WHERE enabled = 1 AND proxy_status = 'rate_limited' AND proxy IS NOT NULL
    `).all();
        if (rows.length === 0)
            return;
        for (const r of rows) {
            if (this.proxyRateLimitRechecking.has(r.id))
                continue;
            this.proxyRateLimitRechecking.add(r.id);
            (async () => {
                try {
                    const { checkSingleProxy } = require('./proxyManager');
                    const res = await checkSingleProxy(r.proxy, false);
                    if (res.ok && res.ip && res.port) {
                        console.log(`[Dispatcher] Proxy của ${r.identifier} đã hết thời gian chờ cooldown (${res.message}) -> Tự động chuyển Live và kích hoạt chạy tiếp!`);
                        db_1.db.prepare(`
              UPDATE accounts 
              SET proxy_status = 'live', 
                  proxy_ip = ?, 
                  proxy_limit_msg = NULL,
                  status = 'online'
              WHERE id = ?
            `).run(`${res.ip}:${res.port}`, r.id);
                        this.broadcastAccounts();
                        if (this.running)
                            this.assignJobs();
                    }
                }
                catch (e) {
                    console.error('[Dispatcher] Auto-resume proxy error:', e.message);
                }
                finally {
                    setTimeout(() => {
                        this.proxyRateLimitRechecking.delete(r.id);
                    }, 10000);
                }
            })();
        }
    }
    /**
     * Tự dọn hạn mức cũ: đã qua ngày Muse mở lại (usage_reset_date dạng "DD/MM ...") mà tài khoản vẫn mang cờ hết hạn mức
     * -> xóa cờ, bỏ tạm dừng và tự kiểm tra lại để đọc hạn mức mới. Người dùng không phải làm gì.
     */
    usageAutoClearAt = new Map();
    clearExpiredUsageLimits() {
        const rows = db_1.db
            .prepare(`SELECT id, usage_reset_date FROM accounts
         WHERE enabled = 1 AND usage_reset_date IS NOT NULL
           AND (usage_limit_reached = 1 OR usage_percent >= 100 OR paused_until IS NOT NULL)`)
            .all();
        const now = new Date();
        for (const r of rows) {
            const m = String(r.usage_reset_date).match(/(\d{1,2})\/(\d{1,2})/);
            if (!m)
                continue;
            const day = Number(m[1]);
            const month = Number(m[2]) - 1;
            let reset = new Date(now.getFullYear(), month, day, 0, 0, 0); // 00:00 giờ máy ngày mở lại
            // Ngày mở lại dạng DD/MM không có năm: nếu lệch quá nửa năm thì là năm kế tiếp/trước đó
            if (reset.getTime() - now.getTime() > 180 * 86400000)
                reset = new Date(now.getFullYear() - 1, month, day);
            if (now.getTime() - reset.getTime() > 180 * 86400000)
                reset = new Date(now.getFullYear() + 1, month, day);
            if (now.getTime() < reset.getTime() || this.checking.has(r.id))
                continue;
            // Muse có thể chưa mở lại đúng 00:00 giờ máy (vd. reset theo UTC): mỗi tài khoản tối đa 1 lần / 30 phút
            const last = this.usageAutoClearAt.get(r.id) || 0;
            if (Date.now() - last < 30 * 60 * 1000)
                continue;
            this.usageAutoClearAt.set(r.id, Date.now());
            console.log(`[Dispatcher] Đã qua ngày Muse mở lại hạn mức (${r.usage_reset_date}) -> tự kiểm tra lại tài khoản ${r.id}`);
            db_1.db.prepare(`UPDATE accounts SET usage_limit_reached = 0, usage_percent = NULL, paused_until = NULL,
                session_status = 'Đã tới ngày Muse mở lại hạn mức, đang kiểm tra lại...' WHERE id = ?`).run(r.id);
            this.broadcastAccounts();
            this.checkAccount(r.id).catch((e) => console.error('[Dispatcher] Usage reset check error:', e));
        }
    }
    isPaused(accountId) {
        const r = db_1.db.prepare(`SELECT paused_until FROM accounts WHERE id = ?`).get(accountId);
        return !!r?.paused_until && new Date(r.paused_until).getTime() > Date.now();
    }
    getSlotsPerAccountSetting() {
        const row = db_1.db.prepare(`SELECT value FROM settings WHERE key = 'slots_per_account'`).get();
        const val = row ? parseInt(row.value, 10) : 1;
        return isNaN(val) || val <= 0 ? 1 : val;
    }
    /** Image timed out (own timer, watchdog or worker error). Idempotent per attempt; retries at most IMAGE_MAX_TIMEOUT_RETRIES times.
     *  The job goes back to 'pending' here but assignJobs will not start it until the old attempt's finally has cleaned up. */
    expireImage(jobId, token) {
        const job=db_1.db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
        if(!job||job.status!=='running'||job.media_type!=='image')return false;
        const entry=this.attempts.get(jobId);
        if(token!==undefined&&!attemptOwns(entry,token))return false; // stale timer / already expired
        if(entry){
            if(entry.expired)return false;
            entry.expired=true;
            if(entry.timer){clearTimeout(entry.timer);entry.timer=null;}
        }
        // Stop the old worker page. cancel() adds jobId to the worker's cancelled set; the worker's own finally clears it,
        // and we only start the next attempt after that (see canStartAttempt / processJob finally).
        this.active.delete(jobId);
        museWorker_1.museWorker.cancel(jobId);
        const decision=imageTimeoutDecision(job.attempts);
        const secs=Math.round(IMAGE_TIMEOUT_MS/1000);
        if(job.account_id)db_1.db.prepare('UPDATE accounts SET jobs_running = MAX(0, jobs_running - 1) WHERE id = ?').run(job.account_id);
        if(decision.action==='retry'){
            db_1.db.prepare("UPDATE jobs SET status='pending',account_id=NULL,progress=0,attempts=?,error=? WHERE id=?").run(decision.attempts,`Ảnh quá ${secs} giây, tự thử lại ${decision.attempts}/${decision.maxRetries}...`,jobId);
            db_1.db.prepare("UPDATE studio_cards SET status='running',progress=0 WHERE job_id=?").run(jobId);
            this.broadcast('JOB_RETRY',{jobId,attempts:decision.attempts,maxRetries:decision.maxRetries,error:`Ảnh quá ${secs} giây, đang tự thử lại`});
        }else{
            db_1.db.prepare("UPDATE jobs SET status='failed',finished_at=datetime('now'),error=? WHERE id=?").run(`Ảnh xử lý quá ${secs} giây sau ${decision.attempts+1} lần thử. Bạn có thể gửi yêu cầu mới.`,jobId);
            db_1.db.prepare("UPDATE studio_cards SET status='failed' WHERE job_id=?").run(jobId);
            this.broadcast('JOB_FAILED',{jobId,error:`Ảnh đã tự dừng sau ${secs} giây (${decision.attempts+1} lần thử)`,status:'failed'});
        }
        this.broadcastState();
        // If no attempt is unwinding (orphan watchdog case) the job can start right away; otherwise processJob's finally triggers assignJobs.
        if(this.running&&!this.attempts.has(jobId))this.assignJobs();
        return true;
    }
    checkTimeouts() {
        // Tự động đồng bộ jobs_running của mọi tài khoản theo số job running thực tế
        db_1.db.prepare(`
      UPDATE accounts
      SET jobs_running = (
        SELECT COUNT(*) FROM jobs
        WHERE jobs.account_id = accounts.id AND jobs.status = 'running'
      )
    `).run();
        const runningJobs = db_1.db.prepare(`SELECT * FROM jobs WHERE status = 'running'`).all();
        for (const job of runningJobs) {
            if(imageExpired(job)){this.expireImage(job.id,this.attempts.has(job.id)?this.attempts.get(job.id).token:undefined);continue;}
            // Job "running" mà worker không giữ (vd. sau khi khởi động lại) -> trả về hàng đợi
            if (!this.active.has(job.id) && !this.attempts.has(job.id)) {
                db_1.db.prepare(`UPDATE jobs SET status = 'pending', account_id = NULL, progress = 0 WHERE id = ?`).run(job.id);
                if (job.account_id)
                    db_1.db.prepare(`UPDATE accounts SET jobs_running = MAX(0, jobs_running - 1) WHERE id = ?`).run(job.account_id);
            }
        }
    }
    checkDisconnectedAccounts() {
        const runningJobs = db_1.db.prepare(`SELECT * FROM jobs WHERE status = 'running'`).all();
        for (const job of runningJobs) {
            if (!job.account_id)
                continue;
            const account = db_1.db.prepare(`SELECT * FROM accounts WHERE id = ?`).get(job.account_id);
            if (!account || account.enabled !== 1 || account.status !== 'online') {
                console.log(`[Dispatcher] Account ${job.account_id} disconnected, requeueing job ${job.id}`);
                this.release(job.id);
                db_1.db.prepare(`UPDATE jobs SET status = 'pending', account_id = NULL, progress = 0 WHERE id = ?`).run(job.id);
            }
        }
    }
    // Gán job chờ cho tài khoản Online còn trống: 1 tài khoản = chạy lần lượt, N tài khoản = N luồng song song
    assignJobs() {
        if (!this.running)
            return;
        try {
            const { licenseManager } = require('./licenseManager');
            if (!licenseManager.isAppAllowed())
                return;
        }
        catch { }
        // Luôn giải phóng slot trước khi tìm tài khoản trống
        db_1.db.prepare(`
      UPDATE accounts
      SET jobs_running = (
        SELECT COUNT(*) FROM jobs
        WHERE jobs.account_id = accounts.id AND jobs.status = 'running'
      )
    `).run();
        const maxConcurrency = Math.max(3,this.getConcurrencySetting());
        const currentRunning = this.active.size;
        if (currentRunning >= maxConcurrency)
            return;
        const onlineAccounts = db_1.db.prepare(`
      SELECT * FROM accounts
      WHERE enabled = 1 
        AND status = 'online'
        AND (usage_limit_reached IS NULL OR usage_limit_reached = 0)
        AND (usage_percent IS NULL OR usage_percent < 100)
        AND (proxy_status IS NULL OR proxy_status NOT IN ('limit_reached', 'dead'))
      ORDER BY jobs_running ASC, created_at ASC
    `).all();
        const slotsPerAccount = Math.max(3,this.getSlotsPerAccountSetting());
        const availableAccounts = onlineAccounts.filter((acc) => acc.jobs_running < slotsPerAccount &&
            !this.checking.has(acc.id) && !db_1.db.prepare("SELECT id FROM jobs WHERE account_id=? AND media_type='text' AND status='running' LIMIT 1").get(acc.id) &&
            !museWorker_1.museWorker.lockedProfiles.has(acc.id) &&
            !this.isPaused(acc.id));
        if (availableAccounts.length === 0)
            return;
        const availableTotalSlots = maxConcurrency - currentRunning;
        if (availableTotalSlots <= 0)
            return;
        const pendingJobs = db_1.db.prepare(`
      SELECT * FROM jobs
      WHERE status = 'pending' AND id NOT LIKE 'mag_%'
      ORDER BY sort_order ASC, created_at ASC
      LIMIT ?
    `).all(100);
        if (pendingJobs.length === 0)
            return;
        let runningImages=db_1.db.prepare("SELECT COUNT(*) as c FROM jobs WHERE status='running' AND media_type='image'").get().c;
        for (const job of pendingJobs) {
            if(this.active.size>=maxConcurrency)break;
            if(!canStartAttempt(this.attempts.get(job.id)))continue; // old attempt of this jobId still unwinding
            const account=availableAccounts.filter(acc=>canAssign(job,acc,{runningImages,slots:this.getSlotsPerAccountSetting()})).sort((a,b)=>a.jobs_running-b.jobs_running)[0];
            if(!account)continue;
            if(job.media_type==='image')runningImages++;
            db_1.db.prepare(`
        UPDATE jobs
        SET status = 'running',
            progress = 0,
            account_id = ?,
            started_at = datetime('now'),
            elapsed_sec = 0,
            error = NULL
        WHERE id = ?
      `).run(account.id, job.id);
            db_1.db.prepare(`UPDATE accounts SET jobs_running = jobs_running + 1 WHERE id = ?`).run(account.id);
            account.jobs_running += 1;
            db_1.db.prepare(`UPDATE studio_cards SET status = 'running', progress = 0 WHERE job_id = ?`).run(job.id);
            this.broadcast('JOB_STARTED', { jobId: job.id, accountId: account.id });
            this.active.set(job.id, account.id);
            this.processJob(job, account);
        }
        this.broadcastState();
    }
    /** Ảnh tham chiếu của job: tag gắn cho cả batch + các @tag xuất hiện trong prompt (đúng thứ tự). */
    resolveRefFiles(job) {
        // Thứ tự ảnh = thứ tự @tag trong prompt (prompt thường ghi "ảnh 1 là @a, ảnh 2 là @b"), ảnh gắn chung cho lô đi sau
        const tags = [];
        for (const m of job.prompt.matchAll(/@([\p{L}\p{N}_-]+)/gu))
            tags.push(m[1]);
        try {
            tags.push(...JSON.parse(job.ref_tags || '[]'));
        }
        catch {
            // ignore
        }
        const files = [];
        const missing = [];
        for (const raw of tags) {
            const tag = raw.replace(/^@/, '').toLowerCase();
            const row = db_1.db.prepare('SELECT filepath FROM ref_images WHERE lower(tag) = ?').get(tag);
            if (!row || !fs_1.default.existsSync(row.filepath)) {
                if (!missing.includes(tag))
                    missing.push(tag);
            }
            else if (!files.includes(row.filepath)) {
                files.push(row.filepath);
            }
        }
        return { files, missing };
    }
    async processJob(job, account) {
        const jobId = job.id;
        const accountId = account.id;
        console.log(`[Dispatcher] Gán job ${jobId} -> tài khoản ${account.identifier}`);
        const entry = { token: ++attemptSeq, accountId, timer: null, expired: false, finished: false };
        this.attempts.set(jobId, entry);
        const current = () => this.attempts.get(jobId) === entry; // false once a successor replaced us (never, by design) or we were cleaned up
        const stillMine = () => {
            if (!current() || entry.expired || !this.active.has(jobId))
                return false;
            const cur = db_1.db.prepare('SELECT status, account_id FROM jobs WHERE id = ?').get(jobId);
            return !!cur && cur.status === 'running' && cur.account_id === accountId;
        };
        // Quét lại @mention từ prompt gốc + ảnh dùng chung của lô; kiểm tra file thật trên đĩa trước khi gửi
        const resolved = (0, refManifest_1.resolveJobRefs)((["image","text"].includes(job.media_type)||String(job.prompt||'').startsWith('MUSE VIDEO INPUT CONTRACT.')) ? "" : job.prompt, job.ref_tags, job.media_type==='video');
        const refs = { files: resolved.refs.map((r) => r.file), missing: [...resolved.missingTags, ...resolved.missingFiles] };
        if (refs.missing.length > 0) {
            // Không âm thầm chạy thiếu ảnh / không gửi đường dẫn ma: báo lỗi ngay, không retry, không bắt đầu tạo video
            this.active.delete(jobId);
            entry.finished = true;
            if (this.attempts.get(jobId) === entry) this.attempts.delete(jobId);
            const parts = [];
            if (resolved.missingTags.length)
                parts.push(`không có trong kho: ${resolved.missingTags.map((t) => '@' + t).join(', ')}`);
            if (resolved.missingFiles.length)
                parts.push(`file ảnh đã mất trên máy: ${resolved.missingFiles.map((t) => '@' + t).join(', ')} (hãy tải lại ảnh)`);
            const msg = `Thiếu ảnh tham chiếu - ${parts.join('; ')}. Chưa gửi gì lên Muse.`;
            db_1.db.prepare(`UPDATE jobs SET status = 'failed', finished_at = datetime('now'), error = ? WHERE id = ?`).run(msg, jobId);
            db_1.db.prepare(`UPDATE accounts SET jobs_running = MAX(0, jobs_running - 1) WHERE id = ?`).run(accountId);
            this.broadcast('JOB_FAILED', { jobId, error: msg });
            this.broadcastState();
            if (this.running) {
                setTimeout(() => {
                    if (this.running)
                        this.assignJobs();
                }, 0);
            }
            return;
        }
        if(job.media_type==='image')entry.timer=setTimeout(()=>this.expireImage(jobId,entry.token),IMAGE_TIMEOUT_MS);
        try {
            const result = await museWorker_1.museWorker.runJob({
                jobId,
                accountId,
                prompt: job.media_type==='video'?require('./videoReferences.cjs').canonicalVideoPrompt(job.prompt,resolved.refs):job.prompt,
                mediaType: job.media_type || "video",
                duration: job.duration,
                ratio: job.ratio,
                refFiles: refs.files,
                refManifest: job.media_type==='video'?'VIDEO REFERENCE MAP — use attachment order, never guess from filenames. '+resolved.refs.map((r,i)=>'@image'+(i+1)+' = @hinh'+(i+1)+' = attached file '+JSON.stringify(require('path').basename(r.file))+' (original library tag @'+r.tag+')').join('; ')+'. All @imageN in the prompt refer ONLY to attachment N in this message.':require('./faceSwapContract.cjs').faceSwapManifest(job.prompt,resolved.refs) || require('./conceptContract.cjs').conceptManifest(job.prompt,resolved.refs) || (0, refManifest_1.buildRefManifest)(resolved.refs),
                timeoutMs: job.media_type==='image'?IMAGE_TIMEOUT_MS:(job.timeout_minutes || 15) * 60 * 1000,
                attemptNum: job.attempts || 0,
                textPurpose: job.media_type==='text'&&String(job.batch_id||'').startsWith('code_assistant_')?'code':undefined,
                onTick: (elapsedSec, phase) => {
                    if (!stillMine())
                        return;
                    const progress = Math.min(95, Math.round((elapsedSec / EXPECTED_SECONDS) * 95));
                    db_1.db.prepare(`UPDATE jobs SET progress = ?, elapsed_sec = ? WHERE id = ?`).run(progress, elapsedSec, jobId);
                    db_1.db.prepare(`UPDATE studio_cards SET progress = ? WHERE job_id = ?`).run(progress, jobId);
                    this.broadcast('JOB_PROGRESS', { jobId, progress, elapsedSec, status: 'running', phase });
                },
            });
            if (!stillMine())
                return;
            this.active.delete(jobId);
            const elapsed = db_1.db.prepare('SELECT elapsed_sec FROM jobs WHERE id = ?').get(jobId).elapsed_sec;
            db_1.db.prepare(`
        UPDATE jobs
        SET status = 'completed', progress = 100, finished_at = datetime('now'),
            video_url = ?, thumbnail_url = ?, error = NULL
        WHERE id = ?
      `).run(result.videoUrl, result.thumbnailUrl, jobId);
            // Lưu đúng danh sách ảnh worker đã đính kèm (thứ tự, tag, vai trò) để kiểm tra lại sau
            const attached = (result.attachedFiles || []).map((file, i) => {
                const ref = resolved.refs.find((r) => r.file === file);
                return { order: i + 1, tag: ref?.tag ?? null, role: ref?.role ?? null, file };
            });
            db_1.db.prepare(`UPDATE jobs SET attached_refs = ? WHERE id = ?`).run(JSON.stringify(attached), jobId);
            db_1.db.prepare(`UPDATE accounts SET jobs_running = MAX(0, jobs_running - 1) WHERE id = ?`).run(accountId);
            db_1.db.prepare(`
        UPDATE studio_cards SET status = 'completed', progress = 100, video_url = ?, thumbnail_url = ? WHERE job_id = ?
      `).run(result.videoUrl, result.thumbnailUrl, jobId);
            const savedTo = job.media_type==='text'?null:saveVideoToComputer(jobId, job.prompt, result.videoUrl);
            console.log(`[Dispatcher] Job ${jobId} hoàn thành: ${result.videoUrl}${savedTo ? ` -> đã lưu ${savedTo}` : ''}`);
            this.broadcast('JOB_COMPLETED', { jobId, mediaType: job.media_type || 'video', videoUrl: result.videoUrl, thumbnailUrl: result.thumbnailUrl, elapsedSec: elapsed });
            const updatedCard = db_1.db.prepare('SELECT * FROM studio_cards WHERE job_id = ?').get(jobId);
            if (updatedCard)
                this.broadcast('STUDIO_CARD_UPDATED', updatedCard);
        }
        catch (err) {
            const message = String(err?.message || err);
            // Only an attempt that is still current/unexpired and still owns the running row may touch job/account state.
            const isMine = current() && !entry.expired && this.active.has(jobId);
            console.error(`[Dispatcher] Job ${jobId} failed with error:`, message);
            if (message === 'CANCELLED' || !isMine)
                return; // đã bị dừng / hết hạn / thu hồi ở chỗ khác (finally dọn dẹp)
            if (job.media_type === 'image' && isImageTimeoutMessage(message)) {
                // Worker reported the timeout before our timer: same bounded retry logic (idempotent per attempt).
                this.expireImage(jobId, entry.token);
                return;
            }
            this.active.delete(jobId);
            db_1.db.prepare(`UPDATE accounts SET jobs_running = MAX(0, jobs_running - 1) WHERE id = ?`).run(accountId);
            if (message === 'SESSION_EXPIRED') {
                const note = 'Phiên MUSE đã hết hạn. Đăng nhập lại tài khoản trong Cài đặt; tác vụ được giữ trong hàng đợi.';
                db_1.db.prepare("UPDATE jobs SET status='pending', account_id=NULL,progress=0,error=?,attempts=MAX(0,attempts-1),finished_at=NULL WHERE id=?").run(note,jobId);
                db_1.db.prepare("UPDATE accounts SET status='offline',session_status='Phiên Muse đã hết hạn, cần đăng nhập lại' WHERE id=?").run(accountId);
                this.broadcastAccounts();
                this.broadcast('JOB_PROGRESS',{jobId,status:'pending',progress:0,phase:note});
            }
            else if(job.media_type==='image'){
                db_1.db.prepare("UPDATE jobs SET status='failed',finished_at=datetime('now'),error=? WHERE id=?").run(message,jobId);
                db_1.db.prepare("UPDATE studio_cards SET status='failed' WHERE job_id=?").run(jobId);
                this.broadcast('JOB_FAILED',{jobId,error:message});
            }
            else if (message.startsWith('USAGE_LIMIT:')) {
                // Hết hạn mức: không tính là lần thử; trả job về hàng đợi cho tài khoản khác, tạm dừng tài khoản này
                const museSaid = message.slice('USAGE_LIMIT:'.length).trim();
                const until = new Date(Date.now() + this.getUsagePauseMinutes() * 60000);
                const untilText = until.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
                console.log(`[Dispatcher] ${account.identifier} hết hạn mức Muse, tạm dừng đến ${untilText}: ${museSaid}`);
                db_1.db.prepare(`UPDATE jobs SET status = 'pending', account_id = NULL, progress = 0 WHERE id = ?`).run(jobId);
                db_1.db.prepare(`UPDATE accounts SET status = 'offline', paused_until = ?, session_status = ? WHERE id = ?`).run(until.toISOString(), `Hết hạn mức Muse, tạm dừng đến ${untilText}. Muse: "${museSaid.slice(0, 120)}"`, accountId);
                this.broadcast('ACCOUNT_LIMIT', { accountId, identifier: account.identifier, until: until.toISOString(), untilText, message: museSaid });
                this.broadcastAccounts();
            }
            else if (message.startsWith('PROXY_LIMIT:')) {
                // Proxy hết hạn mức hoặc lỗi gói: trả job về hàng đợi cho nick khác
                const proxyMsg = message.slice('PROXY_LIMIT:'.length).trim();
                console.log(`[Dispatcher] Proxy của tài khoản ${account.identifier} gặp sự cố (${proxyMsg}). Đang kiểm tra kho để tự động phân phối lại proxy...`);
                db_1.db.prepare(`UPDATE jobs SET status = 'pending', account_id = NULL, progress = 0 WHERE id = ?`).run(jobId);
                // TỰ ĐỘNG PHÂN PHỐI LẠI PROXY MỚI TỪ KHO CHO TÀI KHOẢN NÀY
                let reassigned = false;
                try {
                    const { autoReassignProxyForAccount } = require('./proxyManager');
                    reassigned = await autoReassignProxyForAccount(accountId);
                }
                catch (e) {
                    console.error('[Dispatcher] Auto reassign proxy failed:', e.message);
                }
                if (reassigned) {
                    console.log(`[Dispatcher] Đã tự động phân phối proxy mới từ kho thành công cho ${account.identifier}!`);
                    this.broadcastAccounts();
                    this.broadcastState();
                    this.assignJobs();
                }
                else {
                    // KHI HẾT PROXY THÌ DÙNG PROXY / MẠNG SẴN CỦA MÁY (theo yêu cầu người dùng)
                    console.log(`[Dispatcher] 🌐 Toàn bộ proxy trong kho đã hết -> TỰ ĐỘNG DÙNG MẠNG SẴN CỦA MÁY cho ${account.identifier} để tiếp tục tạo video!`);
                    db_1.db.prepare(`
            UPDATE accounts
            SET proxy = NULL,
                proxy_status = 'live',
                proxy_ip = 'Mạng máy (Trực tiếp)',
                proxy_limit_msg = 'Đang dùng mạng sẵn của máy (do proxy hết hạn)'
            WHERE id = ?
          `).run(accountId);
                    this.broadcastAccounts();
                    this.broadcastState();
                    this.assignJobs();
                }
            }
            else if (message.startsWith('PROMPT_POLICY_ERROR:') || message.includes('CẦN ĐỔI PROMPT')) {
                // Muse từ chối do vi phạm chính sách / brief không an toàn: đánh dấu thất bại ngay và BÁO RÕ CẦN ĐỔI PROMPT
                let museSaid = message.startsWith('PROMPT_POLICY_ERROR:')
                    ? message.slice('PROMPT_POLICY_ERROR:'.length).trim()
                    : message.trim();
                console.log(`[Dispatcher] Job ${jobId} bị Muse từ chối nội dung: ${museSaid}`);
                const userPromptError = `⚠️ CẦN ĐỔI PROMPT: Muse từ chối tạo video do nội dung prompt (${museSaid}). Vui lòng đổi sang nội dung prompt khác để tiếp tục.`;
                db_1.db.prepare(`
          UPDATE jobs SET status = 'failed', finished_at = datetime('now'), error = ? WHERE id = ?
        `).run(userPromptError, jobId);
                db_1.db.prepare(`UPDATE studio_cards SET status = 'failed' WHERE job_id = ?`).run(jobId);
                this.broadcast('JOB_FAILED', { jobId, error: userPromptError, needChangePrompt: true });
            }
            else if (message.includes('PROXY_NETWORK_ERROR') ||
                message.includes('ERR_') ||
                message.toLowerCase().includes('proxy') ||
                message.includes('Delivery not confirmed') ||
                message.includes('ETIMEDOUT') ||
                message.includes('ECONNRESET') ||
                message.includes('socket hang up')) {
                // Lỗi mạng hoặc proxy xoay: TUYỆT ĐỐI KHÔNG ĐÁNH DẤU THẤT BẠI (FAILED) để bắt người dùng bấm tay!
                // Tự động đóng browser, xoay proxy và tiếp tục chạy mượt mà.
                console.log(`[Dispatcher] Job ${jobId} gặp sự cố mạng/proxy (${message}). Đang tự động đổi proxy và tiếp tục...`);
                await museWorker_1.museWorker.closeBrowser(accountId).catch(() => { });
                // Xử lý gián đoạn mạng theo từng loại proxy (Xoay hoặc Tĩnh)
                const curAcc = db_1.db.prepare('SELECT proxy FROM accounts WHERE id = ?').get(accountId);
                if (curAcc?.proxy) {
                    const { parseProxyLine } = require('./proxyManager');
                    const parsed = parseProxyLine(curAcc.proxy);
                    if (parsed?.type === 'rotating') {
                        // PROXY XOAY: BẢO VỆ ĐA LUỒNG - Nếu có nick khác đang render chung key thì KHÔNG được xoay
                        const busyOthers = db_1.db.prepare(`
              SELECT COUNT(*) as c FROM accounts 
              WHERE proxy = ? AND id != ? AND jobs_running > 0
            `).get(curAcc.proxy, accountId);
                        if (busyOthers && busyOthers.c > 0) {
                            console.warn(`[Dispatcher] Tài khoản ${account.identifier} gặp sự cố mạng nhưng có ${busyOthers.c} tài khoản khác đang chạy chung key xoay này. BỎ QUA tự động đổi IP để tránh làm gián đoạn các tài khoản khác.`);
                        }
                        else {
                            try {
                                const { checkSingleProxy } = require('./proxyManager');
                                await checkSingleProxy(curAcc.proxy, true).catch(() => { });
                            }
                            catch { }
                        }
                    }
                    else {
                        // PROXY TĨNH: Không đổi IP, chỉ ghi log và chờ mạng thông lại
                        console.log(`[Dispatcher] Tài khoản ${account.identifier} dùng Proxy Tĩnh, mạng gián đoạn tạm thời. Đang chờ kết nối lại...`);
                    }
                }
                const current = db_1.db.prepare('SELECT attempts FROM jobs WHERE id = ?').get(jobId);
                const attempts = (current?.attempts || 0) + 1;
                if (attempts <= 10) {
                    db_1.db.prepare(`
            UPDATE jobs
            SET status = 'pending',
                account_id = NULL,
                progress = 0,
                attempts = ?,
                error = 'Đang tự động đổi IP proxy và tiếp tục chạy...'
            WHERE id = ?
          `).run(attempts, jobId);
                    this.broadcast('JOB_RETRY', { jobId, attempts, maxRetries: 10, error: 'Đang tự động đổi IP proxy và tiếp tục chạy...' });
                    await new Promise((r) => setTimeout(r, 6000));
                }
                else {
                    console.log(`[Dispatcher] Job ${jobId} proxy gián đoạn sau ${attempts} lần thử. TỰ ĐỘNG DÙNG MẠNG SẴN CỦA MÁY để tiếp tục!`);
                    db_1.db.prepare(`
            UPDATE accounts
            SET proxy = NULL,
                proxy_status = 'live',
                proxy_ip = 'Mạng máy (Trực tiếp)',
                proxy_limit_msg = 'Đang dùng mạng sẵn của máy'
            WHERE id = ?
          `).run(accountId);
                    db_1.db.prepare(`
            UPDATE jobs
            SET status = 'pending',
                account_id = NULL,
                progress = 0,
                attempts = 0,
                error = 'Đã chuyển sang mạng sẵn của máy để tiếp tục chạy...'
            WHERE id = ?
          `).run(jobId);
                    this.broadcastAccounts();
                    this.broadcast('JOB_RETRY', { jobId, attempts: 1, maxRetries: 10, error: 'Đang chạy bằng mạng máy tính...' });
                }
            }
            else {
                const current = db_1.db.prepare('SELECT attempts, max_retries FROM jobs WHERE id = ?').get(jobId);
                const attempts = (current?.attempts || 0) + 1;
                const maxRetries = current?.max_retries ?? 3;
                if (attempts <= maxRetries) {
                    console.log(`[Dispatcher] Job ${jobId} lỗi (${message}), thử lại ${attempts}/${maxRetries}`);
                    db_1.db.prepare(`
            UPDATE jobs SET status = 'pending', attempts = ?, account_id = NULL, error = ? WHERE id = ?
          `).run(attempts, `Lỗi: ${message}. Đang chuẩn bị thử lại...`, jobId);
                    this.broadcast('JOB_RETRY', { jobId, attempts, maxRetries });
                }
                else {
                    console.log(`[Dispatcher] Job ${jobId} thất bại sau ${attempts} lần: ${message}`);
                    db_1.db.prepare(`
            UPDATE jobs SET status = 'failed', attempts = ?, finished_at = datetime('now'), error = ? WHERE id = ?
          `).run(attempts, `Thất bại sau ${attempts} lần thử: ${message}`, jobId);
                    db_1.db.prepare(`UPDATE studio_cards SET status = 'failed' WHERE job_id = ?`).run(jobId);
                    this.broadcast('JOB_FAILED', { jobId, error: message });
                }
            }
        }
        finally {
            if(entry.timer){clearTimeout(entry.timer);entry.timer=null;}
            entry.finished = true;
            // Release the jobId only now (old runJob has settled). Never delete a successor's entry/active slot.
            if (this.attempts.get(jobId) === entry) {
                this.attempts.delete(jobId);
                // canStartAttempt() blocked any successor until now, so an active slot for this jobId can only be ours.
                this.active.delete(jobId);
            }
            db_1.db.prepare(`
        UPDATE accounts
        SET jobs_running = (
          SELECT COUNT(*) FROM jobs
          WHERE jobs.account_id = accounts.id AND jobs.status = 'running'
        )
      `).run();
            this.broadcastState();
            this.broadcastAccounts();
            if (this.running) {
                setTimeout(() => {
                    if (this.running)
                        this.assignJobs();
                }, 0);
            }
        }
    }
}
exports.dispatcher = new Dispatcher();
