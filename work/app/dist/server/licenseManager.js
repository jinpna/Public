"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.licenseManager = exports.WEB_BASE_URL = void 0;
exports.getMachineId = getMachineId;
exports.openExternalUrl = openExternalUrl;
const https_1 = __importDefault(require("https"));
const http_1 = __importDefault(require("http"));
const os_1 = __importDefault(require("os"));
const crypto_1 = __importDefault(require("crypto"));
const child_process_1 = require("child_process");
const db_1 = require("./db");
const ws_1 = require("./ws");
exports.WEB_BASE_URL = process.env.MUSEE_WEB_URL || 'https://musee.socialboxy.com';
// Lấy mã phần cứng duy nhất của máy tính (Machine GUID) để chống lách dùng thử
function getMachineId() {
    try {
        if (process.platform === 'win32') {
            const stdout = (0, child_process_1.execSync)('reg query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid', {
                encoding: 'utf8',
                windowsHide: true,
                timeout: 2000,
            });
            const match = stdout.match(/MachineGuid\s+REG_SZ\s+([a-f0-9-]+)/i);
            if (match && match[1]) {
                return crypto_1.default.createHash('sha256').update('MUSEE_HW_' + match[1].trim()).digest('hex').slice(0, 32);
            }
        }
    }
    catch { }
    return crypto_1.default.createHash('sha256').update('MUSEE_FALLBACK_' + os_1.default.hostname()).digest('hex').slice(0, 32);
}
// Mở link ngoài trình duyệt mặc định của hệ điều hành
function openExternalUrl(url) {
    try {
        if (process.platform === 'win32') {
            (0, child_process_1.exec)(`start "" "${url}"`);
        }
        else if (process.platform === 'darwin') {
            (0, child_process_1.exec)(`open "${url}"`);
        }
        else {
            (0, child_process_1.exec)(`xdg-open "${url}"`);
        }
    }
    catch (err) {
        console.error('[LicenseManager] Failed to open external URL:', err.message);
    }
}
function makeHttpRequest(urlStr, options) {
    return new Promise((resolve, reject) => {
        try {
            const parsedUrl = new URL(urlStr);
            const isHttps = parsedUrl.protocol === 'https:';
            const client = isHttps ? https_1.default : http_1.default;
            const headers = {
                'User-Agent': 'Musee-App/1.0',
                ...(options.headers || {})
            };
            if (options.body) {
                headers['Content-Type'] = 'application/json';
                headers['Content-Length'] = Buffer.byteLength(options.body).toString();
            }
            const req = client.request(parsedUrl, {
                method: options.method || 'GET',
                headers,
                timeout: 10000,
            }, (res) => {
                let raw = '';
                res.on('data', (chunk) => { raw += chunk; });
                res.on('end', () => {
                    let data = null;
                    try {
                        data = JSON.parse(raw);
                    }
                    catch {
                        data = raw;
                    }
                    resolve({ statusCode: res.statusCode || 200, data, rawBody: raw });
                });
            });
            req.on('error', (err) => reject(err));
            req.on('timeout', () => {
                req.destroy();
                reject(new Error('Yêu cầu tới máy chủ bản quyền bị quá hạn (timeout)'));
            });
            if (options.body) {
                req.write(options.body);
            }
            req.end();
        }
        catch (err) {
            reject(err);
        }
    });
}
function getSetting(key) {
    try {
        const row = db_1.db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key);
        return row?.value ?? null;
    }
    catch {
        return null;
    }
}
function setSetting(key, value) {
    try {
        db_1.db.prepare(`
      INSERT INTO settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(key, value);
    }
    catch (err) {
        console.error(`[LicenseManager] Error setting ${key}:`, err.message);
    }
}
function removeSetting(key) {
    try {
        db_1.db.prepare(`DELETE FROM settings WHERE key = ?`).run(key);
    }
    catch (err) {
        console.error(`[LicenseManager] Error deleting ${key}:`, err.message);
    }
}
class LicenseManager {
    currentLicense = {
        isLoggedIn: false,
        email: null,
        status: 'unregistered',
        allowed: false,
        expiresAt: null,
        daysLeft: 0,
        price: 99000,
        renewDays: 30,
        renewUrl: `${exports.WEB_BASE_URL}/tai-khoan#gia-han`,
        isTrial: false,
        message: '',
    };
    checkIntervalTimer = null;
    constructor() {
        this.loadCachedLicense();
    }
    isMasterMode() {
        return process.env.MUSE_MASTER_MODE === '1';
    }
    loadCachedLicense() {
        if (this.isMasterMode()) {
            this.currentLicense = {
                isLoggedIn: true,
                email: 'Monday.Directory',
                status: 'active',
                allowed: true,
                expiresAt: null,
                daysLeft: 9999,
                price: 0,
                renewDays: 0,
                renewUrl: '',
                isTrial: false,
                message: 'Bản quyền thuộc về Monday.directory',
            };
            return;
        }
        const token = getSetting('license_app_token');
        const cachedJson = getSetting('license_cached_json');
        if (token && cachedJson) {
            try {
                const parsed = JSON.parse(cachedJson);
                this.currentLicense = {
                    ...parsed,
                    isLoggedIn: true,
                    isTrial: parsed.status === 'trial',
                };
            }
            catch {
                // ignore
            }
        }
    }
    getLicense() {
        return this.currentLicense;
    }
    isTrialMode() {
        if (this.isMasterMode())
            return false;
        return this.currentLicense.isLoggedIn && this.currentLicense.isTrial;
    }
    isFeatureBlocked(feature) {
        if (this.isMasterMode())
            return false;
        if (feature === 'proxy') {
            // Trong thời gian dùng thử (Trial), tính năng proxy bị khóa (chỉ dùng mạng máy trực tiếp)
            return this.isTrialMode();
        }
        return false;
    }
    isAppAllowed() {
        if (this.isMasterMode())
            return true;
        return this.currentLicense.isLoggedIn && this.currentLicense.allowed;
    }
    /**
     * Bước 1: Khởi tạo Device Login Flow với Google
     */
    async startDeviceLogin() {
        const machineId = getMachineId();
        const deviceName = `${os_1.default.hostname()} (${os_1.default.platform()})`;
        const res = await makeHttpRequest(`${exports.WEB_BASE_URL}/api/app/start`, {
            method: 'POST',
            body: JSON.stringify({
                device: deviceName,
                device_id: machineId,
            })
        });
        if (res.statusCode !== 200 || !res.data?.device_code) {
            throw new Error(res.data?.error || 'Không thể khởi tạo đăng nhập với máy chủ');
        }
        const { device_code, user_code, verify_url, interval, expires_in } = res.data;
        // Mở trang đăng nhập qua /auth/google?next=... để Google luôn hiện danh sách "Chọn tài khoản Gmail" (prompt=select_account)
        // Người dùng được chọn tài khoản tuỳ thích như các app thông thường, không bị bắt dính nick mặc định cũ.
        const googleLoginUrl = `${exports.WEB_BASE_URL}/auth/google?next=${encodeURIComponent('/ket-noi-app?code=' + user_code)}`;
        openExternalUrl(googleLoginUrl);
        return {
            device_code,
            user_code,
            verify_url: googleLoginUrl,
            interval: interval || 3,
            expires_in: expires_in || 600
        };
    }
    /**
     * Bước 2: Kiểm tra trạng thái người dùng đã bấm Cho phép trên trình duyệt chưa
     */
    async pollDeviceLogin(deviceCode) {
        const res = await makeHttpRequest(`${exports.WEB_BASE_URL}/api/app/poll`, {
            method: 'POST',
            body: JSON.stringify({ device_code: deviceCode })
        });
        if (res.statusCode === 400 && res.data?.error === 'expired') {
            return { status: 'expired' };
        }
        if (res.statusCode === 200 && res.data?.status === 'ok' && res.data?.app_token) {
            const appToken = res.data.app_token;
            setSetting('license_app_token', appToken);
            // Lấy ngay thông tin bản quyền và cập nhật
            const license = await this.checkLicenseOnline(appToken);
            return { status: 'ok', license };
        }
        return { status: 'pending' };
    }
    /**
     * Bước 3: Kiểm tra bản quyền trực tuyến từ máy chủ
     */
    async checkLicenseOnline(providedToken) {
        if (this.isMasterMode()) {
            return this.currentLicense;
        }
        const token = providedToken || getSetting('license_app_token');
        if (!token) {
            this.currentLicense = {
                isLoggedIn: false,
                email: null,
                status: 'unregistered',
                allowed: false,
                expiresAt: null,
                daysLeft: 0,
                price: 99000,
                renewDays: 30,
                renewUrl: `${exports.WEB_BASE_URL}/tai-khoan#gia-han`,
                isTrial: false,
                message: 'Chưa đăng nhập tài khoản',
            };
            (0, ws_1.broadcast)('LICENSE_UPDATED', this.currentLicense);
            return this.currentLicense;
        }
        try {
            const res = await makeHttpRequest(`${exports.WEB_BASE_URL}/api/app/license`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            if (res.statusCode === 401) {
                console.warn('[LicenseManager] Token bản quyền đã hết hiệu lực hoặc bị thu hồi');
                removeSetting('license_app_token');
                removeSetting('license_cached_json');
                this.currentLicense = {
                    isLoggedIn: false,
                    email: null,
                    status: 'unregistered',
                    allowed: false,
                    expiresAt: null,
                    daysLeft: 0,
                    price: 99000,
                    renewDays: 30,
                    renewUrl: `${exports.WEB_BASE_URL}/tai-khoan#gia-han`,
                    isTrial: false,
                    message: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.',
                };
                (0, ws_1.broadcast)('LICENSE_UPDATED', this.currentLicense);
                return this.currentLicense;
            }
            if (res.statusCode === 200 && res.data) {
                const d = res.data;
                const nowIso = new Date().toISOString();
                const isTrial = d.status === 'trial';
                const isAllowed = !!d.allowed;
                this.currentLicense = {
                    isLoggedIn: true,
                    email: d.email || null,
                    status: d.status || (isAllowed ? 'active' : 'expired'),
                    allowed: isAllowed,
                    expiresAt: d.expires_at || null,
                    daysLeft: typeof d.days_left === 'number' ? d.days_left : 0,
                    price: d.price || 99000,
                    renewDays: d.renew_days || 30,
                    renewUrl: d.renew_url || `${exports.WEB_BASE_URL}/tai-khoan#gia-han`,
                    isTrial,
                    message: d.message || (isAllowed ? '' : 'Bản dùng thử đã hết hạn. Vui lòng gia hạn để tiếp tục.'),
                    checkedAt: nowIso
                };
                setSetting('license_cached_json', JSON.stringify(this.currentLicense));
                setSetting('license_last_checked', nowIso);
                console.log(`[LicenseManager] License verified: ${this.currentLicense.email} - Status: ${this.currentLicense.status} (Allowed: ${isAllowed}, DaysLeft: ${this.currentLicense.daysLeft})`);
                (0, ws_1.broadcast)('LICENSE_UPDATED', this.currentLicense);
                return this.currentLicense;
            }
            throw new Error(res.data?.error || `Máy chủ phản hồi mã ${res.statusCode}`);
        }
        catch (err) {
            console.warn('[LicenseManager] Kiểm tra trực tuyến không thành công, chuyển sang cơ chế cache ngoại tuyến:', err.message);
            // Cơ chế Offline Grace: Nếu lần kiểm tra thành công gần nhất chưa quá 24h và còn hạn dùng -> cho phép chạy tiếp
            const lastCheckedStr = getSetting('license_last_checked');
            const cachedJson = getSetting('license_cached_json');
            if (lastCheckedStr && cachedJson) {
                const lastCheckedTime = new Date(lastCheckedStr).getTime();
                const hoursPassed = (Date.now() - lastCheckedTime) / (1000 * 60 * 60);
                if (hoursPassed < 24) {
                    try {
                        const cached = JSON.parse(cachedJson);
                        if (cached.allowed) {
                            this.currentLicense = {
                                ...cached,
                                message: 'Đang hoạt động chế độ ngoại tuyến (đã xác thực trong 24 giờ)',
                            };
                            (0, ws_1.broadcast)('LICENSE_UPDATED', this.currentLicense);
                            return this.currentLicense;
                        }
                    }
                    catch { }
                }
            }
            // Quá 24h mất mạng hoặc cache hết hạn -> khóa
            this.currentLicense = {
                ...this.currentLicense,
                allowed: false,
                message: 'Vui lòng kết nối mạng để xác thực bản quyền với máy chủ',
            };
            (0, ws_1.broadcast)('LICENSE_UPDATED', this.currentLicense);
            return this.currentLicense;
        }
    }
    /**
     * Đăng xuất khỏi ứng dụng
     */
    async logout() {
        const token = getSetting('license_app_token');
        if (token) {
            try {
                await makeHttpRequest(`${exports.WEB_BASE_URL}/api/app/logout`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${token}` }
                });
            }
            catch {
                // ignore
            }
        }
        removeSetting('license_app_token');
        removeSetting('license_cached_json');
        removeSetting('license_last_checked');
        this.currentLicense = {
            isLoggedIn: false,
            email: null,
            status: 'unregistered',
            allowed: false,
            expiresAt: null,
            daysLeft: 0,
            price: 99000,
            renewDays: 30,
            renewUrl: `${exports.WEB_BASE_URL}/tai-khoan#gia-han`,
            isTrial: false,
            message: 'Đã đăng xuất',
        };
        (0, ws_1.broadcast)('LICENSE_UPDATED', this.currentLicense);
    }
    /**
     * Khởi động lịch kiểm tra định kỳ (mỗi 20 phút)
     */
    startPeriodicCheck() {
        if (this.isMasterMode())
            return;
        if (this.checkIntervalTimer)
            return;
        // Kiểm tra ngay khi khởi động
        setTimeout(() => {
            this.checkLicenseOnline().catch((e) => console.warn('[LicenseManager] Initial check warning:', e.message));
        }, 2000);
        // Kiểm tra định kỳ mỗi 20 phút
        this.checkIntervalTimer = setInterval(() => {
            this.checkLicenseOnline().catch((e) => console.warn('[LicenseManager] Periodic check warning:', e.message));
        }, 20 * 60 * 1000);
    }
}
exports.licenseManager = new LicenseManager();
