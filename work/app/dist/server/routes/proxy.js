"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = require("../db");
const ws_1 = require("../ws");
const accounts_1 = require("./accounts");
const licenseManager_1 = require("../licenseManager");
const proxyManager_1 = require("../proxyManager");
const router = (0, express_1.Router)();
let cachedProxyCheckResult = null;
// GET /api/proxy/config - Lấy cấu hình proxy và danh sách
router.get('/config', (_req, res) => {
    try {
        const modeRow = db_1.db.prepare(`SELECT value FROM settings WHERE key = 'proxy_mode'`).get();
        const rawRow = db_1.db.prepare(`SELECT value FROM settings WHERE key = 'proxy_raw_list'`).get();
        const slotsRow = db_1.db.prepare(`SELECT value FROM settings WHERE key = 'proxy_shared_slots'`).get();
        const autoRow = db_1.db.prepare(`SELECT value FROM settings WHERE key = 'proxy_auto_rotate'`).get();
        const rawList = rawRow?.value || '';
        const lines = rawList
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter((l) => l && !l.startsWith('#'));
        let rotatingCount = 0;
        let staticCount = 0;
        for (const l of lines) {
            const p = (0, proxyManager_1.parseProxyLine)(l);
            if (p) {
                if (p.type === 'rotating')
                    rotatingCount++;
                else
                    staticCount++;
            }
        }
        if (!cachedProxyCheckResult && lines.length > 0) {
            // Tự động tạo kết quả hiển thị từ trạng thái proxy đã gán ở các nick
            const accWithProxy = db_1.db.prepare(`SELECT proxy, proxy_status, proxy_ip FROM accounts WHERE proxy IS NOT NULL LIMIT 1`).get();
            if (accWithProxy?.proxy) {
                const isLive = accWithProxy.proxy_status === 'live';
                cachedProxyCheckResult = {
                    total: lines.length,
                    live: isLive ? lines.length : 0,
                    limitReached: accWithProxy.proxy_status === 'limit_reached' ? 1 : 0,
                    dead: accWithProxy.proxy_status === 'dead' ? 1 : 0,
                    results: lines.map((l) => ({
                        raw: l,
                        status: accWithProxy.proxy_status || 'live',
                        ok: isLive,
                        ip: accWithProxy.proxy_ip?.split(':')[0],
                        port: accWithProxy.proxy_ip?.split(':')[1] ? Number(accWithProxy.proxy_ip.split(':')[1]) : undefined,
                        message: isLive ? 'Đang hoạt động (Đã kết nối)' : 'Sẵn sàng',
                        checkedAt: new Date().toISOString(),
                    }))
                };
            }
        }
        return res.json({
            proxyMode: modeRow?.value || 'key_per_job',
            rawList,
            sharedSlots: Number(slotsRow?.value) || 1,
            autoRotate: autoRow?.value !== '0',
            totalCount: lines.length,
            rotatingCount,
            staticCount,
            lastCheckResult: cachedProxyCheckResult,
        });
    }
    catch (err) {
        return res.status(500).json({ error: err.message || 'Lỗi khi tải cấu hình proxy' });
    }
});
// POST /api/proxy/config - Lưu cấu hình proxy
router.post('/config', (req, res) => {
    try {
        if (licenseManager_1.licenseManager.isFeatureBlocked('proxy')) {
            return res.status(403).json({ error: 'Tính năng Proxy chỉ dành cho bản Bản quyền (99k/tháng). Bản dùng thử miễn phí sử dụng mạng máy tính trực tiếp.' });
        }
        const { proxyMode, rawList, sharedSlots, autoRotate } = req.body;
        const upsertSetting = db_1.db.prepare(`
      INSERT INTO settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `);
        if (proxyMode !== undefined)
            upsertSetting.run('proxy_mode', String(proxyMode));
        if (rawList !== undefined)
            upsertSetting.run('proxy_raw_list', String(rawList));
        if (sharedSlots !== undefined)
            upsertSetting.run('proxy_shared_slots', String(sharedSlots));
        if (autoRotate !== undefined)
            upsertSetting.run('proxy_auto_rotate', autoRotate ? '1' : '0');
        (0, ws_1.broadcast)('PROXY_CONFIG_UPDATED', {
            proxyMode,
            rawList,
            sharedSlots,
            autoRotate,
        });
        return res.json({ success: true, message: 'Đã lưu cấu hình proxy' });
    }
    catch (err) {
        return res.status(500).json({ error: err.message || 'Lỗi khi lưu cấu hình proxy' });
    }
});
// POST /api/proxy/add - Thêm mới proxy vào kho (Lưu dồn, không đụng vào proxy cũ)
router.post('/add', async (req, res) => {
    try {
        if (licenseManager_1.licenseManager.isFeatureBlocked('proxy')) {
            return res.status(403).json({ error: 'Tính năng Proxy chỉ dành cho bản Bản quyền (99k/tháng). Bản dùng thử miễn phí sử dụng mạng máy tính trực tiếp.' });
        }
        const { newLines, checkNow = true } = req.body;
        const inputLines = String(newLines || '')
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter((l) => l && !l.startsWith('#'));
        if (inputLines.length === 0) {
            return res.status(400).json({ error: 'Chưa nhập dòng proxy nào để thêm' });
        }
        // Lấy kho cũ
        const rawRow = db_1.db.prepare(`SELECT value FROM settings WHERE key = 'proxy_raw_list'`).get();
        const existingLines = (rawRow?.value || '')
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter((l) => l && !l.startsWith('#'));
        // Lọc các dòng mới chưa có trong kho
        const newlyAdded = [];
        for (const line of inputLines) {
            const parsed = (0, proxyManager_1.parseProxyLine)(line);
            if (parsed && !existingLines.includes(line)) {
                existingLines.push(line);
                newlyAdded.push(line);
            }
        }
        if (newlyAdded.length === 0) {
            return res.json({
                success: true,
                message: 'Các proxy này đã có sẵn trong kho, không thêm trùng lặp.',
                addedCount: 0,
                totalCount: existingLines.length,
                rawList: existingLines.join('\n'),
            });
        }
        // Cập nhật lại kho
        const updatedRaw = existingLines.join('\n');
        db_1.db.prepare(`
      INSERT INTO settings (key, value) VALUES ('proxy_raw_list', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(updatedRaw);
        // Kiểm tra kết nối CHỈ RIÊNG các proxy mới vừa thêm (Tuyệt đối không đụng vào proxy cũ đang chạy!)
        let newCheckResults = [];
        if (checkNow) {
            newCheckResults = await Promise.all(newlyAdded.map((p) => (0, proxyManager_1.checkSingleProxy)(p).catch(() => null)));
        }
        (0, ws_1.broadcast)('PROXY_CONFIG_UPDATED', {
            rawList: updatedRaw,
            totalCount: existingLines.length,
        });
        // Tự động phân phối lại ngay cho các nick đang bị lỗi proxy hoặc thiếu proxy
        const { autoReassignFailingAccounts } = require('../proxyManager');
        setTimeout(() => {
            autoReassignFailingAccounts().catch((e) => console.error('[ProxyRoute] Auto-reassign error:', e.message));
        }, 100);
        return res.json({
            success: true,
            message: `Đã thêm ${newlyAdded.length} proxy mới vào kho thành công!`,
            addedCount: newlyAdded.length,
            totalCount: existingLines.length,
            rawList: updatedRaw,
            newResults: newCheckResults.filter(Boolean),
        });
    }
    catch (err) {
        return res.status(500).json({ error: err.message || 'Lỗi khi thêm proxy mới' });
    }
});
// POST /api/proxy/delete - Xóa 1 proxy khỏi kho
router.post('/delete', (req, res) => {
    try {
        const { proxyLine } = req.body;
        if (!proxyLine)
            return res.status(400).json({ error: 'Thiếu dòng proxy cần xóa' });
        const rawRow = db_1.db.prepare(`SELECT value FROM settings WHERE key = 'proxy_raw_list'`).get();
        const existingLines = (rawRow?.value || '')
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter((l) => l && l !== proxyLine.trim());
        const updatedRaw = existingLines.join('\n');
        db_1.db.prepare(`
      INSERT INTO settings (key, value) VALUES ('proxy_raw_list', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(updatedRaw);
        (0, ws_1.broadcast)('PROXY_CONFIG_UPDATED', {
            rawList: updatedRaw,
            totalCount: existingLines.length,
        });
        return res.json({ success: true, message: 'Đã xóa proxy khỏi kho', rawList: updatedRaw, totalCount: existingLines.length });
    }
    catch (err) {
        return res.status(500).json({ error: err.message || 'Lỗi khi xóa proxy' });
    }
});
// POST /api/proxy/check - Kiểm tra toàn bộ proxy
router.post('/check', async (req, res) => {
    try {
        let { rawList } = req.body;
        if (rawList === undefined) {
            const rawRow = db_1.db.prepare(`SELECT value FROM settings WHERE key = 'proxy_raw_list'`).get();
            rawList = rawRow?.value || '';
        }
        const lines = String(rawList)
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter((l) => l && !l.startsWith('#'));
        if (lines.length === 0) {
            return res.json({ total: 0, live: 0, limitReached: 0, dead: 0, results: [] });
        }
        const result = await (0, proxyManager_1.checkAllProxies)(lines);
        cachedProxyCheckResult = result;
        return res.json(result);
    }
    catch (err) {
        return res.status(500).json({ error: err.message || 'Lỗi khi kiểm tra proxy' });
    }
});
// POST /api/proxy/check-single - Kiểm tra 1 proxy cụ thể
router.post('/check-single', async (req, res) => {
    try {
        const { proxy } = req.body;
        if (!proxy || typeof proxy !== 'string') {
            return res.status(400).json({ error: 'Thiếu thông tin proxy để kiểm tra' });
        }
        const result = await (0, proxyManager_1.checkSingleProxy)(proxy);
        return res.json(result);
    }
    catch (err) {
        return res.status(500).json({ error: err.message || 'Lỗi khi kiểm tra proxy' });
    }
});
// POST /api/proxy/assign - Tự động phân phối proxy cho các tài khoản
router.post('/assign', async (req, res) => {
    try {
        if (licenseManager_1.licenseManager.isFeatureBlocked('proxy')) {
            return res.status(403).json({ error: 'Tính năng Proxy chỉ dành cho bản Bản quyền (99k/tháng). Bản dùng thử miễn phí sử dụng mạng máy tính trực tiếp.' });
        }
        const { mode = 'sequential', overwriteAll = true, maxPerProxy = 1 } = req.body;
        const result = await (0, proxyManager_1.assignProxiesToAccounts)({ mode, overwriteAll, maxPerProxy });
        return res.json({
            success: true,
            message: `Đã phân phối proxy cho ${result.assignedCount} tài khoản (${mode === 'random' ? 'Ngẫu nhiên' : 'Tuần tự'})`,
            assignedCount: result.assignedCount,
            accounts: (0, accounts_1.getSanitizedAccounts)(),
        });
    }
    catch (err) {
        return res.status(500).json({ error: err.message || 'Lỗi khi phân phối proxy' });
    }
});
// POST /api/proxy/clear - Xóa sạch proxy đã gán cho tài khoản
router.post('/clear', (_req, res) => {
    try {
        (0, proxyManager_1.clearAssignedProxies)();
        return res.json({
            success: true,
            message: 'Đã xóa toàn bộ proxy đã gán cho các tài khoản',
            accounts: (0, accounts_1.getSanitizedAccounts)(),
        });
    }
    catch (err) {
        return res.status(500).json({ error: err.message || 'Lỗi khi xóa proxy gán' });
    }
});
// PUT /api/proxy/account/:id - Gán hoặc sửa proxy cho 1 tài khoản cụ thể
router.put('/account/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { proxy } = req.body;
        const acc = db_1.db.prepare(`SELECT * FROM accounts WHERE id = ?`).get(id);
        if (!acc) {
            return res.status(404).json({ error: 'Không tìm thấy tài khoản' });
        }
        if (!proxy || !proxy.trim()) {
            // Xóa proxy của tài khoản này
            db_1.db.prepare(`
        UPDATE accounts
        SET proxy = NULL,
            proxy_status = 'none',
            proxy_ip = NULL,
            proxy_info = NULL,
            proxy_limit_msg = NULL
        WHERE id = ?
      `).run(id);
            const accounts = (0, accounts_1.getSanitizedAccounts)();
            (0, ws_1.broadcast)('ACCOUNTS_UPDATED', accounts);
            return res.json({ success: true, message: 'Đã xóa proxy của tài khoản' });
        }
        // Có nhập proxy mới -> kiểm tra ngay
        const check = await (0, proxyManager_1.checkSingleProxy)(proxy.trim());
        db_1.db.prepare(`
      UPDATE accounts
      SET proxy = ?,
          proxy_status = ?,
          proxy_ip = ?,
          proxy_limit_msg = ?
      WHERE id = ?
    `).run(proxy.trim(), check.status, check.ip ? `${check.ip}${check.port ? ':' + check.port : ''}` : null, check.status === 'limit_reached' ? check.message : null, id);
        const accounts = (0, accounts_1.getSanitizedAccounts)();
        (0, ws_1.broadcast)('ACCOUNTS_UPDATED', accounts);
        return res.json({
            success: true,
            message: check.ok ? 'Đã gán proxy thành công' : `Đã lưu: ${check.message}`,
            check,
            account: accounts.find((a) => a.id === id),
        });
    }
    catch (err) {
        return res.status(500).json({ error: err.message || 'Lỗi khi cập nhật proxy tài khoản' });
    }
});
// POST /api/proxy/account/:id/rotate - Ép đổi IP ngay cho tài khoản
router.post('/account/:id/rotate', async (req, res) => {
    try {
        const { id } = req.params;
        const acc = db_1.db.prepare(`SELECT * FROM accounts WHERE id = ?`).get(id);
        if (!acc || !acc.proxy) {
            return res.status(400).json({ error: 'Tài khoản chưa có proxy để xoay IP' });
        }
        const check = await (0, proxyManager_1.checkSingleProxy)(acc.proxy, true);
        db_1.db.prepare(`
      UPDATE accounts
      SET proxy_status = ?,
          proxy_ip = ?,
          proxy_limit_msg = ?
      WHERE id = ?
    `).run(check.status, check.ip ? `${check.ip}${check.port ? ':' + check.port : ''}` : null, check.status === 'limit_reached' ? check.message : null, id);
        const accounts = (0, accounts_1.getSanitizedAccounts)();
        (0, ws_1.broadcast)('ACCOUNTS_UPDATED', accounts);
        return res.json({
            success: check.ok,
            message: check.ok ? `Đã đổi sang IP mới: ${check.ip}:${check.port}` : check.message,
            check,
        });
    }
    catch (err) {
        return res.status(500).json({ error: err.message || 'Lỗi khi xoay IP proxy' });
    }
});
exports.default = router;
