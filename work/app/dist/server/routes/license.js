"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const licenseManager_1 = require("../licenseManager");
const router = (0, express_1.Router)();
// GET /api/license/status - Lấy trạng thái bản quyền hiện tại
router.get('/status', async (_req, res) => {
    try {
        const license = licenseManager_1.licenseManager.getLicense();
        return res.json(license);
    }
    catch (err) {
        return res.status(500).json({ error: err.message || 'Lỗi khi kiểm tra trạng thái bản quyền' });
    }
});
// POST /api/license/login/start - Bắt đầu quy trình đăng nhập bằng Gmail (Device Flow)
router.post('/login/start', async (_req, res) => {
    try {
        const result = await licenseManager_1.licenseManager.startDeviceLogin();
        return res.json(result);
    }
    catch (err) {
        return res.status(500).json({ error: err.message || 'Lỗi khi khởi tạo đăng nhập' });
    }
});
// POST /api/license/login/poll - Kiểm tra xem người dùng đã bấm Cho phép trên trình duyệt chưa
router.post('/login/poll', async (req, res) => {
    try {
        const { device_code } = req.body;
        if (!device_code) {
            return res.status(400).json({ error: 'Thiếu mã thiết bị (device_code)' });
        }
        const result = await licenseManager_1.licenseManager.pollDeviceLogin(device_code);
        return res.json(result);
    }
    catch (err) {
        return res.status(500).json({ error: err.message || 'Lỗi khi kiểm tra đăng nhập' });
    }
});
// POST /api/license/check - Kiểm tra lại hạn dùng từ máy chủ (sau khi thanh toán gia hạn)
router.post('/check', async (_req, res) => {
    try {
        const license = await licenseManager_1.licenseManager.checkLicenseOnline();
        return res.json(license);
    }
    catch (err) {
        return res.status(500).json({ error: err.message || 'Lỗi khi kiểm tra bản quyền' });
    }
});
// POST /api/license/logout - Đăng xuất
router.post('/logout', async (_req, res) => {
    try {
        await licenseManager_1.licenseManager.logout();
        return res.json({ success: true, message: 'Đã đăng xuất thành công' });
    }
    catch (err) {
        return res.status(500).json({ error: err.message || 'Lỗi khi đăng xuất' });
    }
});
// POST /api/license/open-url - Mở link ngoài trình duyệt
router.post('/open-url', (req, res) => {
    try {
        const { url } = req.body;
        if (url && typeof url === 'string') {
            (0, licenseManager_1.openExternalUrl)(url);
            return res.json({ success: true });
        }
        return res.status(400).json({ error: 'Thiếu URL hợp lệ' });
    }
    catch (err) {
        return res.status(500).json({ error: err.message || 'Không thể mở liên kết' });
    }
});
exports.default = router;
