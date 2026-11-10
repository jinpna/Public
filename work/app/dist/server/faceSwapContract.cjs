'use strict';
const PREFIX='FACE SWAP / IDENTITY TRANSFER.';
function isFaceSwap(prompt){return String(prompt||'').startsWith(PREFIX)}
function faceSwapManifest(prompt,refs){
 if(!isFaceSwap(prompt))return null;
 if(refs.length!==2)throw Error('Face swap cần đúng hai ảnh: ảnh đích/concept trước, khuôn mặt của bạn sau.');
 const target=String(prompt).match(/@([\w-]+) is the TARGET/)?.[1];
 const identity=String(prompt).match(/@([\w-]+) is the FACE IDENTITY/)?.[1];
 if(!target||!identity||target.toLowerCase()===identity.toLowerCase())throw Error('Vai trò ảnh Face swap không hợp lệ. Chọn lại hai ảnh khác nhau.');
 const names=refs.map(r=>r.tag.toLowerCase());
 if(names[0]!==target.toLowerCase()||names[1]!==identity.toLowerCase())throw Error('Thứ tự ảnh Face swap không khớp: ảnh 1 phải là đích/concept, ảnh 2 phải là khuôn mặt của bạn.');
 const concept=String(prompt).includes('MODE: CONCEPT_CLONE');
 return [
 '=== FACE IDENTITY PROTOCOL — TASK-SPECIFIC ROLES ===',
 `Attached image 1 = @${refs[0].tag}: TARGET ${concept?'CONCEPT':'PHOTO'}. Use its pose, camera, body placement, clothing, environment and lighting. Its face is NOT an identity reference and must not survive in the output.`,
 `Attached image 2 = @${refs[1].tag}: THE USER\'S IDENTITY. This is the ONLY source of facial identity: facial proportions, eye shape/spacing, nose, lips, jaw, age and recognizable natural asymmetry. Never blend identities or retain image 1\'s facial identity.`,
 concept?'Recreate the scene/concept of image 1 with the person whose identity is in image 2. Re-render the person coherently in that scene; do not merely return either uploaded image.':'Edit image 1 in place. Change only the selected face to the identity of image 2, with a natural anatomical fit; preserve the rest of the target composition.',
 'Identity geometry comes from image 2; rendered illumination and skin color adaptation come from image 1. A different lighting or skin tone must not change identity. Match local shadows, white balance and neck/jaw transition without copying the target facial features.',
 'Output exactly ONE finished image, no collage, reference board, side-by-side comparison or captions. Return the generated image file.',
 'These task-local roles override saved library roles and lock notes for these two assets. Do not apply a generic keep-all-faces or full-body identity lock.',
 '=== END FACE IDENTITY PROTOCOL ==='
 ].join('\n');
}
module.exports={isFaceSwap,faceSwapManifest};
