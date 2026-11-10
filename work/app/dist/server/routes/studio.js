"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const crypto_1 = __importDefault(require("crypto"));
const uuid_1 = require("uuid");
const db_1 = require("../db");
const ws_1 = require("../ws");
const dispatcher_1 = require("../dispatcher");
const paths_1 = require("../paths");
const router = (0, express_1.Router)();
const uploadsDir = path_1.default.join(paths_1.DATA_DIR, 'uploads');
if (!fs_1.default.existsSync(uploadsDir)) {
    fs_1.default.mkdirSync(uploadsDir, { recursive: true });
}
const storage = multer_1.default.diskStorage({
    destination: (_req, _file, cb) => {
        cb(null, uploadsDir);
    },
    filename: (_req, file, cb) => {
        const ext = path_1.default.extname(file.originalname);
        const uniqueName = `studio-${Date.now()}-${(0, uuid_1.v4)().substring(0, 8)}${ext}`;
        cb(null, uniqueName);
    }
});
const upload = (0, multer_1.default)({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});
// GET /api/studio/cards - list all studio cards
router.get('/cards', (_req, res) => {
    try {
        const cards = db_1.db.prepare('SELECT * FROM studio_cards ORDER BY created_at DESC').all();
        const formatted = cards.map((c) => {
            let tags = [];
            try {
                tags = JSON.parse(c.ref_tags || '[]');
            }
            catch {
                tags = [];
            }
            return {
                ...c,
                tags
            };
        });
        return res.json(formatted);
    }
    catch (error) {
        console.error('Error fetching studio cards:', error);
        return res.status(500).json({ error: 'Không thể tải danh sách studio cards' });
    }
});
// POST /api/studio/cards - add card (with image upload via multer)
router.post('/cards', (req, res) => {
    upload.single('image')(req, res, (err) => {
        if (err) {
            return res.status(400).json({ error: err.message || 'Lỗi khi tải ảnh cho studio card' });
        }
        try {
            const { prompt = '', ref_tags, position_x = 100, position_y = 100, image_url: customImageUrl } = req.body;
            let imagePath = null;
            let imageUrl = null;
            if (req.file) {
                imagePath = req.file.path;
                imageUrl = `/uploads/${req.file.filename}`;
            }
            else if (customImageUrl) {
                imageUrl = String(customImageUrl).trim();
            }
            let tagsArray = [];
            if (Array.isArray(ref_tags)) {
                tagsArray = ref_tags;
            }
            else if (typeof ref_tags === 'string') {
                try {
                    tagsArray = JSON.parse(ref_tags);
                }
                catch {
                    tagsArray = ref_tags.split(',').map((t) => t.trim()).filter(Boolean);
                }
            }
            const id = (0, uuid_1.v4)();
            const posX = parseFloat(position_x) || 100;
            const posY = parseFloat(position_y) || 100;
            db_1.db.prepare(`
        INSERT INTO studio_cards (
          id, image_path, image_url, prompt, ref_tags, status, progress, position_x, position_y, created_at
        ) VALUES (?, ?, ?, ?, ?, 'idle', 0, ?, ?, datetime('now'))
      `).run(id, imagePath, imageUrl, prompt.trim(), JSON.stringify(tagsArray), posX, posY);
            const created = db_1.db.prepare('SELECT * FROM studio_cards WHERE id = ?').get(id);
            (0, ws_1.broadcast)('STUDIO_UPDATED', { action: 'create', card: created });
            return res.status(201).json({
                success: true,
                message: 'Tạo studio card thành công',
                card: {
                    ...created,
                    tags: tagsArray
                }
            });
        }
        catch (error) {
            console.error('Error creating studio card:', error);
            return res.status(500).json({ error: 'Lỗi khi tạo studio card mới' });
        }
    });
});
// PUT /api/studio/cards/:id - update card
router.put('/cards/:id', (req, res) => {
    try {
        const { id } = req.params;
        const card = db_1.db.prepare('SELECT * FROM studio_cards WHERE id = ?').get(id);
        if (!card) {
            return res.status(404).json({ error: 'Không tìm thấy studio card' });
        }
        const { prompt, ref_tags, position_x, position_y, status } = req.body;
        const newPrompt = prompt !== undefined ? String(prompt).trim() : card.prompt;
        const newPosX = position_x !== undefined ? parseFloat(position_x) : card.position_x;
        const newPosY = position_y !== undefined ? parseFloat(position_y) : card.position_y;
        const newStatus = status !== undefined ? status : card.status;
        let newTagsStr = card.ref_tags;
        if (ref_tags !== undefined) {
            if (Array.isArray(ref_tags)) {
                newTagsStr = JSON.stringify(ref_tags);
            }
            else if (typeof ref_tags === 'string') {
                newTagsStr = ref_tags;
            }
        }
        db_1.db.prepare(`
      UPDATE studio_cards
      SET prompt = ?,
          ref_tags = ?,
          position_x = ?,
          position_y = ?,
          status = ?
      WHERE id = ?
    `).run(newPrompt, newTagsStr, newPosX, newPosY, newStatus, id);
        const updated = db_1.db.prepare('SELECT * FROM studio_cards WHERE id = ?').get(id);
        (0, ws_1.broadcast)('STUDIO_UPDATED', { action: 'update', card: updated });
        return res.json({
            success: true,
            message: 'Cập nhật studio card thành công',
            card: updated
        });
    }
    catch (error) {
        console.error('Error updating studio card:', error);
        return res.status(500).json({ error: 'Lỗi khi cập nhật studio card' });
    }
});
// DELETE /api/studio/cards/:id - delete card
router.delete('/cards/:id', (req, res) => {
    try {
        const { id } = req.params;
        const card = db_1.db.prepare('SELECT * FROM studio_cards WHERE id = ?').get(id);
        if (!card) {
            return res.status(404).json({ error: 'Không tìm thấy studio card để xóa' });
        }
        // Unlink or delete uploaded image if local
        if (card.image_path && fs_1.default.existsSync(card.image_path)) {
            try {
                fs_1.default.unlinkSync(card.image_path);
            }
            catch (err) {
                console.warn('Could not delete studio card file:', err);
            }
        }
        db_1.db.prepare('DELETE FROM studio_cards WHERE id = ?').run(id);
        (0, ws_1.broadcast)('STUDIO_UPDATED', { action: 'delete', cardId: id });
        return res.json({
            success: true,
            message: 'Đã xóa studio card thành công'
        });
    }
    catch (error) {
        console.error('Error deleting studio card:', error);
        return res.status(500).json({ error: 'Lỗi khi xóa studio card' });
    }
});
// POST /api/studio/generate-all - generate videos for all idle/failed cards
router.post('/generate-all', (_req, res) => {
    try {
        const cards = db_1.db.prepare(`
      SELECT * FROM studio_cards
      WHERE status IN ('idle', 'failed')
    `).all();
        if (cards.length === 0) {
            return res.json({
                success: true,
                count: 0,
                message: 'Không có thẻ nào ở trạng thái chờ để tạo video'
            });
        }
        const retrySetting = db_1.db.prepare(`SELECT value FROM settings WHERE key = 'retry_count'`).get();
        const timeoutSetting = db_1.db.prepare(`SELECT value FROM settings WHERE key = 'timeout_minutes'`).get();
        const maxRetries = retrySetting ? parseInt(retrySetting.value, 10) : 2;
        const timeoutMinutes = timeoutSetting ? parseInt(timeoutSetting.value, 10) : 15;
        const insertJobStmt = db_1.db.prepare(`
      INSERT INTO jobs (
        id, prompt, ref_tags, status, progress, duration, ratio,
        attempts, max_retries, timeout_minutes, batch_id, sort_order, created_at
      ) VALUES (?, ?, ?, 'pending', 0, 10, '9:16', 0, ?, ?, ?, ?, datetime('now'))
    `);
        const updateCardStmt = db_1.db.prepare(`
      UPDATE studio_cards
      SET job_id = ?, status = 'running', progress = 0
      WHERE id = ?
    `);
        const batchId = `studio_batch_${crypto_1.default.randomBytes(4).toString('hex')}`;
        const batchTx = db_1.db.transaction(() => {
            cards.forEach((card, index) => {
                const taskId = `task_${crypto_1.default.randomBytes(4).toString('hex')}`;
                insertJobStmt.run(taskId, card.prompt || 'Studio AI Video Generation', card.ref_tags || '[]', maxRetries, timeoutMinutes, batchId, index);
                updateCardStmt.run(taskId, card.id);
            });
        });
        batchTx();
        if (!dispatcher_1.dispatcher.isRunning()) {
            dispatcher_1.dispatcher.start(ws_1.broadcast);
        }
        else {
            dispatcher_1.dispatcher.trigger();
        }
        const updatedCards = db_1.db.prepare('SELECT * FROM studio_cards ORDER BY created_at DESC').all();
        (0, ws_1.broadcast)('STUDIO_UPDATED', { action: 'batch_start', cards: updatedCards });
        return res.json({
            success: true,
            count: cards.length,
            message: `Đã đưa ${cards.length} thẻ studio vào hàng đợi tạo video`
        });
    }
    catch (error) {
        console.error('Error generating studio videos:', error);
        return res.status(500).json({ error: 'Lỗi khi kích hoạt tạo video cho studio cards' });
    }
});
exports.default = router;
