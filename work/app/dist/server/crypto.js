"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.encrypt = encrypt;
exports.decrypt = decrypt;
exports.maskIdentifier = maskIdentifier;
const crypto_1 = __importDefault(require("crypto"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const paths_1 = require("./paths");
const dataDir = paths_1.DATA_DIR;
if (!fs_1.default.existsSync(dataDir)) {
    fs_1.default.mkdirSync(dataDir, { recursive: true });
}
const KEY_FILE = path_1.default.join(dataDir, 'encryption.key');
function getOrCreateKey() {
    if (fs_1.default.existsSync(KEY_FILE)) {
        const keyHex = fs_1.default.readFileSync(KEY_FILE, 'utf-8').trim();
        if (keyHex.length === 64) {
            return Buffer.from(keyHex, 'hex');
        }
    }
    const newKey = crypto_1.default.randomBytes(32);
    fs_1.default.writeFileSync(KEY_FILE, newKey.toString('hex'), 'utf-8');
    return newKey;
}
const encryptionKey = getOrCreateKey();
/**
 * Encrypt a plain text string using AES-256-GCM.
 * Output format: iv_hex:auth_tag_hex:encrypted_hex
 */
function encrypt(plainText) {
    const iv = crypto_1.default.randomBytes(12);
    const cipher = crypto_1.default.createCipheriv('aes-256-gcm', encryptionKey, iv);
    let encrypted = cipher.update(plainText, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}
/**
 * Decrypt an AES-256-GCM encrypted string.
 */
function decrypt(encryptedText) {
    const parts = encryptedText.split(':');
    if (parts.length !== 3) {
        throw new Error('Định dạng dữ liệu mã hóa không hợp lệ');
    }
    const [ivHex, authTagHex, contentHex] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = crypto_1.default.createDecipheriv('aes-256-gcm', encryptionKey, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(contentHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}
/**
 * Mask an email or username identifier for privacy display.
 * E.g., user@example.com -> u***r@example.com
 * E.g., my_username_123 -> my***23
 */
function maskIdentifier(identifier) {
    if (!identifier)
        return '***';
    const atIndex = identifier.indexOf('@');
    if (atIndex > 0) {
        const userPart = identifier.substring(0, atIndex);
        const domainPart = identifier.substring(atIndex);
        if (userPart.length <= 2) {
            return `${userPart[0]}***${domainPart}`;
        }
        const start = userPart.substring(0, 2);
        const end = userPart.substring(userPart.length - 1);
        return `${start}***${end}${domainPart}`;
    }
    // Friendly labels like "Tài khoản 1", "Account 2" remain recognizable
    if (/^Tài khoản/i.test(identifier) || /^Account/i.test(identifier) || identifier.length <= 8) {
        return identifier;
    }
    const start = identifier.substring(0, 3);
    const end = identifier.substring(identifier.length - 2);
    return `${start}***${end}`;
}
