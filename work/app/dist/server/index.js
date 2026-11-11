"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.broadcast = void 0;
const express_1 = __importDefault(require("express"));
const http_1 = __importDefault(require("http"));
const cors_1 = __importDefault(require("cors"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const procUtil_1 = require("./procUtil");
const db_1 = require("./db");
const ws_1 = require("./ws");
Object.defineProperty(exports, "broadcast", { enumerable: true, get: function () { return ws_1.broadcast; } });
const dispatcher_1 = require("./dispatcher");
const museWorker_1 = require("./museWorker");
const accounts_1 = __importDefault(require("./routes/accounts"));
const refs_1 = __importDefault(require("./routes/refs"));
const queue_1 = __importDefault(require("./routes/queue"));
const studio_1 = __importDefault(require("./routes/studio"));
const settings_1 = __importDefault(require("./routes/settings"));
const proxy_1 = __importDefault(require("./routes/proxy"));
const license_1 = __importDefault(require("./routes/license"));
const community_1 = __importDefault(require("./routes/community"));
const licenseManager_1 = require("./licenseManager");
const paths_1 = require("./paths");
// Create data directories on startup
const dataDir = paths_1.DATA_DIR;
const uploadsDir = path_1.default.join(dataDir, 'uploads');
const videosDir = path_1.default.join(dataDir, 'videos');
[dataDir, uploadsDir, videosDir].forEach((dir) => {
    if (!fs_1.default.existsSync(dir)) {
        fs_1.default.mkdirSync(dir, { recursive: true });
    }
});
// Trình duyệt chạy ẩn còn sót từ lần chạy trước sẽ giữ khóa profile -> tắt hết trước khi làm việc
(0, procUtil_1.killBrowsersUsing)(path_1.default.join(dataDir, 'profiles'));
// Không ai giữ job khi server vừa khởi động: trả job đang chạy dở về hàng đợi.
// Giữ nguyên trạng thái tài khoản đang có, chỉ reset số job đang chạy về 0.
db_1.db.prepare(`UPDATE jobs SET status = 'pending', account_id = NULL, progress = 0 WHERE status = 'running'`).run();
db_1.db.prepare(`UPDATE accounts SET jobs_running = 0`).run();
// Giữ nguyên các tài khoản đã đăng nhập là Online ngay lập tức khi vào app, không bắt check lại
db_1.db.prepare(`
  UPDATE accounts
  SET status = 'online', session_status = 'Phiên Muse hoạt động'
  WHERE enabled = 1 AND (usage_limit_reached IS NULL OR usage_limit_reached = 0) AND credentials_encrypted IS NOT NULL
`).run();
// Tự động gán proxy cho các tài khoản chưa có proxy nếu có danh sách proxy trong kho
try {
    const rawProxyRow = db_1.db.prepare(`SELECT value FROM settings WHERE key = 'proxy_raw_list'`).get();
    const rawList = (rawProxyRow?.value || '').split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'));
    if (rawList.length > 0) {
        const unproxiedAccounts = db_1.db.prepare(`SELECT id FROM accounts WHERE proxy IS NULL OR proxy = ''`).all();
        for (let i = 0; i < unproxiedAccounts.length; i++) {
            const p = rawList[i % rawList.length];
            db_1.db.prepare(`UPDATE accounts SET proxy = ?, proxy_status = 'testing' WHERE id = ?`).run(p, unproxiedAccounts[i].id);
        }
    }
}
catch (e) {
    console.warn('[Server] Auto proxy assignment error:', e);
}
const app = (0, express_1.default)();
const PORT = process.env.PORT || 3001;
// Middlewares
app.use((0, cors_1.default)());
app.use(express_1.default.json({ limit: '50mb' }));
app.use(express_1.default.urlencoded({ extended: true, limit: '50mb' }));
// Static file serving
app.use('/uploads', express_1.default.static(uploadsDir));
app.use('/videos', express_1.default.static(videosDir));
require('./museAccess.cjs').installMuseAccess(app,require('./db').db);
// API Routes
app.use('/api/accounts', accounts_1.default);
app.use('/api/refs', refs_1.default);
app.use('/api/queue', queue_1.default);
app.use('/api/studio', studio_1.default);
app.use('/api/movie-studio', require('./routes/movieStudio.cjs'));
app.use('/api/magnific', require('./routes/magnific.cjs'));
app.use('/api/concept', require('./routes/concept.cjs'));
app.use('/api/upscale', require('./routes/mopixUpscale.cjs'));
app.use('/api/apix', require('./routes/apix.cjs'));
app.use('/api/briefs', require('./routes/briefs.cjs'));
app.use('/api/films', require('./routes/films.cjs'));
app.use('/api/exact-video', require('./routes/exactVideo.cjs'));
app.use('/api/settings', settings_1.default);
app.use('/api/color-presets', require('./colorPresets').router);
app.use('/api/proxy', proxy_1.default);
app.use('/api/license', license_1.default);
app.use('/api/community', community_1.default);
app.use('/api/prompt-assistant', require('./routes/promptAssistant'));
// Programming assistant retired; creative assistance uses /api/prompt-assistant.
app.use('/api/images', require('./routes/imageOperations'));
require('./imageTrashRuntime.cjs').start();
// Node workflow retired: no runner/timer mounted.
app.use('/api/workflow-google', require('./googleWorkflow.cjs').router);
app.use('/api/cutout', require('./routes/cutout'));
// Health check endpoint
app.get('/api/health', (_req, res) => {
    res.json({
        status: 'ok',
        name: 'Muse Batch Manager API',
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    });
});
// 404 handler for API routes
app.use('/api/*', (_req, res) => {
    res.status(404).json({ error: 'Đường dẫn API không tồn tại' });
});
// Serve frontend static files
const distDir = path_1.default.join(paths_1.APP_DIR, 'dist');
if (fs_1.default.existsSync(distDir)) {
    app.use(express_1.default.static(distDir, { setHeaders(res, filePath) { if (/\.(?:html|css|js)$/.test(filePath)) res.setHeader('Cache-Control', 'no-cache'); } }));
    app.get('*', (req, res, next) => {
        if (req.path.startsWith('/api/') || req.path.startsWith('/uploads/') || req.path.startsWith('/videos/')) {
            return next();
        }
        res.sendFile(path_1.default.join(distDir, 'index.html'));
    });
}
// Create HTTP server
const server = http_1.default.createServer(app);
// Initialize WebSocket
(0, ws_1.initWebSocket)(server);
// Start server
server.listen(PORT, '127.0.0.1', () => {
    console.log(`===============================================`);
    console.log(` Muse Batch Manager Server running on port ${PORT}`);
    console.log(` API Endpoint: http://localhost:${PORT}/api`);
    console.log(` WebSocket:    ws://localhost:${PORT}/ws`);
    console.log(` Data storage: ${dataDir}`);
    console.log(`===============================================`);
    // Start dispatcher engine
    dispatcher_1.dispatcher.start(ws_1.broadcast);
    // Khởi động kiểm tra bản quyền định kỳ
    licenseManager_1.licenseManager.startPeriodicCheck();
    // Tài khoản chưa đăng nhập trên trình duyệt đang chọn (vd. vừa đổi sang Chrome) không được hiện Online
    dispatcher_1.dispatcher.reconcileProfilesWithBrowser();
    // Cửa sổ đăng nhập không còn sau khi app khởi động lại -> bỏ trạng thái cũ
    db_1.db.prepare(`UPDATE accounts SET session_status = 'Chưa kiểm tra phiên' WHERE session_status LIKE 'Cửa sổ đăng nhập%' OR session_status LIKE 'Đang mở cửa sổ%'`).run();
});
// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n[Server] Shutting down gracefully...');
    dispatcher_1.dispatcher.stop();
    museWorker_1.museWorker.closeAll();
    db_1.db.close();
    server.close(() => {
        console.log('[Server] Closed.');
        process.exit(0);
    });
});
process.on('SIGTERM', () => {
    console.log('\n[Server] Terminated.');
    dispatcher_1.dispatcher.stop();
    museWorker_1.museWorker.closeAll();
    db_1.db.close();
    server.close(() => {
        process.exit(0);
    });
});
