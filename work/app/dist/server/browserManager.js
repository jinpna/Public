"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.browserManager = void 0;
const child_process_1 = require("child_process");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const uuid_1 = require("uuid");
const db_1 = require("./db");
const crypto_1 = require("./crypto");
const ws_1 = require("./ws");
const dispatcher_1 = require("./dispatcher");
const accounts_1 = require("./routes/accounts");
const museWorker_1 = require("./museWorker");
const procUtil_1 = require("./procUtil");
const proxyManager_1 = require("./proxyManager");
/** Còn tiến trình trình duyệt nào đang mở thư mục profile này không (dò theo dòng lệnh). */
function profileInUse(profileDir) {
    return (0, procUtil_1.browsersUsing)(path_1.default.basename(profileDir));
}
/**
 * Cửa sổ đăng nhập: mở Edge như trình duyệt bình thường trên profile riêng của tài khoản
 * để người dùng tự đăng nhập Muse. Phiên được giữ trong profile; khi cửa sổ đóng,
 * hệ thống kiểm tra phiên thật rồi mới cho tài khoản Online.
 */
class BrowserManager {
    windows = new Map();
    getActiveSessionIds() {
        return Array.from(this.windows.keys());
    }
    isSessionActive(accountId) {
        return this.windows.has(accountId);
    }
    /** Nút "Quét / Hoàn tất": đóng cửa sổ đăng nhập rồi kiểm tra phiên. */
    async captureCookiesNow(accountId) {
        await this.closeSession(accountId);
        const result = await dispatcher_1.dispatcher.checkAccount(accountId);
        return {
            success: result.ok,
            cookieCount: 0,
            message: result.ok ? 'Đăng nhập Muse thành công, tài khoản đã Online!' : `Chưa đăng nhập được: ${result.reason}`,
        };
    }
    async startLoginSession(identifier, existingAccountId, targetUrl = 'https://muse.ai/') {
        const rawIdentifier = (identifier || 'Tài khoản mới').trim();
        const accountId = existingAccountId || (0, uuid_1.v4)();
        const userProfileDir = (0, museWorker_1.profileDirFor)(accountId);
        fs_1.default.mkdirSync(userProfileDir, { recursive: true });
        if (this.windows.has(accountId)) {
            return {
                success: true,
                accountId,
                account: (0, accounts_1.getSanitizedAccounts)().find((a) => a.id === accountId),
                message: 'Cửa sổ đăng nhập của tài khoản này đang mở. Hãy đăng nhập rồi đóng cửa sổ đó.',
            };
        }
        try {
            let existingInDb = db_1.db.prepare('SELECT id, proxy FROM accounts WHERE id = ?').get(accountId);
            if (!existingInDb) {
                const rawProxyRow = db_1.db.prepare(`SELECT value FROM settings WHERE key = 'proxy_raw_list'`).get();
                const rawList = (rawProxyRow?.value || '').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
                let autoProxy = null;
                if (rawList.length > 0) {
                    const count = db_1.db.prepare(`SELECT COUNT(*) as c FROM accounts`).get().c;
                    autoProxy = rawList[count % rawList.length];
                }
                const credString = JSON.stringify({ type: 'browser_profile', loginType: 'browser', createdAt: new Date().toISOString() });
                db_1.db.prepare(`
          INSERT INTO accounts (id, identifier, credentials_encrypted, enabled, status, session_status, jobs_running, last_health_check, proxy, proxy_status)
          VALUES (?, ?, ?, 1, 'offline', 'Đang mở cửa sổ trình duyệt...', 0, NULL, ?, ?)
        `).run(accountId, (0, crypto_1.maskIdentifier)(rawIdentifier), (0, crypto_1.encrypt)(credString), autoProxy, autoProxy ? 'testing' : null);
                existingInDb = { id: accountId, proxy: autoProxy || undefined };
            }
            else {
                dispatcher_1.dispatcher.handleAccountDisabled(accountId);
                db_1.db.prepare(`UPDATE accounts SET status = 'offline', session_status = 'Đang mở cửa sổ trình duyệt...' WHERE id = ?`).run(accountId);
            }
            // Profile chỉ mở được bởi 1 trình duyệt: đóng phiên ẩn của worker và mọi trình duyệt còn giữ profile.
            // Nếu còn sót, lệnh mở cửa sổ sẽ bị gộp thành 1 tab vô hình trong trình duyệt ẩn -> "báo đang mở mà không thấy".
            museWorker_1.museWorker.lockedProfiles.add(accountId);
            await museWorker_1.museWorker.closeBrowser(accountId);
            await (0, procUtil_1.killBrowsersUsingAsync)(path_1.default.basename(userProfileDir));
            fs_1.default.rmSync(path_1.default.join(userProfileDir, 'DevToolsActivePort'), { force: true });
            let proxyArgs = [];
            try {
                proxyArgs = await (0, proxyManager_1.resolveChromeProxyArgs)(existingInDb?.proxy, accountId);
            }
            catch (err) {
                console.warn(`[BrowserManager] Lỗi cấu hình proxy cho ${accountId}:`, err.message);
            }
            const url = /^https?:\/\//.test(targetUrl || '') ? targetUrl : 'https://muse.ai/';
            const proc = (0, child_process_1.spawn)((0, museWorker_1.getBrowserExecutablePath)(), [
                `--user-data-dir=${userProfileDir}`,
                '--no-first-run',
                '--no-default-browser-check',
                // Cùng kiểu lưu cookie với worker ẩn (puppeteer luôn dùng 2 cờ này); thiếu thì trên Mac
                // cookie bị mã hoá bằng Keychain thật và worker không đọc được -> luôn báo chưa đăng nhập
                '--password-store=basic',
                '--use-mock-keychain',
                '--disable-background-mode',
                '--disable-features=msStartupBoost',
                '--disable-backgrounding-occluded-windows',
                '--no-service-autorun',
                // Cổng DevTools: để biết chắc cửa sổ đã lên và phát hiện đóng ngay (không phải dò PowerShell)
                '--remote-debugging-port=0',
                ...proxyArgs,
                '--new-window',
                url,
            ], { detached: true, stdio: 'ignore' });
            proc.unref();
            proc.on('error', (e) => console.error('[BrowserManager] Không mở được trình duyệt:', e.message));
            // Theo dõi cửa sổ qua cổng DevTools (nhanh): lên rồi mà mất -> người dùng đã đóng -> kiểm tra phiên.
            // Quá 20 giây vẫn chưa lên -> báo lỗi rõ ràng thay vì treo ở "đang mở".
            const openedAt = Date.now();
            let seenOpen = false;
            let polling = false;
            const watcher = setInterval(async () => {
                if (polling)
                    return;
                polling = true;
                const alive = !!(await (0, museWorker_1.probeDevTools)(userProfileDir));
                polling = false;
                if (!this.windows.has(accountId))
                    return clearInterval(watcher);
                if (alive) {
                    if (!seenOpen) {
                        seenOpen = true;
                        db_1.db.prepare(`UPDATE accounts SET session_status = ? WHERE id = ?`).run('Cửa sổ đăng nhập đã mở: đăng nhập Muse xong thì đóng cửa sổ hoặc bấm "Kiểm tra đăng nhập"', accountId);
                        (0, ws_1.broadcast)('ACCOUNTS_UPDATED', (0, accounts_1.getSanitizedAccounts)());
                    }
                    return;
                }
                if (!seenOpen && Date.now() - openedAt < 20000)
                    return;
                clearInterval(watcher);
                this.windows.delete(accountId);
                museWorker_1.museWorker.lockedProfiles.delete(accountId);
                if (!seenOpen) {
                    console.log(`[BrowserManager] Không mở được cửa sổ đăng nhập cho ${rawIdentifier}`);
                    await (0, procUtil_1.killBrowsersUsingAsync)(path_1.default.basename(userProfileDir));
                    db_1.db.prepare(`UPDATE accounts SET session_status = ? WHERE id = ?`).run('Không mở được cửa sổ trình duyệt sau 20 giây. Bấm "Mở duyệt" để thử lại.', accountId);
                    (0, ws_1.broadcast)('ACCOUNTS_UPDATED', (0, accounts_1.getSanitizedAccounts)());
                    return;
                }
                console.log(`[BrowserManager] Cửa sổ đăng nhập của ${rawIdentifier} đã đóng, kiểm tra phiên...`);
                (0, ws_1.broadcast)('ACCOUNTS_UPDATED', (0, accounts_1.getSanitizedAccounts)());
                dispatcher_1.dispatcher.checkAccount(accountId).catch((e) => console.error('[BrowserManager] check error:', e));
            }, 1000);
            this.windows.set(accountId, { accountId, identifier: rawIdentifier, profileDir: userProfileDir, watcher });
            (0, ws_1.broadcast)('ACCOUNTS_UPDATED', (0, accounts_1.getSanitizedAccounts)());
            return {
                success: true,
                accountId,
                account: (0, accounts_1.getSanitizedAccounts)().find((a) => a.id === accountId),
                message: 'Đang mở cửa sổ trình duyệt. Hãy đăng nhập Muse, xong thì bấm "Kiểm tra đăng nhập" hoặc đóng cửa sổ đó.',
            };
        }
        catch (err) {
            museWorker_1.museWorker.lockedProfiles.delete(accountId);
            console.error('[BrowserManager] Error launching login browser:', err);
            return { success: false, accountId: '', message: `Lỗi khi mở trình duyệt: ${err.message}` };
        }
    }
    async closeSession(accountId) {
        // Đóng cả cửa sổ mở từ lần chạy server trước (không có trong map)
        const win = this.windows.get(accountId);
        if (win)
            clearInterval(win.watcher);
        this.windows.delete(accountId);
        const profileDir = (0, museWorker_1.profileDirFor)(accountId);
        const wasOpen = !!win || !!(await (0, museWorker_1.probeDevTools)(profileDir)) || (await profileInUse(profileDir));
        if (wasOpen) {
            // Đóng qua DevTools (nhanh, gọn), còn sót thì tắt tiến trình; không chặn server
            await (0, museWorker_1.closeProfileBrowser)(profileDir);
            if (await profileInUse(profileDir))
                await (0, procUtil_1.killBrowsersUsingAsync)(path_1.default.basename(profileDir));
            await new Promise((r) => setTimeout(r, 500));
        }
        museWorker_1.museWorker.lockedProfiles.delete(accountId);
        return wasOpen;
    }
}
exports.browserManager = new BrowserManager();
