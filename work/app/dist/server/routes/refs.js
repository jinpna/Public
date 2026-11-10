"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateTagFromFilename = generateTagFromFilename;
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const uuid_1 = require("uuid");
const db_1 = require("../db");
const ws_1 = require("../ws");
const paths_1 = require("../paths");
const refManifest_1 = require("../refManifest");
const {listRefs,publishRefs}=require('../referenceLibrary');
const router = (0, express_1.Router)();
const uploadsDir = path_1.default.join(paths_1.DATA_DIR, 'uploads');
router.post('/prepare-inputs',async(req,res)=>{try{res.json(await require('../prepareImageInputs.cjs').prepareImageInputs(req.body,{db:db_1.db,dir:uploadsDir,sharp:require('../../../vendor/upscale/node_modules/sharp')}))}catch(e){res.status(400).json({error:e.message})}});
if (!fs_1.default.existsSync(uploadsDir)) {
    fs_1.default.mkdirSync(uploadsDir, { recursive: true });
}
// Multer storage configuration
const storage = multer_1.default.diskStorage({
    destination: (_req, _file, cb) => {
        cb(null, uploadsDir);
    },
    filename: (_req, file, cb) => {
        const ext = path_1.default.extname(file.originalname);
        const uniqueName = `${Date.now()}-${(0, uuid_1.v4)().substring(0, 8)}${ext}`;
        cb(null, uniqueName);
    }
});
const fileFilter = (_req, file, cb) => {
    const allowedMimes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
    if (allowedMimes.includes(file.mimetype)) {
        cb(null, true);
    }
    else {
        cb(new Error('Chỉ chấp nhận các định dạng ảnh PNG, JPG, JPEG, WEBP'));
    }
};
const upload = (0, multer_1.default)({
    storage,
    limits: { fileSize: 8 * 1024 * 1024 }, // 8MB limit
    fileFilter
});
/**
 * Auto-generate tag from file name:
 * strip extension, lowercase, remove accents, replace spaces/hyphens with single hyphen
 */
function generateTagFromFilename(filename) {
    const baseName = filename.replace(/\.[^/.]+$/, '');
    let tag = baseName
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '') // remove Vietnamese diacritics
        .replace(/[^a-z0-9\s-_]/g, '')
        .trim()
        .replace(/[\s_]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
    if (!tag) {
        tag = `ref-${Date.now().toString(36)}`;
    }
    // Ensure unique initial tag if collision
    let finalTag = tag;
    let counter = 1;
    while (db_1.db.prepare('SELECT id FROM ref_images WHERE tag = ?').get(finalTag)) {
        finalTag = `${tag}-${counter}`;
        counter++;
    }
    return finalTag;
}
// GET /api/refs - list all reference images
router.get('/', (req,res)=>res.json(listRefs({archived:req.query.archived==='1'})));
// POST /api/refs/upload - upload multiple files, return auto-generated tags
router.post('/upload', (req, res) => {
    upload.array('files', 20)(req, res, (err) => {
        if (err) {
            if (err instanceof multer_1.default.MulterError && err.code === 'LIMIT_FILE_SIZE') {
                return res.status(400).json({ error: 'Dung lượng file vượt quá giới hạn 8MB' });
            }
            return res.status(400).json({ error: err.message || 'Lỗi khi tải lên file ảnh' });
        }
        const files = req.files;
        if (!files || files.length === 0) {
            return res.status(400).json({ error: 'Vui lòng chọn ít nhất một file ảnh để tải lên' });
        }
        const uploadedResults = files.map((file) => {
            const suggestedTag = generateTagFromFilename(file.originalname);
            return {
                tempId: (0, uuid_1.v4)(),
                original_name: file.originalname,
                filename: file.filename,
                filepath: file.path,
                size: file.size,
                mime_type: file.mimetype,
                suggested_tag: suggestedTag,
                url: `/uploads/${file.filename}`
            };
        });
        return res.json({
            success: true,
            message: `Đã tải lên ${files.length} ảnh`,
            files: uploadedResults
        });
    });
});
// POST /api/refs/save - save uploaded images with user-edited tags
router.post('/save', (req, res) => {
    try {
        const body = req.body;
        const items = Array.isArray(body) ? body : body.images ? body.images : [body];
        if (!items || items.length === 0) {
            return res.status(400).json({ error: 'Không có dữ liệu ảnh để lưu' });
        }
        // Check tags validity and uniqueness
        for (const item of items) {
            const tag = (item.tag || '').trim();
            if (!tag) {
                return res.status(400).json({ error: 'Tag tham chiếu không được để trống' });
            }
            // Check regex for safe tag: alphanumeric, hyphen, underscore
            if (!/^[a-zA-Z0-9-_]+$/.test(tag)) {
                return res.status(400).json({
                    error: `Tag '${tag}' không hợp lệ. Chỉ chấp nhận chữ cái, số, dấu gạch nối (-) và gạch dưới (_).`
                });
            }
            const existing = db_1.db.prepare('SELECT id FROM ref_images WHERE tag = ?').get(tag);
            if (existing) {
                return res.status(400).json({
                    error: `Tag '${tag}' đã tồn tại trong hệ thống. Vui lòng chọn tag khác.`
                });
            }
        }
        const inserted = [];
        const insertStmt = db_1.db.prepare(`
      INSERT INTO ref_images (id, tag, filename, filepath, size, mime_type, role, lock_notes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `);
        const saveTransaction = db_1.db.transaction(() => {
            for (const item of items) {
                const id = (0, uuid_1.v4)();
                const tag = item.tag.trim();
                const role = refManifest_1.REF_ROLES.includes(item.role) ? item.role : null;
                const lockNotes = typeof item.lock_notes === 'string' ? item.lock_notes.trim() || null : null;
                insertStmt.run(id, tag, item.filename, item.filepath, item.size, item.mime_type, role, lockNotes);
                inserted.push({
                    id,
                    tag,
                    filename: item.filename,
                    filepath: item.filepath,
                    size: item.size,
                    mime_type: item.mime_type,
                    created_at: new Date().toISOString()
                });
            }
        });
        saveTransaction();
        // Broadcast updated refs list
        const allRefs = listRefs();
        const mapped = allRefs.map((img) => ({
            ...img,
            url: `/uploads/${img.filename}`,
            file_url: `/api/refs/${encodeURIComponent(img.tag)}/file`
        }));
        (0, ws_1.broadcast)('REFS_UPDATED', mapped);
        return res.status(201).json({
            success: true,
            message: `Đã lưu thành công ${inserted.length} ảnh tham chiếu`,
            saved: inserted.map((img) => ({
                ...img,
                url: `/uploads/${img.filename}`,
                file_url: `/api/refs/${encodeURIComponent(img.tag)}/file`
            }))
        });
    }
    catch (error) {
        console.error('Error saving ref images:', error);
        return res.status(500).json({ error: 'Đã xảy ra lỗi khi lưu ảnh tham chiếu' });
    }
});
// GET /api/refs/:tag - get single image by tag
router.get('/:tag', (req, res) => {
    try {
        const { tag } = req.params;
        const img = db_1.db.prepare('SELECT * FROM ref_images WHERE tag = ?').get(tag);
        if (!img) {
            return res.status(404).json({ error: `Không tìm thấy ảnh tham chiếu với tag '${tag}'` });
        }
        return res.json({
            ...img,
            url: `/uploads/${img.filename}`,
            file_url: `/api/refs/${encodeURIComponent(img.tag)}/file`
        });
    }
    catch (error) {
        console.error('Error fetching ref image by tag:', error);
        return res.status(500).json({ error: 'Lỗi khi tải thông tin ảnh tham chiếu' });
    }
});
// GET /api/refs/:tag/file - serve image file
router.get('/:tag/file', (req, res) => {
    try {
        const { tag } = req.params;
        const img = db_1.db.prepare('SELECT * FROM ref_images WHERE tag = ?').get(tag);
        if (!img) {
            return res.status(404).json({ error: 'Không tìm thấy ảnh tham chiếu' });
        }
        const resolvedPath = path_1.default.isAbsolute(img.filepath)
            ? img.filepath
            : path_1.default.resolve(paths_1.DATA_DIR, '..', img.filepath);
        if (!fs_1.default.existsSync(resolvedPath)) {
            return res.status(404).json({ error: 'File ảnh không còn tồn tại trên máy chủ' });
        }
        return res.sendFile(resolvedPath);
    }
    catch (error) {
        console.error('Error serving ref image file:', error);
        return res.status(500).json({ error: 'Lỗi khi tải file ảnh tham chiếu' });
    }
});
// DELETE /api/refs/:tag - delete reference image
// PUT /api/refs/:tag/meta { role, lock_notes } - đổi vai trò / ghi chú khóa của ảnh (không đổi tag, không đổi file)
router.put('/:tag/meta', (req, res) => {
    try {
        const { tag } = req.params;
        const img = db_1.db.prepare('SELECT id FROM ref_images WHERE lower(tag) = lower(?)').get(tag);
        if (!img)
            return res.status(404).json({ error: 'Không tìm thấy ảnh tham chiếu' });
        const { role, lock_notes, category } = req.body || {};
        if(category!==undefined){
            if(typeof category!=='string'||!category.trim()||category.trim().length>60)return res.status(400).json({error:'Tên nhóm từ 1 đến 60 ký tự'});
            db_1.db.prepare('UPDATE ref_images SET category = ? WHERE lower(tag) = lower(?)').run(category.trim(),tag);
        }
        if (role !== undefined) {
            if (role !== null && role !== '' && !refManifest_1.REF_ROLES.includes(role)) {
                return res.status(400).json({ error: 'Vai trò không hợp lệ' });
            }
            db_1.db.prepare('UPDATE ref_images SET role = ? WHERE lower(tag) = lower(?)').run(role || null, tag);
        }
        if (lock_notes !== undefined) {
            db_1.db.prepare('UPDATE ref_images SET lock_notes = ? WHERE lower(tag) = lower(?)').run(String(lock_notes || '').trim() || null, tag);
        }
        const allRefs = listRefs();
        (0, ws_1.broadcast)('REFS_UPDATED', allRefs.map((r) => ({ ...r, url: `/uploads/${r.filename}` })));
        return res.json({ success: true });
    }
    catch (error) {
        console.error('Error updating ref meta:', error);
        return res.status(500).json({ error: 'Lỗi khi cập nhật vai trò ảnh' });
    }
});
router.delete('/:tag',(req,res)=>{const row=db_1.db.prepare('SELECT * FROM ref_images WHERE tag=?').get(req.params.tag);if(!row||row.internal_only)return res.status(404).json({error:'Không tìm thấy ảnh trong thư viện'});db_1.db.prepare("UPDATE ref_images SET archived_at=COALESCE(archived_at,datetime('now')) WHERE id=?").run(row.id);publishRefs();res.json({success:true,recoverable:true,message:'Đã chuyển ảnh vào thùng rác. Các tác vụ đã nhận ảnh vẫn được giữ đầu vào.'})});
router.post('/:tag/restore',(req,res)=>{const row=db_1.db.prepare('SELECT * FROM ref_images WHERE tag=? AND internal_only=0').get(req.params.tag);if(!row)return res.status(404).json({error:'Không tìm thấy ảnh'});db_1.db.prepare('UPDATE ref_images SET archived_at=NULL WHERE id=?').run(row.id);publishRefs();res.json({success:true})});
router.post('/refine-crop',async(req,res)=>{try{res.json(await require('../refineCrop.cjs').createRefineCrop(req.body.tag,req.body.region))}catch(error){res.status(422).json({error:error.message||'Không tạo được ảnh cận cảnh'})}});
exports.default = router;
