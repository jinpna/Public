"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.museWorker = exports.PROFILES_DIR = void 0;
exports.formatResetDate = formatResetDate;
exports.resolveBrowser = resolveBrowser;
exports.getBrowserExecutablePath = getBrowserExecutablePath;
exports.profileDirFor = profileDirFor;
exports.probeDevTools = probeDevTools;
exports.closeProfileBrowser = closeProfileBrowser;
exports.parseCookieInput = parseCookieInput;
const puppeteer_core_1 = __importDefault(require("puppeteer-core"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const os_1 = __importDefault(require("os"));
const child_process_1 = require("child_process");
const db_1 = require("./db");
const crypto_1 = require("./crypto");
const paths_1 = require("./paths");
const procUtil_1 = require("./procUtil");
const proxyManager_1 = require("./proxyManager");
// Mọi chỗ phụ thuộc giao diện muse.ai gom ở đây, Muse đổi giao diện thì chỉ sửa khối này.
const MUSE_URL = 'https://muse.ai/';
// Muse dùng 1 luồng chat duy nhất cho mỗi tài khoản (không có "chat mới").
const SEL = {
    loginInput: 'input[aria-label="Mobile number or email"]',
    textbox: 'textarea[aria-label="Message"], textarea, [contenteditable="true"], [role="textbox"]',
    fileInput: 'input[type="file"]',
    attachButtonLabels: ['attach file', 'attach', 'đính kèm'],
    // Video kết quả trong tin nhắn; video linh vật (data-hatch-media-owner="avatar-layer") không nằm trong khối này
    resultVideo: '[data-testid="hatch-chat-attachment-presentation-video"] [data-hatch-video-wrapper="true"]',
};
// Câu trả lời của Muse cho biết không tạo được video
// Câu trả lời của Muse cho biết tài khoản hết lượt / bị giới hạn / cần xác minh
const MUSE_USAGE_RE = /hết (lượt|hạn mức|quota|giới hạn)|đạt (giới hạn|hạn mức)|vượt (quá )?(giới hạn|hạn mức)|quá nhiều (yêu cầu|lượt|video)|thử lại sau|quay lại sau|giới hạn (sử dụng|tạo|hằng ngày|hàng ngày)|xác minh (tài khoản|danh tính)|usage limit|rate limit|reached (your|the|a) (daily |usage )?limit|limit reached|out of (credits|generations|quota)|quota|too many requests|try again (later|tomorrow)|come back (later|tomorrow)|verify (your|that)/i;
// Muse TỪ CHỐI vì nội dung / chính sách (phải đổi prompt mới chạy được) -> thất bại ngay, không thử lại
const MUSE_POLICY_RE = /không thể hỗ trợ|lựa chọn duy nhất.*brief|hướng khác an toàn hơn|an toàn hơn|chính sách|vi phạm|không phù hợp|không được với brief|brief hiện tại|đổi prompt|thay đổi prompt|brief khác|không được phép|tiêu chuẩn cộng đồng|safety policy|content policy|usage polic|violat|guideline|can'?t (help|create|make)|cannot (help|create|make)|not able to (help|create|make)|won'?t (be able to )?(create|make)/i;
// Muse báo LỖI KỸ THUẬT (công cụ tạo video lỗi, lỗi nội bộ...) -> thử lại như bình thường
const MUSE_ERROR_RE = /gặp lỗi|báo lỗi|lỗi nội bộ|không tạo được|chưa có file video|không thể tạo|internal error|failed to|couldn't|could not|unable to|không làm được/i;
exports.PROFILES_DIR = path_1.default.join(paths_1.DATA_DIR, 'profiles');
const VIDEOS_DIR = path_1.default.join(paths_1.DATA_DIR, 'videos');
const DEBUG_DIR = path_1.default.join(paths_1.DATA_DIR, 'debug');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function formatResetDate(rawDate) {
    if (!rawDate)
        return null;
    const m = rawDate.match(/([A-Za-z]+)\s*(\d+)/i) || rawDate.match(/(\d+)\s*([A-Za-z]+)/i);
    if (m) {
        const monthMap = {
            jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
            jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12'
        };
        const isFirstAlpha = isNaN(Number(m[1]));
        const monStr = (isFirstAlpha ? m[1] : m[2]).toLowerCase().slice(0, 3);
        const dayStr = isFirstAlpha ? m[2] : m[1];
        const monthNum = monthMap[monStr] || monStr;
        return `${dayStr}/${monthNum} (${rawDate})`;
    }
    return rawDate;
}
function chromeCandidates() {
    const home = os_1.default.homedir();
    if (process.platform === 'darwin') {
        return [
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            path_1.default.join(home, 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
        ];
    }
    if (process.platform === 'win32') {
        const local = process.env.LOCALAPPDATA || path_1.default.join(home, 'AppData', 'Local');
        return [
            path_1.default.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Google\\Chrome\\Application\\chrome.exe'),
            path_1.default.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Google\\Chrome\\Application\\chrome.exe'),
            path_1.default.join(local, 'Google\\Chrome\\Application\\chrome.exe'), // Chrome cài riêng cho người dùng
        ];
    }
    return ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
}
function edgeCandidates() {
    const home = os_1.default.homedir();
    if (process.platform === 'darwin') {
        return [
            '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
            path_1.default.join(home, 'Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'),
        ];
    }
    if (process.platform === 'win32') {
        return [
            path_1.default.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Microsoft\\Edge\\Application\\msedge.exe'),
            path_1.default.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Microsoft\\Edge\\Application\\msedge.exe'),
        ];
    }
    return ['/usr/bin/microsoft-edge'];
}
const firstExisting = (list) => list.find((p) => fs_1.default.existsSync(p)) || null;
/** Setting "browser_choice": auto (Chrome nếu có, không thì Edge) | chrome | edge. */
function resolveBrowser() {
    const row = db_1.db.prepare(`SELECT value FROM settings WHERE key = 'browser_choice'`).get();
    const choice = row?.value || 'auto';
    const chrome = firstExisting(chromeCandidates());
    const edge = firstExisting(edgeCandidates());
    if (choice === 'edge' && edge)
        return { kind: 'edge', path: edge };
    // auto / chrome: dùng Chrome nếu máy có, không có thì Edge
    if (chrome)
        return { kind: 'chrome', path: chrome };
    if (edge)
        return { kind: 'edge', path: edge };
    throw new Error(process.platform === 'darwin'
        ? 'Không tìm thấy Google Chrome hoặc Microsoft Edge. Hãy cài Google Chrome (google.com/chrome) rồi mở lại app.'
        : 'Không tìm thấy Google Chrome hoặc Microsoft Edge trên máy. Hãy cài Google Chrome rồi mở lại app.');
}
function getBrowserExecutablePath() {
    return resolveBrowser().path;
}
/**
 * Profile riêng theo từng trình duyệt (Chrome và Edge không đọc được cookie của nhau).
 * Edge giữ tên cũ "acc_<id>" để tài khoản đang có không phải đăng nhập lại khi vẫn dùng Edge.
 */
function profileDirFor(accountId) {
    const base = `acc_${accountId.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
    // KHÔNG dùng profile Edge cho Chrome (và ngược lại): trình duyệt này không giải mã được cookie của trình duyệt kia,
    // mở chung sẽ làm tài khoản bị out. Mỗi trình duyệt một profile riêng; tài khoản dán cookie tự nạp lại.
    let kind = 'edge';
    try {
        kind = resolveBrowser().kind;
    }
    catch {
        // không có trình duyệt nào: giữ tên Edge, lỗi sẽ báo khi mở
    }
    return path_1.default.join(exports.PROFILES_DIR, kind === 'chrome' ? `${base}_chrome` : base);
}
// ---------- Dò trình duyệt qua cổng DevTools (nhanh, không cần PowerShell) ----------
/** Trình duyệt đang chạy trên profile này (có cổng DevTools) -> trả endpoint websocket, không có -> null. */
async function probeDevTools(userDataDir) {
    let content = '';
    try {
        content = fs_1.default.readFileSync(path_1.default.join(userDataDir, 'DevToolsActivePort'), 'utf8');
    }
    catch {
        return null;
    }
    const [port] = content.split(/\r?\n/);
    if (!port?.trim())
        return null;
    try {
        const res = await fetch(`http://127.0.0.1:${port.trim()}/json/version`, { signal: AbortSignal.timeout(1000) });
        if (!res.ok)
            return null;
        const info = (await res.json());
        return info.webSocketDebuggerUrl || null;
    }
    catch {
        return null;
    }
}
/** Chờ trình duyệt vừa mở ghi cổng DevTools và trả lời được. */
async function waitForDevTools(userDataDir, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const ws = await probeDevTools(userDataDir);
        if (ws)
            return ws;
        await sleep(300);
    }
    return null;
}
/** Đóng trình duyệt đang chạy trên profile (qua DevTools; không được thì tắt tiến trình). */
async function closeProfileBrowser(userDataDir) {
    const ws = await probeDevTools(userDataDir);
    if (ws) {
        try {
            const b = await puppeteer_core_1.default.connect({ browserWSEndpoint: ws });
            await b.close();
        }
        catch {
            // bỏ qua, xuống bước tắt tiến trình
        }
        for (let i = 0; i < 20 && (await probeDevTools(userDataDir)); i++)
            await sleep(250);
    }
    if (await probeDevTools(userDataDir))
        await (0, procUtil_1.killBrowsersUsingAsync)(path_1.default.basename(userDataDir));
    fs_1.default.rmSync(path_1.default.join(userDataDir, 'DevToolsActivePort'), { force: true });
}
function isHeadless() {
    const row = db_1.db.prepare(`SELECT value FROM settings WHERE key = 'browser_headless'`).get();
    return !row || row.value !== '0';
}
function readCredentials(accountId) {
    const acc = db_1.db.prepare('SELECT credentials_encrypted FROM accounts WHERE id = ?').get(accountId);
    if (!acc?.credentials_encrypted)
        return null;
    try {
        return JSON.parse((0, crypto_1.decrypt)(acc.credentials_encrypted));
    }
    catch {
        return null;
    }
}
/** Chuẩn hóa cookie dán vào (JSON từ Cookie-Editor hoặc chuỗi "a=b; c=d") thành danh sách cookie. */
function parseCookieInput(raw) {
    const trimmed = (raw || '').trim();
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
        try {
            const parsed = JSON.parse(trimmed);
            const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed.cookies) ? parsed.cookies : null;
            if (list) {
                return list
                    .filter((c) => c && c.name && c.value !== undefined)
                    .map((c) => ({
                    name: String(c.name),
                    value: String(c.value),
                    domain: c.domain || '.muse.ai',
                    path: c.path || '/',
                    secure: c.secure !== false,
                    httpOnly: !!c.httpOnly,
                    expires: typeof c.expirationDate === 'number' ? c.expirationDate : typeof c.expires === 'number' ? c.expires : undefined,
                }));
            }
            return Object.entries(parsed).map(([name, value]) => ({ name, value: String(value), domain: '.muse.ai', path: '/', secure: true }));
        }
        catch {
            // không phải JSON, xử lý như chuỗi header
        }
    }
    // Định dạng Netscape (cookies.txt): domain, flag, path, secure, expiry, name, value cách nhau bằng tab
    const netscape = trimmed
        .split(/\r?\n/)
        .map((l) => l.replace(/^#HttpOnly_/, ""))
        .filter((l) => l && !l.startsWith("#"))
        .map((l) => l.split("\t"))
        .filter((f) => f.length >= 7);
    if (netscape.length > 0) {
        return netscape.map((f) => ({
            name: f[5],
            value: f[6].trim(),
            domain: f[0],
            path: f[2] || "/",
            secure: f[3].toUpperCase() === "TRUE",
            expires: Number(f[4]) || undefined,
        }));
    }
    return trimmed
        .replace(/^cookie:\s*/i, "")
        .split(/;|\r?\n/)
        .map((p) => p.trim())
        .filter((p) => p.includes('='))
        .map((p) => {
        const i = p.indexOf('=');
        return { name: p.slice(0, i).trim(), value: p.slice(i + 1).trim(), domain: '.muse.ai', path: '/', secure: true };
    });
}
/**
 * Mở trình duyệt rồi kết nối qua cổng DevTools, thay vì puppeteer.launch.
 * Edge (từ bản 155) tự khởi động lại chính nó ngay khi mở: tiến trình đầu thoát mã 0 nên puppeteer.launch
 * báo "Failed to launch" dù Edge thật vẫn chạy (và giữ khoá profile). Cách này không phụ thuộc tiến trình đầu:
 * Edge mới vẫn mang cờ --remote-debugging-port và ghi cổng vào <profile>/DevToolsActivePort.
 */
async function launchAndConnect(userDataDir, headless, extraArgs = []) {
    const connect = (ws) => puppeteer_core_1.default.connect({ browserWSEndpoint: ws, defaultViewport: { width: 1280, height: 900 } });
    // Trình duyệt của profile này vẫn đang chạy (vd. còn từ lần trước) -> dùng lại luôn, khỏi mở mới
    const alive = await probeDevTools(userDataDir);
    if (alive)
        return connect(alive);
    const portFile = path_1.default.join(userDataDir, 'DevToolsActivePort');
    fs_1.default.rmSync(portFile, { force: true });
    const args = [
        `--user-data-dir=${userDataDir}`,
        '--remote-debugging-port=0',
        '--no-first-run',
        '--no-default-browser-check',
        '--password-store=basic',
        '--use-mock-keychain',
        '--mute-audio',
        '--window-size=1280,900',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        ...extraArgs,
        ...(headless ? ['--headless=new'] : []),
        'about:blank',
    ];
    const exe = getBrowserExecutablePath();
    const launch = () => (0, child_process_1.spawn)(exe, args, { stdio: 'ignore', windowsHide: true }).on('error', () => { });
    launch();
    let ws = await waitForDevTools(userDataDir, 15000);
    if (!ws) {
        // Thường do trình duyệt cũ không có cổng DevTools đang giữ profile: tắt nó rồi mở lại 1 lần
        await (0, procUtil_1.killBrowsersUsingAsync)(path_1.default.basename(userDataDir));
        fs_1.default.rmSync(portFile, { force: true });
        launch();
        ws = await waitForDevTools(userDataDir, 25000);
    }
    if (ws)
        return connect(ws);
    await (0, procUtil_1.killBrowsersUsingAsync)(path_1.default.basename(userDataDir));
    throw new Error('Không mở được trình duyệt (quá 40 giây). Hãy thử lại hoặc khởi động lại app.');
}
class MuseWorker {
    browsers = new Map();
    launching = new Map();
    /** Tài khoản đang đóng trình duyệt: lần mở tiếp theo phải đợi */
    closing = new Map();
    jobPages = new Map();
    cancelled = new Set();
    /** Tài khoản đang mở cửa sổ đăng nhập thủ công: profile bị khóa, worker không được đụng vào. */
    lockedProfiles = new Set();
    async getBrowser(accountId) {
        // Trình duyệt của tài khoản đang được đóng (vd. sau lỗi mạng/proxy): phải đợi đóng xong rồi mới mở lại.
        // Nếu không, job mới sẽ dùng lại đúng trình duyệt sắp bị tắt -> "detached Frame" / "Target closed".
        const closingNow = this.closing.get(accountId);
        if (closingNow)
            await closingNow.catch(() => { });
        const existing = this.browsers.get(accountId);
        if (existing && existing.connected)
            return existing;
        if (this.launching.has(accountId))
            return this.launching.get(accountId);
        if (this.lockedProfiles.has(accountId)) {
            throw new Error('Cửa sổ đăng nhập của tài khoản này đang mở, hãy đóng nó trước');
        }
        const p = (async () => {
            const userDataDir = profileDirFor(accountId);
            fs_1.default.mkdirSync(userDataDir, { recursive: true });
            // Lấy thông tin proxy của tài khoản này nếu có
            const accRow = db_1.db.prepare('SELECT proxy FROM accounts WHERE id = ?').get(accountId);
            let proxyArgs = [];
            if (accRow?.proxy) {
                try {
                    proxyArgs = await (0, proxyManager_1.resolveChromeProxyArgs)(accRow.proxy, accountId);
                }
                catch (err) {
                    console.error(`[MuseWorker] Lỗi nạp proxy cho ${accountId}:`, err.message);
                    if (err.message.startsWith('PROXY_LIMIT:')) {
                        throw err;
                    }
                }
            }
            const browser = await launchAndConnect(userDataDir, isHeadless(), proxyArgs);
            browser.on('disconnected', () => {
                if (this.browsers.get(accountId) === browser)
                    this.browsers.delete(accountId);
            });
            // Tài khoản dán cookie: nạp cookie vào profile ở lần mở đầu tiên sau khi dán.
            // Đánh dấu theo từng profile (file trong profile) để đổi Chrome <-> Edge hay chuyển máy thì profile mới vẫn được nạp.
            const creds = readCredentials(accountId);
            const marker = path_1.default.join(userDataDir, '.musee-cookies-injected');
            let injectedFor = '';
            try {
                injectedFor = fs_1.default.readFileSync(marker, 'utf8').trim();
            }
            catch {
                // chưa nạp lần nào vào profile này
            }
            if (creds?.type === 'cookie' && Array.isArray(creds.cookies) && injectedFor !== String(creds.updatedAt)) {
                const page = await browser.newPage();
                await page.goto(MUSE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => { });
                await browser.setCookie(...creds.cookies.map((c) => ({ ...c, sameSite: undefined })));
                await page.close();
                fs_1.default.writeFileSync(marker, String(creds.updatedAt), 'utf8');
            }
            this.browsers.set(accountId, browser);
            return browser;
        })();
        this.launching.set(accountId, p);
        try {
            return await p;
        }
        finally {
            this.launching.delete(accountId);
        }
    }
    async closeBrowser(accountId) {
        // Đang đóng rồi thì đợi lần đóng đó, không đóng chồng
        const pending = this.closing.get(accountId);
        if (pending)
            return pending;
        const p = (async () => {
            const b = this.browsers.get(accountId);
            this.browsers.delete(accountId);
            if (b)
                await b.close().catch(() => { });
            // Đóng chắc chắn (qua DevTools, cần thì tắt tiến trình) mà không chặn server
            await closeProfileBrowser(profileDirFor(accountId));
        })();
        this.closing.set(accountId, p);
        try {
            await p;
        }
        finally {
            this.closing.delete(accountId);
        }
    }
    currentBrowserName() {
        return resolveBrowser().kind === 'chrome' ? 'Chrome' : 'Edge';
    }
    isCookieAccount(accountId) {
        const creds = readCredentials(accountId);
        return creds?.type === 'cookie' && Array.isArray(creds.cookies) && creds.cookies.length > 0;
    }
    /** Profile của trình duyệt hiện tại đã từng lưu cookie chưa (chưa có file Cookies = chưa đăng nhập trên trình duyệt này). */
    profileHasSession(accountId) {
        const dir = profileDirFor(accountId);
        return (fs_1.default.existsSync(path_1.default.join(dir, 'Default', 'Network', 'Cookies')) || fs_1.default.existsSync(path_1.default.join(dir, 'Default', 'Cookies')));
    }
    async closeAll() {
        await Promise.all([...this.browsers.keys()].map((id) => this.closeBrowser(id)));
    }
    async waitForAppState(page, timeoutMs = 30000) {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            const state = await page
                .evaluate((sel) => {
                if (document.querySelector(sel.loginInput))
                    return 'logged_out';
                const tb = [...document.querySelectorAll(sel.textbox)].find((el) => el.offsetParent !== null);
                if (tb) return 'logged_in';
                const text = document.body?.innerText || '';
                const login = [...document.querySelectorAll('button,a')].some(el => el.offsetParent !== null && /^(log in|login|sign in|log in or create an account|đăng nhập)$/i.test((el.innerText || '').trim()));
                return login && /log in|sign in|đăng nhập/i.test(text) ? 'logged_out' : 'unknown';
            }, SEL)
                .catch(() => 'unknown');
            if (state !== 'unknown')
                return state;
            await sleep(1000);
        }
        return 'unknown';
    }
    /** Chờ WebSocket của Muse kết nối hoàn tất (hết Connecting...) và ô chat sẵn sàng nhận lệnh */
    async waitForMuseReady(page, timeoutMs = 25000) {
        const start = Date.now();
        let reloadAttempted = false;
        while (Date.now() - start < timeoutMs) {
            const status = await page.evaluate(() => {
                const isConnecting = document.querySelector('[title="Connecting..."]') !== null ||
                    document.querySelector('[data-testid="hatch-chat-connection-status"]') !== null ||
                    (document.body ? document.body.innerText.includes('Connecting...') : false);
                if (isConnecting)
                    return 'connecting';
                const tb = document.querySelector('textarea, [contenteditable="true"], [role="textbox"]');
                if (!tb)
                    return 'no_textbox';
                if (tb.hasAttribute('disabled') || tb.getAttribute('aria-disabled') === 'true')
                    return 'disabled';
                return 'ready';
            }).catch(() => 'unknown');
            if (status === 'ready')
                return true;
            // Nếu bị kẹt ở Connecting... quá 8 giây, reload 1 lần để Muse bắt lại WebSocket
            if (status === 'connecting' && Date.now() - start > 8000 && !reloadAttempted) {
                console.log('[MuseWorker] Muse đang Connecting..., tự động reload để làm mới kết nối...');
                reloadAttempted = true;
                await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => { });
                await sleep(2000);
                continue;
            }
            await sleep(800);
        }
        return false;
    }
    /** Mở muse.ai bằng phiên của tài khoản và xác định đã đăng nhập hay chưa. */
    /** definitive = true khi Muse trả lời rõ (đã/chưa đăng nhập); false khi lỗi mạng, không mở được trình duyệt... */
    async checkSession(accountId) {
        let page = null;
        try {
            const browser = await this.getBrowser(accountId);
            page = await browser.newPage();
            await page.goto(MUSE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
            let state = await this.waitForAppState(page);
            if (state === 'logged_out') {
                // Profile mang từ máy khác sang (cookie trong profile bị Windows/Keychain khoá theo máy) hoặc profile bị xoá:
                // nạp lại cookie đã lưu (mã hoá trong data) rồi thử lại 1 lần
                const creds = readCredentials(accountId);
                if (creds?.type === 'cookie' && Array.isArray(creds.cookies) && creds.cookies.length > 0) {
                    await browser.setCookie(...creds.cookies.map((c) => ({ ...c, sameSite: undefined })));
                    await page.goto(MUSE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
                    state = await this.waitForAppState(page);
                }
            }
            if (state === 'logged_in') {
                const usage = await this.scrapeUsage(page);
                let reason = 'Phiên Muse hoạt động';
                if (usage.freePlanPercent !== null || usage.weeklyResetDate) {
                    const resetFormatted = formatResetDate(usage.weeklyResetDate);
                    const resetText = resetFormatted ? ` (Mở lại: ${resetFormatted})` : '';
                    if (usage.isLimitReached) {
                        reason = `⚠️ Hết hạn mức Free plan: 100% used${resetText}`;
                    }
                    else {
                        reason = `Phiên Muse hoạt động · Hạn mức: ${usage.freePlanPercent ?? 0}% used${resetText}`;
                    }
                    db_1.db.prepare(`
            UPDATE accounts
            SET usage_percent = ?,
                usage_reset_date = ?,
                usage_tokens_left = ?,
                usage_limit_reached = ?,
                usage_checked_at = datetime('now')
            WHERE id = ?
          `).run(usage.freePlanPercent ?? 0, resetFormatted || usage.weeklyResetDate, usage.tokensLeft ?? null, usage.isLimitReached ? 1 : 0, accountId);
                }
                return { ok: true, reason, definitive: true };
            }
            if (state === 'logged_out')
                return { ok: false, reason: 'Chưa đăng nhập hoặc phiên đã hết hạn', definitive: true };
            await this.saveDebug(page, `health_${accountId}`);
            return { ok: false, reason: 'Không nhận diện được trang Muse (đã lưu ảnh debug)', definitive: false };
        }
        catch (err) {
            return { ok: false, reason: `Lỗi kiểm tra phiên: ${err.message}`, definitive: false };
        }
        finally {
            if (page)
                await page.close().catch(() => { });
        }
    }
    async scrapeUsage(page) {
        try {
            // Nút ⚙ (hatch-dock-more) mở 1 menu nhỏ trước (Keyboard shortcuts / Download apps / Settings...),
            // phải bấm tiếp mục "Settings" thì bảng Settings (có mục Usage) mới hiện. Chờ tới khi thấy "Free plan ... % used".
            const usageVisible = () => page
                .evaluate(() => /Free plan[sS]{0,200}?d+%s*used/i.test(document.querySelector('[role="dialog"]')?.textContent || ''))
                .catch(() => false);
            // Cách chắc nhất: phím tắt Ctrl+, của Muse mở thẳng bảng Settings (nút ⚙ là menu Radix, không ăn lệnh click)
            for (let attempt = 0; attempt < 3 && !(await usageVisible()); attempt++) {
                await page.keyboard.down('Control');
                await page.keyboard.press('Comma');
                await page.keyboard.up('Control');
                for (let i = 0; i < 8 && !(await usageVisible()); i++)
                    await sleep(500);
            }
            if (!(await usageVisible())) {
                // Nút có thể chưa "clickable" lúc trang vừa tải (headless): bấm bằng DOM, chờ nút xuất hiện tối đa ~5s
                let settingsBtn = null;
                for (let i = 0; i < 10 && !settingsBtn; i++) {
                    settingsBtn = await page.$('[data-testid="hatch-dock-more"], button[aria-label="Settings"]');
                    if (!settingsBtn)
                        await sleep(500);
                }
                if (settingsBtn) {
                    await page.evaluate((el) => el.click(), settingsBtn);
                    for (let i = 0; i < 10; i++) {
                        await sleep(300);
                        const clicked = await page.evaluate(() => {
                            const els = [...document.querySelectorAll('[role="menuitem"], [role="menu"] *, button, a, div, span')];
                            // phần tử sâu nhất có chữ đúng "Settings" (bỏ phím tắt Ctrl+, đi kèm)
                            const hit = els.filter((el) => /^Settings(s*Ctrl+,)?$/i.test((el.innerText || '').trim().replace(/s+/g, ' '))).pop();
                            if (hit)
                                hit.click();
                            return !!hit;
                        });
                        if (clicked)
                            break;
                    }
                    for (let i = 0; i < 16 && !(await usageVisible()); i++)
                        await sleep(500);
                }
            }
            const res = await page.evaluate(() => {
                const dialog = document.querySelector('[role="dialog"]');
                if (!dialog)
                    return null;
                const text = dialog.innerText || '';
                const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
                let freePlanPercent = null;
                let weeklyResetDate = null;
                let tokensPercent = null;
                let tokensLeft = null;
                for (let i = 0; i < lines.length; i++) {
                    const l = lines[i];
                    if (l === 'Free plan' || l.includes('Free plan')) {
                        for (let j = 1; j <= 3 && (i + j) < lines.length; j++) {
                            const next = lines[i + j];
                            const rMatch = next.match(/Weekly\s*limit\s*resets\s*on\s*([A-Za-z0-9\s,]+)/i);
                            if (rMatch)
                                weeklyResetDate = rMatch[1].trim();
                            const pMatch = next.match(/(\d+)%\s*used/i);
                            if (pMatch)
                                freePlanPercent = parseInt(pMatch[1], 10);
                        }
                    }
                    if (l.includes('Additional tokens') || l === 'Additional tokens') {
                        for (let j = 1; j <= 3 && (i + j) < lines.length; j++) {
                            const next = lines[i + j];
                            const tMatch = next.match(/(\d+)%\s*used\s*(?:\(([^)]+)\))?/i);
                            if (tMatch) {
                                tokensPercent = parseInt(tMatch[1], 10);
                                if (tMatch[2])
                                    tokensLeft = tMatch[2].trim();
                            }
                        }
                    }
                }
                const isLimitReached = (freePlanPercent !== null && freePlanPercent >= 100);
                return { freePlanPercent, weeklyResetDate, tokensPercent, tokensLeft, isLimitReached };
            });
            // Đóng dialog Settings sau khi đọc xong
            await page.keyboard.press('Escape');
            if (res)
                return res;
        }
        catch (err) {
            console.error('[MuseWorker] scrapeUsage error:', err.message);
        }
        return {
            freePlanPercent: null,
            weeklyResetDate: null,
            tokensPercent: null,
            tokensLeft: null,
            isLimitReached: false,
        };
    }
    cancel(jobId) {
        this.cancelled.add(jobId);
        const page = this.jobPages.get(jobId);
        if (page)
            page.close().catch(() => { });
    }
    async saveDebug(page, name) {
        fs_1.default.mkdirSync(DEBUG_DIR, { recursive: true });
        const base = path_1.default.join(DEBUG_DIR, `${name}_${Date.now()}`);
        await page.screenshot({ path: `${base}.png`, fullPage: false }).catch(() => { });
        const html = await page.content().catch(() => '');
        fs_1.default.writeFileSync(`${base}.html`, html, 'utf-8');
        return base;
    }
    async handleOnboardingIfNeeded(page) {
        try {
            const needsName = await page.evaluate(() => {
                const text = document.body ? document.body.innerText : '';
                return text.toLowerCase().includes("what's your name") || text.toLowerCase().includes('before we get started');
            });
            if (needsName) {
                console.log('[MuseWorker] Phát hiện màn hình chào mừng Onboarding của nick mới, tự động thiết lập...');
                await this.typePrompt(page, 'User');
                await page.keyboard.press('Enter');
                await sleep(3000);
                await page.evaluate(() => {
                    const btns = [...document.querySelectorAll('button')];
                    const b = btns.find((el) => el.innerText && el.innerText.trim().toLowerCase() === 'muse');
                    if (b)
                        b.click();
                });
                await sleep(2000);
            }
        }
        catch (err) {
            console.warn('[MuseWorker] handleOnboardingIfNeeded warning:', err.message);
        }
    }
    async clickByLabel(page, labels) {
        return page.evaluate((labels) => {
            const els = [...document.querySelectorAll('button,[role="button"],a')];
            const hit = els.find((el) => {
                const t = `${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''} ${el.innerText || ''}`.toLowerCase();
                return el.offsetParent !== null && labels.some((l) => t.includes(l));
            });
            if (hit)
                hit.click();
            return !!hit;
        }, labels);
    }
    async attachImages(page, files) {
        if (files.length === 0)
            return;
        let input = await page.$(SEL.fileInput);
        if (!input) {
            const [chooser] = await Promise.all([
                page.waitForFileChooser({ timeout: 8000 }).catch(() => null),
                this.clickByLabel(page, SEL.attachButtonLabels),
            ]);
            if (chooser) {
                await chooser.accept(files);
                return;
            }
            input = await page.$(SEL.fileInput);
        }
        if (!input)
            throw new Error('Không tìm thấy nút đính kèm ảnh trên Muse');
        await input.uploadFile(...files);
    }
    async waitForAttachments(page, files, timeoutMs = 30000) {
        if (!files.length) return;
        try {
            await page.waitForFunction((expected) => {
                const input=document.querySelector('input[type="file"]');
                const composer=input?.parentElement?.parentElement;
                if(!composer)return false;
                const previews=[...composer.querySelectorAll('img')].filter(img=>img.complete&&img.naturalWidth>=32);
                return new Set(previews.map(img=>img.currentSrc||img.src)).size>=expected;
            }, {timeout: timeoutMs}, files.length);
        } catch {
            await this.saveDebug(page, 'attachment_not_ready_' + Date.now());
            throw new Error('REFERENCE_UPLOAD_ERROR: MUSE chưa xác nhận đủ '+files.length+' ảnh tham chiếu. Đã dừng trước khi gửi prompt để tránh tạo sai chủ thể.');
        }
    }
    async typePrompt(page, text) {
        const handle = await page.evaluateHandle((sel) => {
            const list = [...document.querySelectorAll(sel)].filter((el) => el.offsetParent !== null);
            return list[list.length - 1] || null;
        }, SEL.textbox);
        const el = handle.asElement();
        if (!el)
            throw new Error('Không tìm thấy ô nhập tin nhắn của Muse');
        await el.click();
        const lines = text.split('\n');
        for (let i = 0; i < lines.length; i++) {
            if (lines[i])
                await page.keyboard.sendCharacter(lines[i]);
            if (i < lines.length - 1) {
                await page.keyboard.down('Shift');
                await page.keyboard.press('Enter');
                await page.keyboard.up('Shift');
            }
        }
    }
    /** Video kết quả nằm sau tin nhắn chứa mã job (Muse chỉ có 1 luồng chat nên phải neo theo tin nhắn của mình). */
    async resultVideosAfter(page, marker, mediaType = "video", excluded = [], textPurpose) {
        return page.evaluate((marker, sel, mediaType, excluded, textPurpose) => {
            // Only inspect assistant message bodies in this exact user turn. Never scan
            // the whole page: Muse task history can contain old failures/refusals.
            const turns = [...document.querySelectorAll('[data-message-item][data-message-role]')];
            const mineIndex = turns.findLastIndex(el => el.getAttribute('data-message-role') === 'user' && (el.textContent || '').includes(marker));
            if (mineIndex < 0) return {srcs: [], reply: ''};
            const responses = [];
            for (let i = mineIndex + 1; i < turns.length; i++) {
                if (turns[i].getAttribute('data-message-role') === 'user') break;
                if (turns[i].getAttribute('data-message-role') === 'assistant') responses.push(turns[i]);
            }
            const bodies = responses.flatMap(el => {
                const inner = [...el.querySelectorAll('[data-hatch-assistant-message-body]')];
                return inner.length ? inner : [el];
            });
            const SKIP = '[data-hatch-avatar-host],[data-hatch-avatar-stage],[data-hatch-status-panel-surface],[data-hatch-status-panel-card],[data-message-accessibility-surrogate],[data-message-search-surrogate],[role="dialog"],[role="menu"],aside,nav';
            const srcs = [...new Set(bodies.flatMap(el => [...el.querySelectorAll(sel)])
                .filter(w => !w.closest(SKIP))
                .filter(w => mediaType !== 'image' || (w.naturalWidth >= 256 && w.naturalHeight >= 256))
                .map(w => mediaType === 'image' ? (w.currentSrc || w.src || '') : (w.getAttribute('data-hatch-video-src') || w.querySelector('video')?.src || ''))
                .filter(src => src && !excluded.includes(src)))];
            const parts = [];
            for (const body of bodies) {
                const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
                for (let n = walker.nextNode(); n; n = walker.nextNode()) {
                    if (!n.parentElement?.closest(SKIP)) parts.push(n.data);
                }
            }
            if(mediaType==='text'&&textPurpose==='code'){
                const blocks=bodies.flatMap(body=>[...body.querySelectorAll('pre code,pre')]).filter(el=>!el.closest(SKIP));
                for(const block of blocks.reverse()){const text=(block.textContent||'').trim().replace(/^json\s*(?=\{)/i,'');try{const parsed=JSON.parse(text);if(parsed&&typeof parsed.reply==='string')return {srcs:[],reply:'MONDAY_PROMPT_BEGIN\n'+text+'\nMONDAY_PROMPT_END'}}catch{}}
            }
            const reply = mediaType==='text'?bodies.map(body=>{const clone=body.cloneNode(true);clone.querySelectorAll(SKIP).forEach(e=>e.remove());clone.querySelectorAll('br').forEach(e=>e.replaceWith(document.createTextNode('\n')));clone.querySelectorAll('p,li,pre,tr,h1,h2,h3').forEach(e=>e.appendChild(document.createTextNode('\n\n')));return clone.textContent||''}).join('\n\n').trim():parts.join(' ').replace(/\s+/g, ' ').trim();
            return { srcs, reply };
        }, marker, mediaType === "image" ? "img" : SEL.resultVideo, mediaType, excluded, textPurpose);
    }
    /**
     * Chạy 1 job: đính kèm ảnh, gửi prompt vào chat Muse, chờ video trả về ngay sau tin nhắn đó, tải về.
     * onTick được gọi mỗi vài giây để dispatcher cập nhật tiến độ.
     */
    async runJob(opts) {
        const { jobId, accountId } = opts;
        const isImage = opts.mediaType === "image", isText = opts.mediaType === "text";
        let excludedImages = [];
        this.cancelled.delete(jobId);
        const startedAt = Date.now();
        const elapsed = () => Math.round((Date.now() - startedAt) / 1000);
        const checkCancel = () => {
            if (this.cancelled.has(jobId))
                throw new Error('CANCELLED');
        };
        const browser = await this.getBrowser(accountId);
        checkCancel();
        const page = await browser.newPage();
        this.jobPages.set(jobId, page);
        try {
            checkCancel();
            opts.onTick(elapsed(), 'Đang mở Muse');
            const gotoMuse = async () => {
                try {
                    await page.goto(MUSE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
                }
                catch (err) {
                    const m = String(err?.message || err);
                    // Chrome không nhận cấu hình proxy của tài khoản -> báo rõ, không phải lỗi Muse
                    if (m.includes('ERR_NO_SUPPORTED_PROXIES')) {
                        throw new Error('PROXY_NETWORK_ERROR: Chrome không nhận cấu hình proxy của tài khoản này (ERR_NO_SUPPORTED_PROXIES) - kiểm tra lại proxy trong Cài đặt');
                    }
                    if (!/ERR_|timeout/i.test(m))
                        throw err;
                    // lỗi mạng: để vòng dưới tải lại
                }
            };
            await gotoMuse();
            let state = await this.waitForAppState(page);
            if (state === 'unknown') {
                // Trang trắng / mạng chập chờn: tải lại muse.ai 1 lần trước khi coi là lỗi
                opts.onTick(elapsed(), 'Muse tải chậm, đang tải lại trang');
                await gotoMuse();
                state = await this.waitForAppState(page, 40000);
            }
            if (state === 'logged_out')
                throw new Error('SESSION_EXPIRED');
            if (state !== 'logged_in') {
                await this.saveDebug(page, `open_${jobId}`);
                // Trang trống = muse.ai không tải được (mạng/proxy không phản hồi), không phải lỗi giao diện Muse
                const textLen = await page.evaluate(() => (document.body?.innerText || '').trim().length).catch(() => 0);
                // Trang lỗi của Chrome ("This site can't be reached ... ERR_CONNECTION_CLOSED"): mạng/proxy chặn, Muse chưa hề được mở
                const netErr = await page
                    .evaluate(() => {
                    const t = document.body?.innerText || '';
                    const code = t.match(/ERR_[A-Z_]+/)?.[0];
                    return location.href.startsWith('chrome-error://') || /This site can.t be reached|Không thể truy cập trang web/i.test(t)
                        ? code || 'ERR_NETWORK'
                        : null;
                })
                    .catch(() => null);
                if (netErr) {
                    throw new Error(`PROXY_NETWORK_ERROR: Không kết nối được muse.ai (${netErr}) - mạng hoặc proxy chặn/ngắt kết nối`);
                }
                if (textLen < 20) {
                    throw new Error('PROXY_NETWORK_ERROR: Không tải được muse.ai (trang trống) - mạng hoặc proxy không phản hồi');
                }
                throw new Error('Không mở được giao diện chat Muse');
            }
            checkCancel();
            // Bắt buộc: Đợi kết nối Muse sẵn sàng (hết Connecting...)
            opts.onTick(elapsed(), 'Đang kiểm tra kết nối Muse');
            await this.waitForMuseReady(page, 25000);
            checkCancel();
            await sleep(1000);
            await this.handleOnboardingIfNeeded(page);
            const baseMarker = opts.attemptNum && opts.attemptNum > 0 ? `[${jobId}#${opts.attemptNum}]` : `[${jobId}]`;
            let activeMarker = baseMarker;
            opts.onTick(elapsed(), 'Đang gửi ảnh và prompt');
            // Each delivery attempt must upload and confirm its own attachments.
            // Reloading after a failed delivery discards the previous composer files.
            const attachedFiles = [...opts.refFiles];
            // Thử gửi prompt: có cơ chế tự phục hồi nếu bị Delivery not confirmed ngay trong phiên
            let sendOk = false;
            if (isImage) excludedImages = await page.evaluate(() => [...document.images].map(i => i.currentSrc || i.src));
            for (let sendTry = 1; sendTry <= 3; sendTry++) {
                checkCancel();
                await this.attachImages(page, opts.refFiles);
                await this.waitForAttachments(page, opts.refFiles);
                checkCancel();
                activeMarker = sendTry === 1 ? baseMarker : `${baseMarker}_r${sendTry}`;
                const fullPrompt = isText && opts.textPurpose==='code' ? `Bạn là trợ lý lập trình. Thực hiện yêu cầu phân tích mã nguồn bên dưới. Không viết prompt tạo media, không tạo ảnh/video. Trả MONDAY_PROMPT_BEGIN, sau đó khối mã markdown ba dấu backtick với ngôn ngữ json chứa JSON hợp lệ, rồi MONDAY_PROMPT_END ở ngoài khối mã. BẮT BUỘC khối mã để bảo toàn JSX/HTML; escape dấu nháy và xuống dòng đúng JSON. Mã job: ${activeMarker}\n\n${opts.prompt}` : isText ? `Chỉ trả lời bằng văn bản, KHÔNG tạo ảnh, video hay gọi công cụ sinh media. Viết prompt theo yêu cầu bên dưới. Đặt nội dung giữa MONDAY_PROMPT_BEGIN và MONDAY_PROMPT_END. Mã job: ${activeMarker}\n\n${opts.prompt}` : (isImage ? `Tạo 1 ảnh, tỉ lệ khung hình ${opts.ratio}` : `Tạo 1 video ${opts.duration} giây, tỉ lệ khung hình ${opts.ratio}`) +
                    (opts.refFiles.length ? `, dùng ${opts.refFiles.length} ảnh đính kèm làm tham chiếu` : '') +
                    `. Không hỏi lại, tự quyết định chi tiết và trả về file ${isImage ? "ảnh" : "video"}. Mã job: ${activeMarker}\n\n${opts.prompt}` +
                    // Khối vai trò & ưu tiên tham chiếu: tách riêng sau prompt gốc, không sửa prompt của người dùng
                    (opts.refManifest ? `\n\n${opts.refManifest}` : '') + (isImage ? `\n\nFINAL OUTPUT FRAME: ${opts.ratio}. This selected aspect ratio overrides all aspect ratios mentioned earlier or visible in references. Compose the whole image natively in this frame; do not return a square/portrait default when a different ratio is selected.` : `\n\nPreserve source material texture, natural skin pores, fabric weave, product geometry and reflections across frames. Avoid waxy/plastic skin, texture drift, flicker, morphing, extra fingers, artificial oversharpening and sudden camera jumps.`);
                await this.typePrompt(page, fullPrompt);
                // Enter may only insert a newline in the current composer. Click the
                // actual Send control and require the task marker in a user message.
                const send=await page.waitForSelector('button[data-pel-click="chat_send_message"]:not([disabled]),button[aria-label="Send"]:not([disabled])',{visible:true,timeout:15000});
                await send.click();
                await page.waitForFunction(marker=>[...document.querySelectorAll('[data-message-item][data-message-role="user"]')].some(el=>(el.textContent||'').includes(marker)),{timeout:20000},activeMarker).catch(()=>{throw new Error('DELIVERY_NOT_CONFIRMED: MUSE chưa gửi tin nhắn. Ảnh còn ở ô soạn; kiểm tra kết nối rồi thử lại.');});
                checkCancel();
                // Chờ 5s xem tin nhắn có bị Delivery not confirmed không
                await sleep(5000);
                checkCancel();
                const isDeliveryFailed = await page.evaluate((m) => {
                    const turn = [...document.querySelectorAll('[data-message-item][data-message-role="user"]')].findLast(el => (el.textContent || '').includes(m));
                    return !!turn && (turn.textContent || '').includes('Delivery not confirmed');
                }, activeMarker).catch(() => false);
                if (!isDeliveryFailed) {
                    if(opts.refFiles.length){
                        try {
                            await page.waitForFunction((marker,expected)=>{
                                const turn=[...document.querySelectorAll('[data-message-item][data-message-role="user"]')].findLast(el=>(el.textContent||'').includes(marker));
                                if(!turn)return false;
                                return [...turn.querySelectorAll('img')].filter(img=>!img.closest('[data-hatch-avatar-host],[data-hatch-avatar-stage]')).length>=expected;
                            },{timeout:15000},activeMarker,opts.refFiles.length);
                        } catch {
                            await this.saveDebug(page,'sent_reference_missing_'+jobId);
                            throw new Error('REFERENCE_UPLOAD_ERROR: Tin nhắn đã gửi chưa xác nhận đủ ảnh tham chiếu. Không công nhận kết quả để tránh dùng sai chủ thể.');
                        }
                    }
                    sendOk = true;
                    break;
                }
                console.warn(`[MuseWorker] Lượt gửi ${sendTry} bị 'Delivery not confirmed'. Đang đợi proxy ổn định và gửi lại...`);
                opts.onTick(elapsed(), `Mạng chậm hoặc proxy đang đổi IP, đang gửi lại lệnh (lần ${sendTry + 1})...`);
                await this.saveDebug(page, `delivery_error_${jobId}_try${sendTry}`);
                await sleep(8000);
                await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => { });
                await this.waitForMuseReady(page, 25000);
                await sleep(2000);
            }
            if (!sendOk) {
                throw new Error('PROXY_NETWORK_ERROR: Tin nhắn gửi vào Muse không được xác nhận (Delivery not confirmed) - Lỗi proxy hoặc mạng ngắt kết nối.');
            }
            // Chờ video mới xuất hiện rồi đứng yên một lúc (Muse có thể gửi nhiều tin liên tiếp).
            let lastNew = null;
            let stableSince = 0;
            let errorReply = '';
            let errorSince = 0;
            let usageReply = '';
            let usageSince = 0;
            while (true) {
                await sleep(4000);
                checkCancel();
                if (Date.now() - startedAt > (isImage ? Math.min(opts.timeoutMs, 5 * 60 * 1000) : opts.timeoutMs)) {
                    await this.saveDebug(page, `timeout_${jobId}`);
                    throw new Error(isText?'MUSE chưa trả prompt hoàn chỉnh trong thời gian cho phép':isImage ? 'Muse không trả ảnh trong thời gian cho phép' : 'Muse không trả video trong thời gian cho phép');
                }
                // Kiểm tra lỗi không gửi được tin nhắn (Delivery not confirmed)
                const hasDeliveryError = await page.evaluate((m) => {
                    const turn = [...document.querySelectorAll('[data-message-item][data-message-role="user"]')].findLast(el => (el.textContent || '').includes(m));
                    return !!turn && (turn.textContent || '').includes('Delivery not confirmed');
                }, activeMarker).catch(() => false);
                if (hasDeliveryError) {
                    await this.saveDebug(page, `delivery_error_${jobId}`);
                    throw new Error('PROXY_NETWORK_ERROR: Tin nhắn gửi vào Muse không được xác nhận (Delivery not confirmed) - Lỗi proxy hoặc mạng ngắt kết nối.');
                }
                const res = await this.resultVideosAfter(page, activeMarker, opts.mediaType, excludedImages, opts.textPurpose).catch(() => ({ srcs: [], reply: '' }));
                if(isText){if(MUSE_USAGE_RE.test(res.reply))throw Error('USAGE_LIMIT:'+res.reply.slice(0,200));const match=res.reply.match(/MONDAY_PROMPT_BEGIN([\s\S]*?)MONDAY_PROMPT_END/);if(match&&match[1].trim()){const text=match[1].trim();if(lastNew!==text){lastNew=text;stableSince=Date.now()}else if(Date.now()-stableSince>8000){fs_1.default.mkdirSync(VIDEOS_DIR,{recursive:true});const name=`prompt_${jobId}.txt`,file=path_1.default.join(VIDEOS_DIR,name);fs_1.default.writeFileSync(file,text,'utf8');return {videoUrl:'/videos/'+name,thumbnailUrl:null,attachedFiles:[]}}}opts.onTick(elapsed(),'MUSE đang viết prompt');continue}
                const newest = res.srcs[0] || null;
                const imageFailure=isImage&&!newest?require('./museReplyFailure.cjs').imageReplyFailure(res.reply):null;
                if(imageFailure){
                    if(errorReply!==imageFailure){errorReply=imageFailure;errorSince=Date.now()}
                    else if(Date.now()-errorSince>8000)throw new Error(imageFailure);
                }

                // Muse báo hết hạn mức / dùng quá nhiều / cần xác minh: dừng hẳn tài khoản này một thời gian (không retry ngay)
                if (!newest && MUSE_USAGE_RE.test(res.reply)) {
                    if (res.reply !== usageReply) {
                        usageReply = res.reply;
                        usageSince = Date.now();
                    }
                    else if (Date.now() - usageSince > 10000) {
                        throw new Error(`USAGE_LIMIT:${res.reply.slice(0, 200)}`);
                    }
                    continue;
                }
                // Muse từ chối (nội dung) hoặc báo lỗi (kỹ thuật) mà không có video: dừng sớm, không chờ tới timeout.
                // Từ chối nội dung -> cần đổi prompt (không thử lại). Lỗi kỹ thuật -> thử lại như bình thường.
                const isPolicy = MUSE_POLICY_RE.test(res.reply);
                if (!isImage && !newest && (isPolicy || MUSE_ERROR_RE.test(res.reply))) {
                    if (res.reply !== errorReply) {
                        errorReply = res.reply;
                        errorSince = Date.now();
                    }
                    else if (Date.now() - errorSince > 5000) {
                        if (isPolicy)
                            throw new Error(`PROMPT_POLICY_ERROR: Muse từ chối tạo video: "${res.reply.slice(0, 300)}"`);
                        throw new Error(`Muse báo lỗi khi tạo video: "${res.reply.slice(0, 200)}"`);
                    }
                }
                if (newest && newest !== lastNew) {
                    lastNew = newest;
                    stableSince = Date.now();
                }
                opts.onTick(elapsed(), isImage ? (lastNew ? 'Đang kiểm tra ảnh kết quả' : 'Muse đang tạo ảnh') : (lastNew ? 'Muse đã trả video, đang chờ hoàn tất' : 'Muse đang tạo video'));
                if (lastNew && Date.now() - stableSince > 8000)
                    break;
            }
            opts.onTick(elapsed(), 'Đang tải video về');
            const b64 = await page.evaluate(async (src) => {
                const res = await fetch(src, { credentials: 'include' });
                if (!res.ok)
                    throw new Error(`HTTP ${res.status}`);
                const buf = new Uint8Array(await res.arrayBuffer());
                let s = '';
                for (let i = 0; i < buf.length; i += 0x8000)
                    s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
                return btoa(s);
            }, lastNew);
            fs_1.default.mkdirSync(VIDEOS_DIR, { recursive: true });
            if (isImage) {
                const data = Buffer.from(b64, 'base64');
                let ext = null;
                if (data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) ext = 'png';
                else if (data[0] === 255 && data[1] === 216 && data[2] === 255) ext = 'jpg';
                else if (data.toString('ascii',0,4) === 'RIFF' && data.toString('ascii',8,12) === 'WEBP') ext = 'webp';
                if (!ext || data.length < 1024) throw new Error('Kết quả không phải ảnh PNG, JPG hoặc WebP hợp lệ');
                if((require('./faceSwapContract.cjs').isFaceSwap(opts.prompt)||String(opts.prompt||'').startsWith('BATCH VISUAL RECREATION.'))&&opts.refFiles.some(file=>fs_1.default.existsSync(file)&&fs_1.default.readFileSync(file).equals(data)))throw new Error('MUSE trả lại nguyên ảnh tham chiếu, chưa thực hiện yêu cầu thay chủ thể. Vui lòng tạo lại hoặc dùng ảnh gốc rõ chi tiết hơn.');
                const filename = `image_${jobId}.${ext}`;
                const target = path_1.default.join(VIDEOS_DIR, filename);
                fs_1.default.writeFileSync(target + '.tmp', data);
                fs_1.default.renameSync(target + '.tmp', target);

                const framed=await require('./imageRatio').enforce(target,opts.ratio);const finalUrl='/videos/'+path_1.default.basename(framed.file);return {videoUrl:finalUrl,thumbnailUrl:finalUrl,attachedFiles};
            }
            const videoFile = `video_${jobId}.mp4`;
            const videoPath = path_1.default.join(VIDEOS_DIR, videoFile);
            fs_1.default.writeFileSync(videoPath, Buffer.from(b64, 'base64'));
            if (fs_1.default.statSync(videoPath).size < 10_000)
                throw new Error('File video tải về quá nhỏ, có thể không hợp lệ');
            let thumbnailUrl = null;
            const thumbFile = `thumb_${jobId}.jpg`;
            const r = (0, child_process_1.spawnSync)('ffmpeg', ['-y', '-ss', '1', '-i', videoPath, '-frames:v', '1', '-q:v', '3', path_1.default.join(VIDEOS_DIR, thumbFile)], { timeout: 30000, windowsHide: true });
            if (r.status === 0 && fs_1.default.existsSync(path_1.default.join(VIDEOS_DIR, thumbFile)))
                thumbnailUrl = `/videos/${thumbFile}`;
            return { videoUrl: `/videos/${videoFile}`, thumbnailUrl, attachedFiles };
        }
        finally {
            this.jobPages.delete(jobId);
            this.cancelled.delete(jobId);
            await page.close().catch(() => { });
        }
    }
}
exports.museWorker = new MuseWorker();
