"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSanitizedAccounts = getSanitizedAccounts;
const express_1 = require("express");
const uuid_1 = require("uuid");
const db_1 = require("../db");
const crypto_1 = require("../crypto");
const ws_1 = require("../ws");
const dispatcher_1 = require("../dispatcher");
const browserManager_1 = require("../browserManager");
const museWorker_1 = require("../museWorker");
const fs_1 = __importDefault(require("fs"));
const router = (0, express_1.Router)();
function getSanitizedAccounts() {
    const rows = db_1.db.prepare(`
    SELECT id, identifier, enabled, status, session_status, jobs_running, last_health_check, created_at,
           credentials_encrypted, paused_until, proxy, proxy_status, proxy_ip, proxy_info, proxy_limit_msg,
           usage_percent, usage_reset_date, usage_tokens_left, usage_limit_reached, usage_checked_at
    FROM accounts
    ORDER BY created_at DESC
  `).all();
    return rows.map((r) => {
        let hasCookie = false;
        let authType = 'token';
        if (r.credentials_encrypted) {
            try {
                const decrypted = (0, crypto_1.decrypt)(r.credentials_encrypted);
                const parsed = JSON.parse(decrypted);
                if (parsed.cookie || parsed.type === 'cookie') {
                    hasCookie = true;
                    authType = 'cookie';
                }
                else if (parsed.password || parsed.username) {
                    authType = 'password';
                }
            }
            catch {
                // ignore
            }
        }
        const { credentials_encrypted, ...rest } = r;
        return {
            ...rest,
            hasCookie,
            authType,
        };
    });
}
// GET /api/accounts - list all accounts (credentials never returned)
router.get('/', (_req, res) => {
    try {
        const accounts = getSanitizedAccounts();
        return res.json(accounts);
    }
    catch (error) {
        console.error('Error fetching accounts:', error);
        return res.status(500).json({ error: 'Không thể tải danh sách tài khoản' });
    }
});
// POST /api/accounts - add account (supports Cookie, Browser Login, or Credentials)
router.post('/', (req, res) => {
    try {
        const { identifier, credentials, username, password, cookie, loginType } = req.body;
        const rawIdentifier = (identifier || username || '').trim();
        if (!rawIdentifier) {
            return res.status(400).json({ error: 'Tên định danh hoặc email không được để trống' });
        }
        let credString = '';
        let isCookie = false;
        if (cookie && typeof cookie === 'string' && cookie.trim()) {
            const cookies = (0, museWorker_1.parseCookieInput)(cookie);
            if (cookies.length === 0) {
                console.warn(`[Accounts] Cookie dán vào không đọc được (dài ${cookie.length} ký tự, bắt đầu bằng "${cookie.trim().slice(0, 1)}")`);
                return res.status(400).json({ error: 'Không đọc được cookie nào. Hãy xuất từ Cookie-Editor dạng JSON hoặc Header String (tên=giá_trị; ...)' });
            }
            credString = JSON.stringify({
                type: 'cookie',
                cookies,
                loginType: loginType || 'cookie',
                updatedAt: new Date().toISOString(),
            });
            isCookie = true;
        }
        else {
            return res.status(400).json({ error: 'Hãy dán cookie Muse, hoặc dùng nút "Đăng nhập" để mở trình duyệt' });
        }
        const maskedId = (0, crypto_1.maskIdentifier)(rawIdentifier);
        const encryptedCreds = (0, crypto_1.encrypt)(credString);
        const accountId = (0, uuid_1.v4)();
        // Tự động gán proxy nếu có danh sách proxy trong hệ thống
        const rawProxyRow = db_1.db.prepare(`SELECT value FROM settings WHERE key = 'proxy_raw_list'`).get();
        const rawList = (rawProxyRow?.value || '').split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'));
        let autoProxy = null;
        if (rawList.length > 0) {
            const existingAccountsCount = db_1.db.prepare(`SELECT COUNT(*) as c FROM accounts`).get().c;
            autoProxy = rawList[existingAccountsCount % rawList.length];
        }
        db_1.db.prepare(`
      INSERT INTO accounts (id, identifier, credentials_encrypted, enabled, status, session_status, jobs_running, last_health_check, proxy, proxy_status)
      VALUES (?, ?, ?, 1, 'offline', 'Đang kiểm tra phiên...', 0, NULL, ?, ?)
    `).run(accountId, maskedId, encryptedCreds, autoProxy, autoProxy ? 'testing' : null);
        const accounts = getSanitizedAccounts();
        (0, ws_1.broadcast)('ACCOUNTS_UPDATED', accounts);
        if (isCookie)
            dispatcher_1.dispatcher.checkAccount(accountId).catch((e) => console.error('Health check error:', e));
        const created = getSanitizedAccounts().find(a => a.id === accountId);
        return res.status(201).json({
            success: true,
            message: 'Thêm tài khoản thành công',
            account: created
        });
    }
    catch (error) {
        console.error('Error creating account:', error);
        return res.status(500).json({ error: 'Đã xảy ra lỗi khi thêm tài khoản mới' });
    }
});
// PUT /api/accounts/:id/cookie - update cookie for existing account
router.put('/:id/cookie', (req, res) => {
    try {
        const { id } = req.params;
        const { cookie } = req.body;
        if (!cookie || typeof cookie !== 'string' || !cookie.trim()) {
            return res.status(400).json({ error: 'Nội dung cookie không được để trống' });
        }
        const existing = db_1.db.prepare('SELECT * FROM accounts WHERE id = ?').get(id);
        if (!existing) {
            return res.status(404).json({ error: 'Không tìm thấy tài khoản cần cập nhật' });
        }
        const cookies = (0, museWorker_1.parseCookieInput)(cookie);
        if (cookies.length === 0) {
            return res.status(400).json({ error: 'Không đọc được cookie nào từ nội dung đã dán' });
        }
        const credString = JSON.stringify({
            type: 'cookie',
            cookies,
            loginType: 'cookie',
            updatedAt: new Date().toISOString(),
        });
        const encryptedCreds = (0, crypto_1.encrypt)(credString);
        db_1.db.prepare(`
      UPDATE accounts
      SET credentials_encrypted = ?,
          status = 'offline',
          session_status = 'Đang kiểm tra phiên...'
      WHERE id = ?
    `).run(encryptedCreds, id);
        dispatcher_1.dispatcher.handleAccountDisabled(id);
        const accounts = getSanitizedAccounts();
        (0, ws_1.broadcast)('ACCOUNTS_UPDATED', accounts);
        // Đóng phiên ẩn cũ để lần mở sau nạp cookie mới
        museWorker_1.museWorker.closeBrowser(id).then(() => dispatcher_1.dispatcher.checkAccount(id)).catch((e) => console.error('Health check error:', e));
        const updated = getSanitizedAccounts().find(a => a.id === id);
        return res.json({
            success: true,
            message: 'Đã cập nhật Cookie phiên cho tài khoản thành công',
            account: updated,
        });
    }
    catch (error) {
        console.error('Error updating cookie:', error);
        return res.status(500).json({ error: 'Đã xảy ra lỗi khi cập nhật Cookie' });
    }
});
// GET /api/accounts/active-browsers - list active browser session IDs
router.get('/active-browsers', (_req, res) => {
    return res.json({ activeIds: browserManager_1.browserManager.getActiveSessionIds() });
});
// POST /api/accounts/:id/sync-cookies - immediately capture cookies from active browser
router.post('/:id/sync-cookies', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await browserManager_1.browserManager.captureCookiesNow(id);
        return res.json(result);
    }
    catch (error) {
        return res.status(500).json({ error: error.message || 'Lỗi khi đồng bộ Cookie' });
    }
});
// POST /api/accounts/start-browser-login - launch Edge for user to log in and capture cookies
router.post('/start-browser-login', async (req, res) => {
    try {
        const { identifier, targetUrl } = req.body;
        const result = await browserManager_1.browserManager.startLoginSession(identifier, undefined, targetUrl);
        return res.json(result);
    }
    catch (error) {
        console.error('Error starting browser login:', error);
        return res.status(500).json({ error: error.message || 'Lỗi khi mở trình duyệt' });
    }
});
// POST /api/accounts/:id/open-browser - open browser profile for existing account
router.post('/:id/open-browser', async (req, res) => {
    try {
        const { id } = req.params;
        const { targetUrl } = req.body;
        const existing = db_1.db.prepare('SELECT * FROM accounts WHERE id = ?').get(id);
        if (!existing) {
            return res.status(404).json({ error: 'Không tìm thấy tài khoản' });
        }
        const result = await browserManager_1.browserManager.startLoginSession(existing.identifier, id, targetUrl);
        return res.json(result);
    }
    catch (error) {
        console.error('Error opening account browser:', error);
        return res.status(500).json({ error: error.message || 'Lỗi khi mở trình duyệt' });
    }
});
// POST /api/accounts/:id/close-browser - close active browser for account
router.post('/:id/close-browser', async (req, res) => {
    try {
        const { id } = req.params;
        const closed = await browserManager_1.browserManager.closeSession(id);
        const check = await dispatcher_1.dispatcher.checkAccount(id);
        return res.json({ success: true, closed, online: check.ok, message: check.reason });
    }
    catch (error) {
        return res.status(500).json({ error: error.message });
    }
});
// DELETE /api/accounts/:id - remove account, reassign its jobs
router.delete('/:id', (req, res) => {
    try {
        const { id } = req.params;
        const existing = db_1.db.prepare('SELECT id FROM accounts WHERE id = ?').get(id);
        if (!existing) {
            return res.status(404).json({ error: 'Không tìm thấy tài khoản với mã yêu cầu' });
        }
        // Handle any running jobs on this account
        dispatcher_1.dispatcher.handleAccountDisabled(id);
        // Delete account, its session browser and its browser profile
        db_1.db.prepare('DELETE FROM accounts WHERE id = ?').run(id);
        browserManager_1.browserManager
            .closeSession(id)
            .then(() => museWorker_1.museWorker.closeBrowser(id))
            .then(() => fs_1.default.rmSync((0, museWorker_1.profileDirFor)(id), { recursive: true, force: true }))
            .catch((e) => console.error('Error removing account profile:', e));
        const accounts = getSanitizedAccounts();
        (0, ws_1.broadcast)('ACCOUNTS_UPDATED', accounts);
        dispatcher_1.dispatcher.trigger();
        return res.json({
            success: true,
            message: 'Đã xóa tài khoản và điều phối lại các tác vụ liên quan'
        });
    }
    catch (error) {
        console.error('Error deleting account:', error);
        return res.status(500).json({ error: 'Đã xảy ra lỗi khi xóa tài khoản' });
    }
});
// PUT /api/accounts/:id/toggle - toggle enabled/disabled
router.put('/:id/toggle', (req, res) => {
    try {
        const { id } = req.params;
        const account = db_1.db.prepare('SELECT * FROM accounts WHERE id = ?').get(id);
        if (!account) {
            return res.status(404).json({ error: 'Không tìm thấy tài khoản' });
        }
        const newEnabled = account.enabled === 1 ? 0 : 1;
        const newStatus = 'offline';
        const newSessionStatus = newEnabled === 1 ? 'Đang kiểm tra phiên...' : 'Đã tắt';
        db_1.db.prepare(`
      UPDATE accounts
      SET enabled = ?,
          status = ?,
          session_status = ?,
          last_health_check = datetime('now')
      WHERE id = ?
    `).run(newEnabled, newStatus, newSessionStatus, id);
        // Bật/tắt lại bằng công tắc = bỏ tạm dừng do hết hạn mức (người dùng muốn chạy lại sớm)
        db_1.db.prepare(`UPDATE accounts SET paused_until = NULL WHERE id = ?`).run(id);
        if (newEnabled === 0) {
            dispatcher_1.dispatcher.handleAccountDisabled(id);
        }
        else {
            dispatcher_1.dispatcher.checkAccount(id).catch((e) => console.error('Health check error:', e));
        }
        const accounts = getSanitizedAccounts();
        (0, ws_1.broadcast)('ACCOUNTS_UPDATED', accounts);
        const updated = db_1.db.prepare(`
      SELECT id, identifier, enabled, status, session_status, jobs_running, last_health_check, created_at
      FROM accounts WHERE id = ?
    `).get(id);
        return res.json({
            success: true,
            message: newEnabled === 1 ? 'Đã bật hoạt động tài khoản' : 'Đã tạm ngưng tài khoản',
            account: updated
        });
    }
    catch (error) {
        console.error('Error toggling account:', error);
        return res.status(500).json({ error: 'Đã xảy ra lỗi khi thay đổi trạng thái tài khoản' });
    }
});
// POST /api/accounts/:id/health - mở muse.ai bằng phiên của tài khoản để kiểm tra thật
router.post('/:id/health', async (req, res) => {
    try {
        const { id } = req.params;
        const account = db_1.db.prepare('SELECT * FROM accounts WHERE id = ?').get(id);
        if (!account) {
            return res.status(404).json({ error: 'Không tìm thấy tài khoản để kiểm tra' });
        }
        const result = await dispatcher_1.dispatcher.checkAccount(id);
        const updated = getSanitizedAccounts().find((a) => a.id === id);
        return res.json({ success: result.ok, message: result.reason, account: updated });
    }
    catch (error) {
        console.error('Error running account health check:', error);
        return res.status(500).json({ error: 'Lỗi khi kiểm tra trạng thái tài khoản' });
    }
});
// POST /api/accounts/health-all - kiểm tra thật toàn bộ tài khoản đang bật
router.post('/health-all', async (_req, res) => {
    try {
        await dispatcher_1.dispatcher.checkAllAccounts();
        const accounts = getSanitizedAccounts();
        return res.json({ success: true, message: 'Đã kiểm tra phiên toàn bộ tài khoản', accounts });
    }
    catch (error) {
        console.error('Error running health check on all accounts:', error);
        return res.status(500).json({ error: 'Lỗi khi kiểm tra tất cả tài khoản' });
    }
});
exports.default = router;
