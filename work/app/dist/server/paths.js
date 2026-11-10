"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DATA_DIR = exports.APP_DIR = void 0;
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
// Bản đóng gói: Electron đặt MUSE_DATA_DIR = %APPDATA%\Muse Batch Manager\data (mỗi người dùng một chỗ riêng)
// và MUSE_APP_DIR = thư mục chứa dist/. Khi chạy dev thì dùng thư mục dự án.
exports.APP_DIR = process.env.MUSE_APP_DIR || process.cwd();
exports.DATA_DIR = process.env.MUSE_DATA_DIR || path_1.default.join(process.cwd(), 'data');
fs_1.default.mkdirSync(exports.DATA_DIR, { recursive: true });
