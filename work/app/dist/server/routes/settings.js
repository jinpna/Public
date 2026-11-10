"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAllSettings = getAllSettings;
const express_1 = require("express");
const db_1 = require("../db");
const ws_1 = require("../ws");
const dispatcher_1 = require("../dispatcher");
const router = (0, express_1.Router)();
function getAllSettings() {
    const rows = db_1.db.prepare('SELECT key, value FROM settings').all();
    const settings = {};
    for (const row of rows) {
        if (['concurrency', 'retry_count', 'timeout_minutes', 'paste_auto_run'].includes(row.key)) {
            settings[row.key] = parseInt(row.value, 10);
        }
        else {
            settings[row.key] = row.value;
        }
    }
    // Ensure default fallbacks if missing
    if (settings.concurrency === undefined)
        settings.concurrency = 3;
    if (settings.paste_auto_run === undefined)
        settings.paste_auto_run = 1;
    if (settings.retry_count === undefined)
        settings.retry_count = 2;
    if (settings.timeout_minutes === undefined)
        settings.timeout_minutes = 15;
    return settings;
}
// GET /api/settings - get all settings
router.get('/', (_req, res) => {
    try {
        const settings = getAllSettings();
        return res.json(settings);
    }
    catch (error) {
        console.error('Error fetching settings:', error);
        return res.status(500).json({ error: 'Không thể tải thông tin cấu hình' });
    }
});
// PUT /api/settings - update settings
router.put('/', (req, res) => {
    try {
        const updates = req.body;
        if (!updates || typeof updates !== 'object') {
            return res.status(400).json({ error: 'Dữ liệu cấu hình gửi lên không hợp lệ' });
        }
        const upsertStmt = db_1.db.prepare(`
      INSERT INTO settings (key, value)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `);
        const updateTransaction = db_1.db.transaction(() => {
            for (const [key, rawVal] of Object.entries(updates)) {
                if (rawVal === undefined || rawVal === null)
                    continue;
                let strVal = String(rawVal);
                if (key === 'concurrency') {
                    const num = parseInt(strVal, 10);
                    if (isNaN(num) || num < 1) {
                        throw new Error('Số luồng xử lý đồng thời (concurrency) phải lớn hơn hoặc bằng 1');
                    }
                    strVal = String(num);
                }
                else if (key === 'retry_count') {
                    const num = parseInt(strVal, 10);
                    if (isNaN(num) || num < 0) {
                        throw new Error('Số lần thử lại (retry_count) phải lớn hơn hoặc bằng 0');
                    }
                    strVal = String(num);
                }
                else if (key === 'timeout_minutes') {
                    const num = parseInt(strVal, 10);
                    if (isNaN(num) || num < 1) {
                        throw new Error('Thời gian chờ tối đa (timeout_minutes) phải lớn hơn hoặc bằng 1');
                    }
                    strVal = String(num);
                }
                else if (key === 'browser_choice') {
                    if (!['auto', 'chrome', 'edge'].includes(strVal))
                        throw new Error('Trình duyệt chỉ được là auto, chrome hoặc edge');
                }
                else if (key === 'paste_auto_run') {
                    strVal = strVal === '1' || strVal === 'true' ? '1' : '0';
                }
                upsertStmt.run(key, strVal);
            }
        });
        updateTransaction();
        // Đổi trình duyệt: đóng các trình duyệt ẩn đang mở (profile Chrome và Edge khác nhau), lần chạy sau mở bằng trình duyệt mới
        if (updates.browser_choice !== undefined) {
            require('../museWorker').museWorker.closeAll().catch(() => { });
            dispatcher_1.dispatcher.reconcileProfilesWithBrowser();
        }
        const currentSettings = getAllSettings();
        (0, ws_1.broadcast)('SETTINGS_UPDATED', currentSettings);
        // Trigger dispatcher in case concurrency increased
        dispatcher_1.dispatcher.trigger();
        return res.json({
            success: true,
            message: 'Cập nhật cấu hình hệ thống thành công',
            settings: currentSettings
        });
    }
    catch (error) {
        console.error('Error updating settings:', error);
        return res.status(400).json({
            error: error.message || 'Lỗi khi cập nhật cấu hình hệ thống'
        });
    }
});
exports.default = router;
