'use strict';
function conceptManifest(prompt,refs){
 if(String(prompt||'').startsWith('GUIDED IMAGE PRESET v44.')){
 const text=String(prompt),source=text.match(/SOURCE @([\w-]+) =/)?.[1],target=text.match(/SAMPLE @([\w-]+) =/)?.[1];
 if(!source||!target||source===target)throw Error('Ảnh gốc và ảnh mẫu không hợp lệ.');
 const at=tag=>refs.findIndex(r=>r.tag.toLowerCase()===tag.toLowerCase())+1,si=at(source),ti=at(target);
 if(!si||!ti)throw Error('Thiếu ảnh gốc hoặc ảnh mẫu. Chọn lại ảnh trước khi tạo.');
 const person=text.includes('SUBJECT: person.');
 return ['=== GUIDED TASK ROLES ===','Image '+si+' @'+source+': ONLY source '+(person?'facial identity. Preserve recognizable facial geometry and age.':'subject. Preserve exact source product geometry/materials or background as requested.'),'Image '+ti+' @'+target+': sample concept/scene/outfit only as specified by the selected preset. Never its facial identity or product.',...refs.filter(r=>![source.toLowerCase(),target.toLowerCase()].includes(r.tag.toLowerCase())).map(r=>'@'+r.tag+': mood colors/light ONLY; no identity or product.'),'Do not apply saved library roles, outfit locks or generic keep-all-faces rules. Follow the selected preset for what changes and what stays. Return one final image, not a collage.','=== END GUIDED TASK ROLES ==='].join('\n');
 }
 if(!String(prompt||'').startsWith('BATCH VISUAL RECREATION.'))return null;
 const text=String(prompt),source=text.match(/SOURCE @([\w-]+):/)?.[1],target=text.match(/TARGET @([\w-]+):/)?.[1];
 if(!source||!target||source.toLowerCase()===target.toLowerCase())throw Error('Vai trò ảnh gốc và ảnh mẫu không hợp lệ.');
 const index=tag=>refs.findIndex(r=>r.tag.toLowerCase()===tag.toLowerCase())+1,si=index(source),ti=index(target);
 if(!si||!ti)throw Error('Thiếu ảnh gốc hoặc ảnh mẫu; chưa gửi tác vụ lên MUSE.');
 const person=/SUBJECT: person\.|Only source of person identity|IDENTITY: keep SOURCE face/.test(text);
 return ['=== TASK-LOCAL SUBJECT REPLACEMENT CONTRACT ===',`Attached image ${si} = @${source}: SOURCE, the ONLY subject identity and geometry.`,`Attached image ${ti} = @${target}: TARGET, layout/scene reference ONLY. Its person/product is NOT the requested subject and must be replaced.`,...refs.filter(r=>![source.toLowerCase(),target.toLowerCase()].includes(r.tag.toLowerCase())).map(r=>`Attached image ${index(r.tag)} = @${r.tag}: palette/light ONLY; ignore its faces, products and composition.`),person?`The output must unmistakably depict the person in image ${si}. Preserve exact facial proportions, eye shape/spacing, nose, lips, jaw and age. Never retain or merge the face from image ${ti}. Adapt illumination and expression without changing identity.`:'Preserve SOURCE intrinsic product geometry or background structure as requested; never substitute TARGET product.',text.includes('TEXT-FREE CONCEPT:')?'No text/logo or watermark.':person?'No added text/logo or watermark.':'Keep authentic SOURCE product markings; add no text.', 'Do not return an unchanged reference. One finished image only. These roles override library locks.','=== END TASK CONTRACT ==='].join('\n');
}
module.exports={conceptManifest};
