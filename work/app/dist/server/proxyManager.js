"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseProxyLine = parseProxyLine;
exports.checkStaticProxy = checkStaticProxy;
exports.checkSingleProxy = checkSingleProxy;
exports.checkAllProxies = checkAllProxies;
exports.getOrCreateLocalBridge = getOrCreateLocalBridge;
exports.resolveChromeProxyArgs = resolveChromeProxyArgs;
exports.shuffleArray = shuffleArray;
exports.assignProxiesToAccounts = assignProxiesToAccounts;
exports.clearAssignedProxies = clearAssignedProxies;
exports.getVaultProxyCount = getVaultProxyCount;
exports.autoReassignProxyForAccount = autoReassignProxyForAccount;
exports.autoReassignFailingAccounts = autoReassignFailingAccounts;
const net_1 = __importDefault(require("net"));
const http_1 = __importDefault(require("http"));
const db_1 = require("./db");
const ws_1 = require("./ws");
// -------------------------------------------------------------
// 1. Phân tích dòng proxy (Parse Proxy String)
// -------------------------------------------------------------
function parseProxyLine(rawLine) {
    const line = (rawLine || '').trim();
    if (!line || line.startsWith('#') || line.startsWith('//'))
        return null;
    // 1. Key proxy xoay dạng có tiền tố: proxyvn: KEY, tmproxy: KEY, shoplike: KEY...
    const prefixMatch = line.match(/^(proxyvn|tmproxy|shoplike|tinproxy|wwproxy):\s*(.+)$/i);
    if (prefixMatch) {
        const provider = prefixMatch[1].toLowerCase();
        const key = prefixMatch[2].trim();
        return {
            raw: line,
            type: 'rotating',
            provider,
            key,
        };
    }
    // 2. URL xoay IP
    if (/^https?:\/\//i.test(line)) {
        let provider = 'custom_url';
        if (line.includes('proxy.vn') || line.includes('proxyxoay'))
            provider = 'proxyvn';
        else if (line.includes('tmproxy.com'))
            provider = 'tmproxy';
        else if (line.includes('shoplike.vn'))
            provider = 'shoplike';
        return {
            raw: line,
            type: 'rotating',
            provider,
            url: line,
        };
    }
    // 3. SOCKS5 hoặc HTTP có scheme: socks5://user:pass@host:port
    if (/^(socks5|http|https):\/\//i.test(line)) {
        try {
            const parsedUrl = new URL(line);
            const protocol = parsedUrl.protocol.replace(':', '').toLowerCase();
            return {
                raw: line,
                type: 'static',
                provider: 'static',
                protocol,
                host: parsedUrl.hostname,
                port: Number(parsedUrl.port) || (protocol === 'socks5' ? 1080 : 80),
                user: parsedUrl.username ? decodeURIComponent(parsedUrl.username) : undefined,
                pass: parsedUrl.password ? decodeURIComponent(parsedUrl.password) : undefined,
            };
        }
        catch {
            // fallback
        }
    }
    // 4. user:pass@host:port
    const atMatch = line.match(/^([^:@]+):([^@]+)@([^:]+):(\d+)$/);
    if (atMatch) {
        return {
            raw: line,
            type: 'static',
            provider: 'static',
            host: atMatch[3],
            port: Number(atMatch[4]),
            user: atMatch[1],
            pass: atMatch[2],
            protocol: 'http',
        };
    }
    // 5. host:port:user:pass hoặc host:port
    const colonParts = line.split(':');
    if (colonParts.length === 4) {
        return {
            raw: line,
            type: 'static',
            provider: 'static',
            host: colonParts[0].trim(),
            port: Number(colonParts[1].trim()),
            user: colonParts[2].trim(),
            pass: colonParts[3].trim(),
            protocol: 'http',
        };
    }
    if (colonParts.length === 2 && /^\d+$/.test(colonParts[1].trim())) {
        return {
            raw: line,
            type: 'static',
            provider: 'static',
            host: colonParts[0].trim(),
            port: Number(colonParts[1].trim()),
            protocol: 'http',
        };
    }
    // 6. Nếu chỉ có một chuỗi ký tự không có dấu hai chấm và độ dài > 10, coi như key proxyvn
    if (/^[a-zA-Z0-9_-]{10,80}$/.test(line)) {
        return {
            raw: `proxyvn: ${line}`,
            type: 'rotating',
            provider: 'proxyvn',
            key: line,
        };
    }
    return null;
}
// -------------------------------------------------------------
// 2. Kết nối API Key proxy xoay & Kiểm tra Hạn mức (Usage Limit)
// -------------------------------------------------------------
async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, { ...options, signal: controller.signal });
        return res;
    }
    finally {
        clearTimeout(timer);
    }
}
/** Kiểm tra và lấy IP từ proxyvn */
async function checkProxyVn(key, requestNew = false) {
    const raw = `proxyvn: ${key}`;
    const parsed = { raw, type: 'rotating', provider: 'proxyvn', key };
    const checkedAt = new Date().toISOString();
    // Thử các endpoint của proxyvn / proxyxoay
    const endpoints = requestNew
        ? [`https://proxyxoay.shop/api/get.php?key=${encodeURIComponent(key)}`]
        : [`https://proxyxoay.shop/api/get.php?key=${encodeURIComponent(key)}`];
    for (const ep of endpoints) {
        try {
            const startTime = Date.now();
            const res = await fetchWithTimeout(ep, { headers: { 'User-Agent': 'Musee-Proxy/1.0' } }, 7000);
            const latencyMs = Date.now() - startTime;
            const text = await res.text();
            let json = null;
            try {
                json = JSON.parse(text);
            }
            catch {
                // Có thể trả về text dạng ip:port
                const m = text.match(/(\d{1,3}(?:\.\d{1,3}){3}):(\d+)/);
                if (m) {
                    return {
                        raw,
                        parsed,
                        status: 'live',
                        ok: true,
                        ip: m[1],
                        port: Number(m[2]),
                        latencyMs,
                        message: `Hoạt động tốt (${latencyMs}ms)`,
                        checkedAt,
                    };
                }
            }
            if (json) {
                // Status 100: Thành công
                if (json.status === 100 || json.code === 0 || json.status === 'success') {
                    const proxyStr = json.proxyhttp || json.proxysocks5 || json.data?.http || json.data?.proxy || json.proxy || '';
                    const match = proxyStr.match(/(\d{1,3}(?:\.\d{1,3}){3}):(\d+)/);
                    const ip = match ? match[1] : undefined;
                    const port = match ? Number(match[2]) : undefined;
                    const ttlMsg = json.message || json.time || '';
                    return {
                        raw,
                        parsed,
                        status: 'live',
                        ok: true,
                        ip,
                        port,
                        latencyMs,
                        message: `IP: ${proxyStr || 'Sẵn sàng'} (${latencyMs}ms)`,
                        usageDetails: typeof ttlMsg === 'string' ? ttlMsg : `Hết hạn sau ${ttlMsg}s`,
                        checkedAt,
                    };
                }
                // 1. Kiểm tra Cooldown / Chờ đổi IP trước (Rate limit / Cooldown)
                const msg = (json.message || json.mess || json.msg || '').toLowerCase();
                const isRateLimit = json.status === 101 ||
                    /con\s+\d+\s*s|đợi|chờ|wait|rate\s*limit|cooldown|moi\s+co\s+the\s+doi/i.test(msg);
                if (isRateLimit) {
                    const secMatch = msg.match(/(\d+)\s*(s|giây|second)/i);
                    const nextSec = secMatch ? Number(secMatch[1]) : 30;
                    // Thử trích xuất IP:Port nếu nhà mạng vẫn trả về kèm thông báo cooldown
                    const proxyStr = json.proxyhttp || json.proxysocks5 || json.data?.http || json.data?.proxy || json.proxy || '';
                    const match = proxyStr.match(/(\d{1,3}(?:\.\d{1,3}){3}):(\d+)/);
                    const ip = match ? match[1] : undefined;
                    const port = match ? Number(match[2]) : undefined;
                    return {
                        raw,
                        parsed,
                        status: 'rate_limited',
                        ok: true,
                        ip,
                        port,
                        nextChangeSeconds: nextSec,
                        message: `Key đang hoạt động (Chờ ${nextSec}s để đổi IP mới)`,
                        usageDetails: `Chờ ${nextSec}s để lấy IP mới`,
                        checkedAt,
                    };
                }
                // 2. Kiểm tra key hết hạn hoặc không tồn tại (Lỗi gói / Key hỏng)
                const isLimit = msg.includes('hết hạn gói') ||
                    msg.includes('không tồn tại') ||
                    msg.includes('expired') ||
                    msg.includes('khong ton tai') ||
                    json.status === 102 ||
                    json.status === 103;
                if (isLimit) {
                    return {
                        raw,
                        parsed,
                        status: 'limit_reached',
                        ok: false,
                        message: `Key không hợp lệ hoặc hết hạn: ${json.message || 'Key không tồn tại'}`,
                        usageDetails: 'Key hết hạn / Cần gia hạn',
                        checkedAt,
                    };
                }
                return {
                    raw,
                    parsed,
                    status: 'dead',
                    ok: false,
                    message: json.message || 'Lỗi kiểm tra key proxyvn',
                    checkedAt,
                };
            }
        }
        catch (err) {
            // Timeout hoặc lỗi kết nối
            return {
                raw,
                parsed,
                status: 'dead',
                ok: false,
                message: `Lỗi kết nối máy chủ ProxyVN: ${err.message}`,
                checkedAt,
            };
        }
    }
    return {
        raw,
        parsed,
        status: 'dead',
        ok: false,
        message: 'Không nhận được phản hồi từ ProxyVN',
        checkedAt,
    };
}
/** Kiểm tra và lấy IP từ tmproxy */
async function checkTMProxy(key, requestNew = false) {
    const raw = `tmproxy: ${key}`;
    const parsed = { raw, type: 'rotating', provider: 'tmproxy', key };
    const checkedAt = new Date().toISOString();
    const endpoint = requestNew
        ? 'https://api.tmproxy.com/api/proxy/get-new-proxy'
        : 'https://api.tmproxy.com/api/proxy/get-current-proxy';
    try {
        const startTime = Date.now();
        const res = await fetchWithTimeout(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ api_key: key, id_location: 0 }),
        }, 7000);
        const latencyMs = Date.now() - startTime;
        const json = await res.json();
        if (json.code === 0 && json.data) {
            const proxyStr = json.data.https || json.data.socks5 || '';
            const match = proxyStr.match(/(\d{1,3}(?:\.\d{1,3}){3}):(\d+)/);
            return {
                raw,
                parsed,
                status: 'live',
                ok: true,
                ip: match ? match[1] : undefined,
                port: match ? Number(match[2]) : undefined,
                latencyMs,
                message: `Hoạt động tốt (${latencyMs}ms)`,
                usageDetails: `Timeout: ${json.data.timeout || 0}s, còn: ${json.data.next_request || 0}s`,
                nextChangeSeconds: json.data.next_request,
                checkedAt,
            };
        }
        const msg = (json.message || '').toLowerCase();
        if (msg.includes('expired') || msg.includes('hết hạn') || json.code === 1) {
            return {
                raw,
                parsed,
                status: 'limit_reached',
                ok: false,
                message: `⚠️ Hết hạn mức TMProxy: ${json.message || 'Key hết hạn'}`,
                usageDetails: 'Hết hạn mức / Hết hạn gói',
                checkedAt,
            };
        }
        if (msg.includes('wait') || msg.includes('đợi') || json.code === 5) {
            return {
                raw,
                parsed,
                status: 'rate_limited',
                ok: false,
                message: `Chờ đổi IP: ${json.message}`,
                checkedAt,
            };
        }
        return {
            raw,
            parsed,
            status: 'dead',
            ok: false,
            message: json.message || 'Lỗi TMProxy',
            checkedAt,
        };
    }
    catch (err) {
        return {
            raw,
            parsed,
            status: 'dead',
            ok: false,
            message: `Lỗi kết nối TMProxy: ${err.message}`,
            checkedAt,
        };
    }
}
/** Kiểm tra và lấy IP từ shoplike */
async function checkShoplike(key, requestNew = false) {
    const raw = `shoplike: ${key}`;
    const parsed = { raw, type: 'rotating', provider: 'shoplike', key };
    const checkedAt = new Date().toISOString();
    const endpoint = requestNew
        ? `http://api.shoplike.vn/rest/proxy/getnewproxy?key=${encodeURIComponent(key)}`
        : `http://api.shoplike.vn/rest/proxy/getcurrentproxy?key=${encodeURIComponent(key)}`;
    try {
        const startTime = Date.now();
        const res = await fetchWithTimeout(endpoint, {}, 7000);
        const latencyMs = Date.now() - startTime;
        const json = await res.json();
        if (json.status === 'success' && json.data) {
            const proxyStr = json.data.proxy || '';
            const match = proxyStr.match(/(\d{1,3}(?:\.\d{1,3}){3}):(\d+)/);
            return {
                raw,
                parsed,
                status: 'live',
                ok: true,
                ip: match ? match[1] : undefined,
                port: match ? Number(match[2]) : undefined,
                latencyMs,
                message: `Hoạt động tốt (${latencyMs}ms)`,
                usageDetails: `Thời gian sống: ${json.data.time || 0}s`,
                checkedAt,
            };
        }
        const mess = (json.mess || '').toLowerCase();
        if (mess.includes('hết hạn') || mess.includes('không tồn tại')) {
            return {
                raw,
                parsed,
                status: 'limit_reached',
                ok: false,
                message: `⚠️ Hết hạn mức Shoplike: ${json.mess}`,
                usageDetails: 'Hết hạn gói / Cần nạp thêm',
                checkedAt,
            };
        }
        return {
            raw,
            parsed,
            status: 'dead',
            ok: false,
            message: json.mess || 'Lỗi Shoplike',
            checkedAt,
        };
    }
    catch (err) {
        return {
            raw,
            parsed,
            status: 'dead',
            ok: false,
            message: `Lỗi kết nối Shoplike: ${err.message}`,
            checkedAt,
        };
    }
}
// -------------------------------------------------------------
// 3. Kiểm tra Proxy Tĩnh (Static Proxy Check qua HTTP CONNECT / GET)
// -------------------------------------------------------------
function checkStaticProxy(parsed, timeoutMs = 8000) {
    const { raw, host, port, user, pass } = parsed;
    const checkedAt = new Date().toISOString();
    return new Promise((resolve) => {
        if (!host || !port) {
            return resolve({
                raw,
                parsed,
                status: 'dead',
                ok: false,
                message: 'Định dạng proxy không hợp lệ (cần IP:Port hoặc IP:Port:User:Pass)',
                checkedAt,
            });
        }
        const startTime = Date.now();
        const socket = new net_1.default.Socket();
        let isDone = false;
        let connected = false;
        const finish = (result) => {
            if (isDone)
                return;
            isDone = true;
            try {
                socket.destroy();
            }
            catch { }
            resolve(result);
        };
        socket.setTimeout(timeoutMs);
        socket.on('timeout', () => {
            finish({
                raw,
                parsed,
                status: 'dead',
                ok: false,
                message: connected
                    ? 'Không nhận được phản hồi từ proxy (Timeout): Thường do chưa thêm IP vào Whitelist trên web nhà bán, hoặc proxy đã hết hạn.'
                    : 'Không kết nối được tới IP:Port (Timeout > 8s): Proxy đã chết, hết hạn hoặc cổng bị đóng.',
                checkedAt,
            });
        });
        socket.on('error', (err) => {
            const code = err.code || err.message;
            let msg = `Không thể kết nối proxy: ${err.message}`;
            if (code.includes('ECONNRESET')) {
                msg = 'Máy chủ proxy ngắt kết nối (ECONNRESET): Thường do 1. Chưa cập nhật IP Whitelist trên web nơi mua proxy, 2. Thiếu User:Pass (cần IP:Port:User:Pass), hoặc 3. Gói proxy đã hết hạn.';
            }
            else if (code.includes('ECONNREFUSED')) {
                msg = 'Cổng proxy bị đóng hoặc từ chối kết nối (Connection Refused). Hãy kiểm tra lại số cổng Port.';
            }
            else if (code.includes('ETIMEDOUT')) {
                msg = 'Không kết nối được tới IP:Port (ETIMEDOUT): Proxy đã chết hoặc hết hạn.';
            }
            else if (code.includes('EHOSTUNREACH') || code.includes('ENOTFOUND')) {
                msg = 'Không tìm thấy địa chỉ máy chủ proxy hoặc IP không tồn tại.';
            }
            finish({
                raw,
                parsed,
                status: 'dead',
                ok: false,
                message: msg,
                checkedAt,
            });
        });
        socket.on('close', () => {
            if (!isDone) {
                finish({
                    raw,
                    parsed,
                    status: 'dead',
                    ok: false,
                    message: 'Máy chủ proxy đóng kết nối bất ngờ. Thường do chưa cập nhật IP Whitelist trên web nhà bán hoặc thiếu User:Pass.',
                    checkedAt,
                });
            }
        });
        socket.connect(port, host, () => {
            connected = true;
            const latencyMs = Date.now() - startTime;
            // Thử gửi HTTP CONNECT tới port 443 (chuẩn HTTPS tunneling mọi proxy đều hỗ trợ)
            let connectReq = `CONNECT api.ipify.org:443 HTTP/1.1\r\nHost: api.ipify.org:443\r\n`;
            if (user && pass) {
                const auth = Buffer.from(`${user}:${pass}`).toString('base64');
                connectReq += `Proxy-Authorization: Basic ${auth}\r\n`;
            }
            connectReq += `\r\n`;
            socket.write(connectReq);
            let buffer = '';
            socket.on('data', (chunk) => {
                buffer += chunk.toString();
                const headerEnd = buffer.indexOf('\r\n\r\n');
                if (headerEnd !== -1) {
                    const header = buffer.slice(0, headerEnd);
                    if (header.includes(' 200 ') || header.includes('200 Connection established')) {
                        finish({
                            raw,
                            parsed,
                            status: 'live',
                            ok: true,
                            ip: host,
                            port,
                            latencyMs,
                            message: `Hoạt động tốt (${latencyMs}ms)`,
                            usageDetails: 'Proxy đang hoạt động bình thường',
                            checkedAt,
                        });
                    }
                    else if (header.includes(' 407 ')) {
                        finish({
                            raw,
                            parsed,
                            status: 'limit_reached',
                            ok: false,
                            message: '⚠️ Lỗi 407 (Yêu cầu mật khẩu): Proxy cần User:Pass (Định dạng: IP:Port:User:Pass), hoặc đã hết hạn mức băng thông!',
                            usageDetails: 'Lỗi xác thực 407 / Hết băng thông',
                            checkedAt,
                        });
                    }
                    else if (header.includes(' 403 ')) {
                        finish({
                            raw,
                            parsed,
                            status: 'limit_reached',
                            ok: false,
                            message: '⚠️ Bị từ chối (Lỗi 403): Chưa thêm IP máy vào Whitelist trên web nơi mua proxy, hoặc gói đã hết hạn!',
                            usageDetails: 'Chưa Whitelist IP / Bị chặn 403',
                            checkedAt,
                        });
                    }
                    else {
                        finish({
                            raw,
                            parsed,
                            status: 'dead',
                            ok: false,
                            message: `Proxy phản hồi lỗi: ${header.split('\r\n')[0]}`,
                            checkedAt,
                        });
                    }
                }
            });
        });
    });
}
// -------------------------------------------------------------
// 4. Hàm điều phối kiểm tra 1 Proxy (Dispatch Single Check)
// -------------------------------------------------------------
async function checkSingleProxy(raw, requestNew = false) {
    const parsed = parseProxyLine(raw);
    const checkedAt = new Date().toISOString();
    if (!parsed) {
        return {
            raw,
            parsed: { raw, type: 'static', provider: 'static' },
            status: 'dead',
            ok: false,
            message: 'Định dạng proxy không hợp lệ (hỗ trợ IP:Port, IP:Port:User:Pass, Link API xoay hoặc Key)',
            checkedAt,
        };
    }
    if (parsed.type === 'rotating') {
        if (parsed.provider === 'proxyvn' && parsed.key) {
            return checkProxyVn(parsed.key, requestNew);
        }
        if (parsed.provider === 'tmproxy' && parsed.key) {
            return checkTMProxy(parsed.key, requestNew);
        }
        if (parsed.provider === 'shoplike' && parsed.key) {
            return checkShoplike(parsed.key, requestNew);
        }
        // Link API xoay IP từ bất kỳ nhà bán nào
        if (parsed.url) {
            try {
                const startTime = Date.now();
                const res = await fetchWithTimeout(parsed.url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, 7000);
                const latencyMs = Date.now() - startTime;
                const text = await res.text();
                let json = null;
                try {
                    json = JSON.parse(text);
                }
                catch { }
                if (json) {
                    const proxyStr = json.proxy ||
                        json.http ||
                        json.https ||
                        json.data?.proxy ||
                        json.data?.http ||
                        json.data?.https ||
                        (json.ip && json.port ? `${json.ip}:${json.port}` : '') ||
                        '';
                    const match = String(proxyStr).match(/(\d{1,3}(?:\.\d{1,3}){3}):(\d+)/);
                    if (match) {
                        return {
                            raw,
                            parsed,
                            status: 'live',
                            ok: true,
                            ip: match[1],
                            port: Number(match[2]),
                            latencyMs,
                            message: `Hoạt động tốt (${latencyMs}ms)`,
                            usageDetails: json.message || json.mess || `IP: ${match[1]}:${match[2]}`,
                            checkedAt,
                        };
                    }
                    // Kiểm tra thông báo hết hạn mức từ JSON
                    const msg = (json.message || json.mess || json.msg || json.error || '').toLowerCase();
                    if (msg.includes('hết hạn') ||
                        msg.includes('expired') ||
                        msg.includes('limit') ||
                        msg.includes('hạn mức') ||
                        msg.includes('quá giới hạn')) {
                        return {
                            raw,
                            parsed,
                            status: 'limit_reached',
                            ok: false,
                            message: `⚠️ Hết hạn mức: ${json.message || json.mess || json.error || 'Gói proxy đã hết hạn!'}`,
                            usageDetails: 'Hết hạn mức / Cần gia hạn gói',
                            checkedAt,
                        };
                    }
                    if (msg.includes('đợi') || msg.includes('chờ') || msg.includes('wait')) {
                        return {
                            raw,
                            parsed,
                            status: 'rate_limited',
                            ok: false,
                            message: `Chưa đến lúc đổi IP: ${json.message || json.mess}`,
                            checkedAt,
                        };
                    }
                }
                const m = text.match(/(\d{1,3}(?:\.\d{1,3}){3}):(\d+)/);
                if (m) {
                    return {
                        raw,
                        parsed,
                        status: 'live',
                        ok: true,
                        ip: m[1],
                        port: Number(m[2]),
                        latencyMs,
                        message: `Hoạt động tốt (${latencyMs}ms)`,
                        checkedAt,
                    };
                }
                return {
                    raw,
                    parsed,
                    status: 'dead',
                    ok: false,
                    message: `Không nhận được IP:port hợp lệ từ link API (Nội dung: ${text.slice(0, 80)})`,
                    checkedAt,
                };
            }
            catch (err) {
                return {
                    raw,
                    parsed,
                    status: 'dead',
                    ok: false,
                    message: `Lỗi gọi link API: ${err.message}`,
                    checkedAt,
                };
            }
        }
    }
    return checkStaticProxy(parsed);
}
// -------------------------------------------------------------
// 5. Kiểm tra danh sách Proxy hàng loạt (Batch Check)
// -------------------------------------------------------------
async function checkAllProxies(rawLines) {
    const lines = rawLines.map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
    const results = [];
    // Chạy song song từng nhóm 5 proxy để không làm nghẽn
    const CHUNK_SIZE = 5;
    for (let i = 0; i < lines.length; i += CHUNK_SIZE) {
        const chunk = lines.slice(i, i + CHUNK_SIZE);
        const chunkResults = await Promise.all(chunk.map((line) => checkSingleProxy(line)));
        results.push(...chunkResults);
    }
    const live = results.filter((r) => r.status === 'live' || r.status === 'rate_limited' || r.ok).length;
    const limitReached = results.filter((r) => r.status === 'limit_reached').length;
    const dead = results.filter((r) => !r.ok && r.status !== 'rate_limited' && r.status !== 'limit_reached').length;
    return {
        total: results.length,
        live,
        limitReached,
        dead,
        results,
    };
}
const activeBridges = new Map();
/** Tạo một bridge local 127.0.0.1 để tự động bơm header auth cho Chromium */
function getOrCreateLocalBridge(parsed) {
    return new Promise((resolve, reject) => {
        if (!parsed.user || !parsed.pass || !parsed.host || !parsed.port) {
            return reject(new Error('Proxy không cần bridge hoặc thiếu thông tin'));
        }
        const bridgeKey = `${parsed.host}:${parsed.port}:${parsed.user}:${parsed.pass}`;
        if (activeBridges.has(bridgeKey)) {
            return resolve(activeBridges.get(bridgeKey).port);
        }
        const authHeader = `Basic ${Buffer.from(`${parsed.user}:${parsed.pass}`).toString('base64')}`;
        const server = http_1.default.createServer();
        // Xử lý HTTPS CONNECT
        server.on('connect', (req, clientSocket, head) => {
            const proxySocket = net_1.default.connect(parsed.port, parsed.host, () => {
                let connectHeader = `CONNECT ${req.url} HTTP/1.1\r\n`;
                connectHeader += `Host: ${req.url}\r\n`;
                connectHeader += `Proxy-Authorization: ${authHeader}\r\n`;
                connectHeader += `\r\n`;
                proxySocket.write(connectHeader);
                if (head && head.length > 0)
                    proxySocket.write(head);
            });
            let handshakeDone = false;
            let buffer = '';
            proxySocket.on('data', (chunk) => {
                if (!handshakeDone) {
                    buffer += chunk.toString();
                    const idx = buffer.indexOf('\r\n\r\n');
                    if (idx !== -1) {
                        handshakeDone = true;
                        clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
                        const remainder = chunk.slice(chunk.indexOf(Buffer.from('\r\n\r\n')) + 4);
                        if (remainder.length > 0)
                            clientSocket.write(remainder);
                        proxySocket.pipe(clientSocket);
                        clientSocket.pipe(proxySocket);
                    }
                }
            });
            proxySocket.on('error', () => clientSocket.destroy());
            clientSocket.on('error', () => proxySocket.destroy());
        });
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            const port = address.port;
            activeBridges.set(bridgeKey, { port, server, targetProxy: bridgeKey });
            console.log(`[ProxyManager] Khởi động Local Bridge tại 127.0.0.1:${port} -> ${parsed.host}:${parsed.port}`);
            resolve(port);
        });
        server.on('error', (err) => reject(err));
    });
}
// -------------------------------------------------------------
// 7. Chuẩn bị cờ Proxy cho Edge / Chromium (Resolve Chrome Proxy Arg)
// -------------------------------------------------------------
async function resolveChromeProxyArgs(proxyStr, accountId) {
    if (!proxyStr || !proxyStr.trim())
        return [];
    // Nếu ở chế độ dùng thử (Trial), proxy bị khóa -> luôn dùng mạng máy trực tiếp
    try {
        const { licenseManager } = require('./licenseManager');
        if (licenseManager.isFeatureBlocked('proxy')) {
            return [];
        }
    }
    catch { }
    const parsed = parseProxyLine(proxyStr);
    if (!parsed)
        return [];
    // 1. Key xoay: Lấy IP đang sống hiện tại
    if (parsed.type === 'rotating') {
        let check = await checkSingleProxy(proxyStr, false);
        if (!check.ok || !check.ip || !check.port) {
            if (check.status === 'rate_limited') {
                // Thử lấy IP hiện tại đã được cấp trước đó từ database và kiểm tra xem có sống không
                const cached = db_1.db.prepare(`SELECT proxy_ip FROM accounts WHERE proxy = ? AND proxy_ip IS NOT NULL AND proxy_ip NOT LIKE '%undefined%'`).get(proxyStr);
                if (cached?.proxy_ip) {
                    const parts = cached.proxy_ip.split(':');
                    if (parts.length >= 2 && !parts[0].includes('undefined') && !parts[1].includes('undefined')) {
                        const testCached = await checkStaticProxy({
                            raw: cached.proxy_ip,
                            type: 'static',
                            provider: 'static',
                            host: parts[0],
                            port: Number(parts[1]),
                            protocol: 'http',
                        }, 3000);
                        if (testCached.ok) {
                            console.log(`[ProxyManager] Key đang trong thời gian cooldown, tái sử dụng IP hiện có: ${cached.proxy_ip}`);
                            return [`--proxy-server=http://${cached.proxy_ip}`];
                        }
                    }
                }
                // Nếu cached IP không hoạt động, chờ hết thời gian cooldown rồi lấy IP mới
                const waitSec = Math.min(Math.max(check.nextChangeSeconds || 15, 5), 45);
                console.log(`[ProxyManager] Proxy đang cooldown (${waitSec}s) và IP cũ không phản hồi, chờ ${waitSec}s để lấy IP mới...`);
                await new Promise((r) => setTimeout(r, waitSec * 1000));
                check = await checkSingleProxy(proxyStr, true);
            }
            if (!check.ok || !check.ip || !check.port) {
                console.warn(`[ProxyManager] Proxy ${parsed.key || proxyStr} không lấy được IP (${check.message}). Đang kiểm tra để tự đổi hoặc dùng mạng máy...`);
                // 1. Tự động phân phối lại proxy sống khác từ kho nếu có
                if (accountId) {
                    const reassigned = await autoReassignProxyForAccount(accountId);
                    if (reassigned) {
                        const updated = db_1.db.prepare('SELECT proxy FROM accounts WHERE id = ?').get(accountId);
                        if (updated?.proxy && updated.proxy !== proxyStr) {
                            return resolveChromeProxyArgs(updated.proxy, accountId);
                        }
                    }
                }
                // 2. KHI HẾT PROXY THÌ DÙNG MẠNG SẴN CỦA MÁY (theo yêu cầu người dùng)
                console.log(`[ProxyManager] 🌐 Kho không còn proxy thay thế khả dụng -> TỰ ĐỘNG DÙNG MẠNG SẴN CỦA MÁY để tiếp tục tạo video!`);
                if (accountId) {
                    db_1.db.prepare(`
            UPDATE accounts
            SET proxy_status = 'live',
                proxy_ip = 'Mạng máy (Trực tiếp)',
                proxy_limit_msg = 'Đang dùng mạng sẵn của máy'
            WHERE id = ?
          `).run(accountId);
                }
                return []; // Không dùng cờ proxy -> Chromium chạy bằng mạng máy tính trực tiếp
            }
        }
        // Kiểm tra thực tế xem cổng proxy này có thông mạng thật không (tránh trường hợp API báo sống nhưng cổng proxy thực tế bị timeout)
        if (check.ip && check.port) {
            const isAlive = await checkStaticProxy({
                raw: `${check.ip}:${check.port}`,
                type: 'static',
                provider: 'static',
                host: check.ip,
                port: check.port,
                protocol: 'http',
            }, 3500);
            if (!isAlive.ok) {
                console.warn(`[ProxyManager] Cổng proxy ${check.ip}:${check.port} không phản hồi mạng (timeout). Thử đổi IP mới...`);
                // Yêu cầu đổi IP mới ngay lập tức
                const newCheck = await checkSingleProxy(proxyStr, true);
                if (newCheck.ok && newCheck.ip && newCheck.port) {
                    check = newCheck;
                }
                else {
                    console.warn(`[ProxyManager] Đổi IP mới chưa thành công (${newCheck.message}), giữ thông tin proxy hiện tại.`);
                }
            }
        }
        // Xác nhận chắc chắn IP và port hợp lệ trước khi cấp cho Chrome
        if (!check.ip || !check.port || String(check.ip).includes('undefined') || String(check.port).includes('undefined')) {
            console.log(`[ProxyManager] 🌐 Proxy không có IP hợp lệ, tự động dùng mạng sẵn của máy.`);
            return [];
        }
        // Cập nhật lại IP vào accounts table để lưu cache
        try {
            db_1.db.prepare(`UPDATE accounts SET proxy_ip = ?, proxy_status = 'live' WHERE proxy = ?`).run(`${check.ip}:${check.port}`, proxyStr);
        }
        catch { }
        return [`--proxy-server=http://${check.ip}:${check.port}`];
    }
    // 2. Proxy tĩnh: Nếu có user:pass, mở bridge local
    if (parsed.user && parsed.pass) {
        try {
            const localPort = await getOrCreateLocalBridge(parsed);
            return [`--proxy-server=http://127.0.0.1:${localPort}`];
        }
        catch (err) {
            console.error('[ProxyManager] Không tạo được Local Bridge, dùng direct args:', err.message);
            return [`--proxy-server=http://${parsed.host}:${parsed.port}`];
        }
    }
    // Proxy tĩnh không có user:pass
    if (parsed.protocol === 'socks5') {
        return [`--proxy-server=socks5://${parsed.host}:${parsed.port}`];
    }
    return [`--proxy-server=http://${parsed.host}:${parsed.port}`];
}
function shuffleArray(array) {
    const result = [...array];
    for (let i = result.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
}
async function assignProxiesToAccounts(options = {}) {
    const { mode = 'sequential', overwriteAll = true, maxPerProxy = 1 } = options;
    // Lấy danh sách proxy từ settings
    const rawRow = db_1.db.prepare(`SELECT value FROM settings WHERE key = 'proxy_raw_list'`).get();
    const rawList = (rawRow?.value || '')
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('#'));
    if (rawList.length === 0) {
        throw new Error('Chưa có proxy nào trong kho. Vui lòng dán proxy vào ô danh sách trước.');
    }
    // Lọc và parse danh sách proxy hợp lệ
    let validProxies = rawList.map((l) => ({ raw: l, parsed: parseProxyLine(l) })).filter((p) => p.parsed !== null);
    if (validProxies.length === 0) {
        throw new Error('Không có dòng proxy nào hợp lệ');
    }
    if (mode === 'random') {
        validProxies = shuffleArray(validProxies);
    }
    // Lấy các tài khoản
    const allAccounts = db_1.db.prepare(`SELECT * FROM accounts ORDER BY created_at ASC`).all();
    // BẢO VỆ ĐA LUỒNG TỐI CAO: Bỏ qua tuyệt đối các nick đang bận render video (jobs_running > 0)!
    // Tránh việc đổi proxy làm rớt WebSocket hoặc reload tab giữa chừng gây hỏng job.
    const idleAccounts = allAccounts.filter((a) => (a.jobs_running || 0) === 0);
    const busyCount = allAccounts.length - idleAccounts.length;
    if (busyCount > 0) {
        console.log(`[ProxyManager] Đang bảo vệ an toàn ${busyCount} tài khoản đang render video (jobs_running > 0), không thay đổi proxy của các nick này!`);
    }
    const vaultRawKeys = new Set(validProxies.map((p) => p.raw.trim().toLowerCase()));
    const targetAccounts = overwriteAll
        ? idleAccounts
        : idleAccounts.filter((a) => !a.proxy ||
            a.proxy_status === 'dead' ||
            a.proxy_status === 'limit_reached' ||
            a.proxy_status === 'expired' ||
            !vaultRawKeys.has((a.proxy || '').trim().toLowerCase()));
    if (targetAccounts.length === 0) {
        return { assignedCount: 0, accounts: allAccounts };
    }
    let assignedCount = 0;
    // Tính toán số lượng nick được chia trên mỗi proxy:
    // Nếu maxPerProxy được chỉ định (> 0) thì dùng số đó (vd: 2 hoặc 3 nick/proxy).
    // Nếu không (hoặc để mặc định), tự động chia đều: Math.ceil(targetAccounts.length / validProxies.length)
    const accountsPerProxy = maxPerProxy && maxPerProxy > 0
        ? maxPerProxy
        : Math.max(1, Math.ceil(targetAccounts.length / validProxies.length));
    for (let i = 0; i < targetAccounts.length; i++) {
        const acc = targetAccounts[i];
        let proxyItem;
        if (mode === 'random') {
            // Khi chọn random, validProxies đã được shuffleArray ở trên
            const pIdx = Math.floor(i / accountsPerProxy) % validProxies.length;
            proxyItem = validProxies[pIdx];
        }
        else {
            // Tuần tự theo khối (VD: 2 nick đầu nhận Proxy 1, 2 nick sau nhận Proxy 2...)
            const pIdx = Math.floor(i / accountsPerProxy) % validProxies.length;
            proxyItem = validProxies[pIdx];
        }
        const proxyStr = proxyItem.raw;
        db_1.db.prepare(`
      UPDATE accounts
      SET proxy = ?,
          proxy_status = 'testing',
          proxy_ip = NULL,
          proxy_limit_msg = NULL
      WHERE id = ?
    `).run(proxyStr, acc.id);
        assignedCount++;
    }
    // Thông báo cập nhật tài khoản
    const { getSanitizedAccounts } = require('./routes/accounts');
    const sanitized = getSanitizedAccounts();
    (0, ws_1.broadcast)('ACCOUNTS_UPDATED', sanitized);
    // Chạy ngầm kiểm tra trạng thái proxy vừa gán
    setTimeout(async () => {
        for (const acc of targetAccounts) {
            const cur = db_1.db.prepare(`SELECT proxy FROM accounts WHERE id = ?`).get(acc.id);
            if (cur?.proxy) {
                try {
                    const res = await checkSingleProxy(cur.proxy);
                    const existingAcc = db_1.db.prepare(`SELECT proxy_ip FROM accounts WHERE id = ?`).get(acc.id);
                    const newIp = res.ip ? `${res.ip}${res.port ? ':' + res.port : ''}` : (existingAcc?.proxy_ip || null);
                    if (res.status === 'limit_reached') {
                        db_1.db.prepare(`
              UPDATE accounts
              SET proxy_status = 'limit_reached',
                  proxy_ip = ?,
                  proxy_limit_msg = ?,
                  status = 'offline',
                  session_status = ?
              WHERE id = ?
            `).run(newIp, res.message, `⚠️ Proxy hết hạn mức: ${res.message?.slice(0, 100)}`, acc.id);
                    }
                    else {
                        db_1.db.prepare(`
              UPDATE accounts
              SET proxy_status = ?,
                  proxy_ip = ?,
                  proxy_limit_msg = NULL
              WHERE id = ?
            `).run(res.status, newIp, acc.id);
                    }
                }
                catch {
                    // ignore
                }
            }
        }
        (0, ws_1.broadcast)('ACCOUNTS_UPDATED', getSanitizedAccounts());
    }, 100);
    return { assignedCount, accounts: db_1.db.prepare(`SELECT * FROM accounts`).all() };
}
// -------------------------------------------------------------
// 9. Xóa toàn bộ proxy gán cho tài khoản (Clear Assigned)
// -------------------------------------------------------------
function clearAssignedProxies() {
    db_1.db.prepare(`
    UPDATE accounts
    SET proxy = NULL,
        proxy_status = 'none',
        proxy_ip = NULL,
        proxy_info = NULL,
        proxy_limit_msg = NULL
  `).run();
    const { getSanitizedAccounts } = require('./routes/accounts');
    (0, ws_1.broadcast)('ACCOUNTS_UPDATED', getSanitizedAccounts());
}
// -------------------------------------------------------------
// 10. Đếm số lượng proxy có trong kho (Vault Proxy Count)
// -------------------------------------------------------------
function getVaultProxyCount() {
    try {
        const rawRow = db_1.db.prepare(`SELECT value FROM settings WHERE key = 'proxy_raw_list'`).get();
        const lines = (rawRow?.value || '')
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter((l) => l && !l.startsWith('#'));
        return lines.length;
    }
    catch {
        return 0;
    }
}
// -------------------------------------------------------------
// 11. TỰ ĐỘNG PHÂN PHỐI LẠI PROXY KHI TÀI KHOẢN GẶP LỖI IP / PROXY
// -------------------------------------------------------------
/**
 * Tự động tìm proxy sống khác từ kho và gán lại ngay cho tài khoản bị lỗi IP/proxy
 */
async function autoReassignProxyForAccount(accountId) {
    try {
        const acc = db_1.db.prepare(`SELECT * FROM accounts WHERE id = ?`).get(accountId);
        if (!acc)
            return false;
        // BẢO VỆ ĐA LUỒNG: Không đổi proxy của tài khoản đang bận render video!
        if ((acc.jobs_running || 0) > 0)
            return false;
        const rawRow = db_1.db.prepare(`SELECT value FROM settings WHERE key = 'proxy_raw_list'`).get();
        const rawList = (rawRow?.value || '')
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter((l) => l && !l.startsWith('#'));
        const validProxies = rawList.map((l) => ({ raw: l, parsed: parseProxyLine(l) })).filter((p) => p.parsed !== null);
        if (validProxies.length === 0)
            return false;
        // Ưu tiên chọn proxy trong kho KHÁC với proxy vừa bị lỗi
        const currentProxy = (acc.proxy || '').trim().toLowerCase();
        const candidateProxies = validProxies.filter((p) => p.raw.trim().toLowerCase() !== currentProxy);
        const pool = candidateProxies.length > 0 ? candidateProxies : validProxies;
        // Chọn proxy ít tài khoản sử dụng nhất trong kho (cân bằng tải)
        const usageCounts = new Map();
        for (const p of pool)
            usageCounts.set(p.raw, 0);
        const otherAccounts = db_1.db.prepare(`SELECT proxy FROM accounts WHERE id != ? AND proxy IS NOT NULL`).all(accountId);
        for (const oa of otherAccounts) {
            if (usageCounts.has(oa.proxy)) {
                usageCounts.set(oa.proxy, (usageCounts.get(oa.proxy) || 0) + 1);
            }
        }
        pool.sort((a, b) => (usageCounts.get(a.raw) || 0) - (usageCounts.get(b.raw) || 0));
        const chosenProxy = pool[0].raw;
        console.log(`[ProxyManager] Tự động phân phối lại proxy cho tài khoản ${acc.identifier} -> Chọn key kho: ${chosenProxy.slice(0, 25)}...`);
        db_1.db.prepare(`
      UPDATE accounts
      SET proxy = ?,
          proxy_status = 'testing',
          proxy_ip = NULL,
          proxy_limit_msg = NULL
      WHERE id = ?
    `).run(chosenProxy, accountId);
        // Kiểm tra kết nối của proxy mới vừa gán
        const res = await checkSingleProxy(chosenProxy, false);
        const { getSanitizedAccounts } = require('./routes/accounts');
        if (res.ok && res.ip && res.port) {
            const isLimitReached = (acc.usage_limit_reached === 1) || (Number(acc.usage_percent) >= 100);
            const newStatus = isLimitReached ? 'offline' : 'online';
            db_1.db.prepare(`
        UPDATE accounts
        SET proxy_status = 'live',
            proxy_ip = ?,
            proxy_limit_msg = NULL,
            status = ?,
            session_status = ?
        WHERE id = ?
      `).run(`${res.ip}:${res.port}`, newStatus, isLimitReached ? `Hết hạn mức Muse (${acc.usage_percent}% used)` : 'Phiên Muse hoạt động (Đã tự động đổi sang proxy mới)', accountId);
            console.log(`[ProxyManager] Tự động đổi proxy thành công cho ${acc.identifier} -> Live (${res.ip}:${res.port})`);
            (0, ws_1.broadcast)('ACCOUNTS_UPDATED', getSanitizedAccounts());
            return true;
        }
        else {
            db_1.db.prepare(`
        UPDATE accounts
        SET proxy_status = ?,
            proxy_limit_msg = ?,
            status = 'offline'
        WHERE id = ?
      `).run(res.status || 'dead', res.message, accountId);
            (0, ws_1.broadcast)('ACCOUNTS_UPDATED', getSanitizedAccounts());
            return false;
        }
    }
    catch (err) {
        console.error(`[ProxyManager] Lỗi tự động phân phối lại proxy cho account ${accountId}:`, err.message);
        return false;
    }
}
/**
 * Quét toàn bộ tài khoản đang bị lỗi proxy hoặc chưa có proxy và tự động cấp proxy từ kho
 */
async function autoReassignFailingAccounts() {
    try {
        const rawRow = db_1.db.prepare(`SELECT value FROM settings WHERE key = 'proxy_raw_list'`).get();
        const rawList = (rawRow?.value || '')
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter((l) => l && !l.startsWith('#'));
        const validProxies = rawList.map((l) => ({ raw: l, parsed: parseProxyLine(l) })).filter((p) => p.parsed !== null);
        if (validProxies.length === 0)
            return 0;
        const vaultRawKeys = new Set(validProxies.map((p) => p.raw.trim().toLowerCase()));
        // Lọc các nick rảnh (không render video) mà bị lỗi proxy hoặc chưa có proxy hoặc proxy không còn trong kho
        const allAccs = db_1.db.prepare(`
      SELECT id, identifier, proxy, proxy_status, jobs_running 
      FROM accounts
      WHERE enabled = 1 AND (jobs_running IS NULL OR jobs_running = 0)
    `).all();
        const failingAccounts = allAccs.filter((a) => {
            if (!a.proxy)
                return true;
            if (a.proxy_status === 'dead' || a.proxy_status === 'limit_reached' || a.proxy_status === 'expired')
                return true;
            if (!vaultRawKeys.has((a.proxy || '').trim().toLowerCase()))
                return true;
            return false;
        });
        if (failingAccounts.length === 0)
            return 0;
        console.log(`[ProxyManager] Phát hiện ${failingAccounts.length} tài khoản có proxy lỗi/thiếu. Đang tự động phân phối lại...`);
        let count = 0;
        for (const acc of failingAccounts) {
            const ok = await autoReassignProxyForAccount(acc.id);
            if (ok)
                count++;
        }
        return count;
    }
    catch (err) {
        console.error('[ProxyManager] autoReassignFailingAccounts error:', err.message);
        return 0;
    }
}
