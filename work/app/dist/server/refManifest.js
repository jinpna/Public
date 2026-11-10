"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.REF_ROLES = void 0;
exports.resolveJobRefs = resolveJobRefs;
exports.buildRefManifest = buildRefManifest;
exports.refWarnings = refWarnings;
const fs_1 = __importDefault(require("fs"));
const db_1 = require("./db");
exports.REF_ROLES = ['character_face', 'character_full', 'storyboard', 'product'];
/**
 * Lấy ảnh tham chiếu của job: quét lại @mention trong PROMPT GỐC (thứ tự xuất hiện) rồi gộp ref_tags lưu lúc enqueue
 * (đường "ảnh dùng chung cho lô" cũ). Không tin riêng ref_tags -> job cũ có ref_tags=[] vẫn không mất ảnh.
 * missingTags: tag không có trong kho; missingFiles: tag có nhưng file trên đĩa đã mất.
 */
function resolveJobRefs(prompt, refTagsJson, preferInputOrder=false) {
    const tags = [];
    for (const m of prompt.matchAll(/(?:^|[\s(])@([\p{L}\p{N}_-]+)/gu))
        tags.push(m[1]);
    try {
        const shared = JSON.parse(refTagsJson || '[]');
        if (Array.isArray(shared))
            tags.push(...shared.map(String));
    }
    catch {
        // ref_tags hỏng thì chỉ dùng @mention
    }
    if(preferInputOrder){try{const input=JSON.parse(refTagsJson||'[]');if(Array.isArray(input))tags.unshift(...input.map(String))}catch{}}
    const refs = [];
    const missingTags = [];
    const missingFiles = [];
    const seen = new Set();
    for (const raw of tags) {
        const tag = raw.replace(/^@/, '').toLowerCase();
        if (!tag || seen.has(tag))
            continue;
        seen.add(tag);
        const row = db_1.db.prepare('SELECT tag, filepath, role, lock_notes FROM ref_images WHERE lower(tag) = ?').get(tag);
        if (!row) {
            missingTags.push(tag);
            continue;
        }
        if (!row.filepath || !fs_1.default.existsSync(row.filepath)) {
            missingFiles.push(tag);
            continue;
        }
        refs.push({
            order: refs.length + 1,
            tag: row.tag,
            role: exports.REF_ROLES.includes(row.role) ? row.role : null,
            file: row.filepath,
            lockNotes: row.lock_notes?.trim() || null,
        });
    }
    return { refs, missingTags, missingFiles };
}
const ROLE_LABEL = {
    character_face: 'character face',
    character_full: 'character full body',
    storyboard: 'storyboard',
    product: 'product',
};
function roleRule(r, all) {
    const hasProduct = all.some((x) => x.role === 'product');
    const hasFace = all.some((x) => x.role === 'character_face' || x.role === 'character_full');
    switch (r.role) {
        case 'character_face':
            return 'identity lock ONLY: keep this exact face, hair, skin tone and age for the character in every shot. Do not take clothing, body or setting from this image unless nothing else specifies them.';
        case 'character_full':
            return 'character authority: keep this exact face, body proportions, hair and outfit for the character in every shot.';
        case 'storyboard':
            return ('authority for composition, camera angles, shot order, setting, vehicle/room, lighting and wardrobe.' +
                (hasFace ? ' Faces drawn here are only placeholders: use the character reference image(s) for identity.' : '') +
                (hasProduct ? ' IGNORE any product drawn in this storyboard (shape and color): the product comes ONLY from the product image.' : ''));
        case 'product':
            return 'SOLE authority for the product: shape, color, material, details. Overrides the storyboard AND any product wording in the prompt.';
        default:
            return 'general reference.';
    }
}
/** Khối hệ thống gửi kèm sau prompt gốc. Trả về '' khi job không có ảnh tham chiếu. */
function buildRefManifest(refs) {
    if (refs.length === 0)
        return '';
    const lines = [];
    lines.push('=== REFERENCE ROLE & PRIORITY PROTOCOL (system-inserted by Musee, not part of the user prompt) ===');
    lines.push(`Attached images, in this exact order (${refs.length}):`);
    for (const r of refs) {
        const role = r.role ? ROLE_LABEL[r.role] : 'unspecified';
        lines.push(`- Image ${r.order} = @${r.tag} (${role}): ${roleRule(r, refs)}`);
    }
    const products = refs.filter((r) => r.role === 'product');
    const storyboards = refs.filter((r) => r.role === 'storyboard');
    const faces = refs.filter((r) => r.role === 'character_face' || r.role === 'character_full');
    lines.push('Priority rules:');
    lines.push('- CONSISTENCY: keep identity, face geometry, body proportions, material, product marks and lighting consistent with the attached references. Change only explicitly requested attributes. Never merge identities from multiple references; each reference only controls its assigned role.');
    if (products.length) {
        lines.push(`- PRODUCT: ${products.map((p) => `@${p.tag}`).join(', ')} > storyboard > prompt text. If the prompt or the storyboard describes the product differently (color, shape), follow the product image.`);
    }
    if (faces.length) {
        lines.push(`- IDENTITY: ${faces.map((f) => `@${f.tag}`).join(', ')} > storyboard faces > prompt text.`);
    }
    if (storyboards.length) {
        lines.push(`- SCENE: ${storyboards.map((s) => `@${s.tag}`).join(', ')} define framing, setting and wardrobe; do not render the storyboard grid itself.`);
    }
    const locks = refs.filter((r) => r.lockNotes);
    if (locks.length) {
        lines.push('Locks (must match exactly):');
        for (const r of locks)
            lines.push(`- @${r.tag} lock: ${r.lockNotes}`);
    }
    lines.push('=== END PROTOCOL ===');
    return lines.join('\n');
}
/** Cảnh báo (không chặn) cho 1 prompt theo vai trò ảnh. Dùng chung cho giao diện qua API. */
function refWarnings(refs, prompt) {
    const warnings = [];
    const roles = new Set(refs.map((r) => r.role));
    const describesCharacter = /\b(man|woman|boy|girl|father|mother|he |she |wearing|outfit|nhân vật|mặc|áo|quần)\b/i.test(prompt);
    if (roles.has('character_face') && !roles.has('storyboard') && !roles.has('character_full') && !describesCharacter) {
        warnings.push('Chỉ có ảnh khuôn mặt: nên thêm storyboard / ảnh toàn thân hoặc mô tả trang phục, dáng người, bối cảnh để mặt không bị trôi.');
    }
    if (roles.has('storyboard') && !roles.has('product')) {
        warnings.push('Có storyboard nhưng chưa có ảnh sản phẩm (product): sản phẩm sẽ bị vẽ theo storyboard, dễ sai màu/hình.');
    }
    return warnings;
}
