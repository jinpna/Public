"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.db = void 0;
exports.initDatabase = initDatabase;
const node_sqlite_1 = require("node:sqlite");
const path_1 = __importDefault(require("path"));
const paths_1 = require("./paths");
class Db {
    raw;
    constructor(file) {
        this.raw = new node_sqlite_1.DatabaseSync(file);
    }
    prepare(sql) {
        return this.raw.prepare(sql);
    }
    exec(sql) {
        this.raw.exec(sql);
    }
    pragma(statement) {
        this.raw.exec(`PRAGMA ${statement}`);
    }
    transaction(fn) {
        return ((...args) => {
            this.raw.exec('BEGIN');
            try {
                const result = fn(...args);
                this.raw.exec('COMMIT');
                return result;
            }
            catch (err) {
                this.raw.exec('ROLLBACK');
                throw err;
            }
        });
    }
    close() {
        this.raw.close();
    }
}
const dbPath = path_1.default.join(paths_1.DATA_DIR, 'database.sqlite');
exports.db = new Db(dbPath);
// Enable WAL mode for better concurrency performance
exports.db.pragma('journal_mode = WAL');
exports.db.pragma('foreign_keys = ON');
function initDatabase() {
    // 1. Accounts Table
    exports.db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      identifier TEXT NOT NULL,
      credentials_encrypted TEXT,
      enabled INTEGER DEFAULT 1,
      status TEXT DEFAULT 'offline',
      session_status TEXT DEFAULT 'none',
      jobs_running INTEGER DEFAULT 0,
      last_health_check TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
    // Cột bổ sung cho bảng accounts (hạn mức & proxy)
    const colsToAdd = [
        'paused_until TEXT',
        'proxy TEXT',
        'proxy_status TEXT',
        'proxy_ip TEXT',
        'proxy_info TEXT',
        'proxy_limit_msg TEXT',
        'usage_percent INTEGER DEFAULT 0',
        'usage_reset_date TEXT',
        'usage_tokens_left TEXT',
        'usage_limit_reached INTEGER DEFAULT 0',
        'usage_checked_at TEXT'
    ];
    for (const col of colsToAdd) {
        try {
            exports.db.exec(`ALTER TABLE accounts ADD COLUMN ${col}`);
        }
        catch {
            // cột đã có
        }
    }
    // 2. Ref Images Table
    exports.db.exec(`
    CREATE TABLE IF NOT EXISTS ref_images (
      id TEXT PRIMARY KEY,
      tag TEXT UNIQUE NOT NULL,
      filename TEXT NOT NULL,
      filepath TEXT NOT NULL,
      size INTEGER NOT NULL,
      mime_type TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
    // Vai trò của ảnh tham chiếu: character_face | character_full | storyboard | product (NULL = chưa đặt)
    // và ghi chú khóa (mô tả bắt buộc giữ đúng, vd. màu/chi tiết sản phẩm) gửi kèm cho Muse.
    for (const col of ['role TEXT', 'lock_notes TEXT']) {
        try {
            exports.db.exec(`ALTER TABLE ref_images ADD COLUMN ${col}`);
        }
        catch {
            // cột đã có
        }
    }
    // Gán vai trò ban đầu cho ảnh CHƯA có vai trò (không đè lên vai trò người dùng đã chọn)
    exports.db.exec(`UPDATE ref_images SET role = 'product' WHERE role IS NULL AND lower(tag) = 'sevolra'`);
    exports.db.exec(`UPDATE ref_images SET role = 'storyboard' WHERE role IS NULL AND lower(tag) GLOB 'x[0-9]*'`);
    exports.db.exec(`UPDATE ref_images SET role = 'character_face' WHERE role IS NULL AND lower(tag) LIKE '%\\_face' ESCAPE '\\'`);
    exports.db.prepare(`UPDATE ref_images SET lock_notes = ? WHERE lower(tag) = 'sevolra' AND (lock_notes IS NULL OR lock_notes = '')`).run('Sevolra one-piece seat cushion: DARK CHARCOAL-GREY fabric (xám đen) - never pure black; light-grey bottom trim; wavy top edge on the backrest; exactly 5 recessed vertical grooves; oval tailbone cutout at the back of the seat. Copy shape and color from this image only.');
    // 3. Jobs Table
    exports.db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      prompt TEXT NOT NULL,
      ref_tags TEXT DEFAULT '[]',
      status TEXT DEFAULT 'pending',
      progress INTEGER DEFAULT 0,
      duration INTEGER DEFAULT 10,
      ratio TEXT DEFAULT '9:16',
      account_id TEXT,
      attempts INTEGER DEFAULT 0,
      max_retries INTEGER DEFAULT 2,
      timeout_minutes INTEGER DEFAULT 15,
      created_at TEXT DEFAULT (datetime('now')),
      started_at TEXT,
      finished_at TEXT,
      elapsed_sec INTEGER DEFAULT 0,
      video_url TEXT,
      thumbnail_url TEXT,
      error TEXT,
      batch_id TEXT,
      sort_order INTEGER DEFAULT 0
    );
  `);
    // Danh sách ảnh thật sự đã đính kèm khi gửi Muse (thứ tự, tag, vai trò) để kiểm tra lại sau
    try {
        exports.db.exec(`ALTER TABLE jobs ADD COLUMN attached_refs TEXT`);
    }
    catch {
        // cột đã có
    }
    // 4. Studio Cards Table
    exports.db.exec(`
    CREATE TABLE IF NOT EXISTS studio_cards (
      id TEXT PRIMARY KEY,
      image_path TEXT,
      image_url TEXT,
      prompt TEXT DEFAULT '',
      ref_tags TEXT DEFAULT '[]',
      status TEXT DEFAULT 'idle',
      progress INTEGER DEFAULT 0,
      video_url TEXT,
      thumbnail_url TEXT,
      position_x REAL DEFAULT 100,
      position_y REAL DEFAULT 100,
      job_id TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
    // 5. Settings Table
    exports.db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);
    // Insert default settings
    const insertSetting = exports.db.prepare(`
    INSERT OR IGNORE INTO settings (key, value) VALUES (@key, @value)
  `);
    const defaultSettings = [
        { key: 'concurrency', value: '3' },
        { key: 'paste_auto_run', value: '1' },
        { key: 'retry_count', value: '2' },
        { key: 'timeout_minutes', value: '15' },
        { key: 'proxy_mode', value: 'key_per_job' },
        { key: 'proxy_raw_list', value: '' },
        { key: 'proxy_shared_slots', value: '1' },
        { key: 'proxy_auto_rotate', value: '1' }
    ];
    const insertMany = exports.db.transaction((settings) => {
        for (const setting of settings) {
            insertSetting.run(setting);
        }
    });
    insertMany(defaultSettings);
}
// Initialize on import
initDatabase();

if (!exports.db.prepare("PRAGMA table_info(jobs)").all().some(c => c.name === "media_type")) exports.db.exec("ALTER TABLE jobs ADD COLUMN media_type TEXT NOT NULL DEFAULT 'video'");

if (!exports.db.prepare("PRAGMA table_info(jobs)").all().some(c => c.name === "archived_at")) exports.db.exec("ALTER TABLE jobs ADD COLUMN archived_at TEXT");

for (const column of ["upscale_url TEXT", "upscale_width INTEGER", "upscale_height INTEGER"]) { const name = column.split(" ")[0]; if (!exports.db.prepare("PRAGMA table_info(jobs)").all().some(c => c.name === name)) exports.db.exec("ALTER TABLE jobs ADD COLUMN " + column); }
