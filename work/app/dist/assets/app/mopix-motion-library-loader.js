// The 50-motion file is supplied separately. Empty/missing data is never
// replaced with invented presets or stock previews.
export async function loadMotionLibrary({signal}={}){
 const response=await fetch('/assets/data/motion-library.json',{signal});
 if(response.status===404)return{items:[],pending:true};
 if(!response.ok)throw Error('Không tải được kho motion.');
 const data=await response.json(),items=Array.isArray(data)?data:data.items;
 if(!Array.isArray(items))throw Error('Kho motion cần một danh sách items.');
 const ids=new Set();for(const motion of items){
  for(const key of ['id','group','name_vi','name_en','prompt_en','preview_url','preview_kind'])if(typeof motion[key]!=='string'||!motion[key].trim())throw Error('Motion thiếu trường '+key+'.');
  if(ids.has(motion.id))throw Error('Motion trùng id: '+motion.id);ids.add(motion.id);
  if(![5,10].includes(motion.duration_s))throw Error('Motion chỉ hỗ trợ 5s hoặc 10s.');
  if(!Number.isFinite(motion.strength_default)||motion.strength_default<0||motion.strength_default>1)throw Error('strength_default cần trong khoảng 0–1.');
  if(!['image','video'].includes(motion.preview_kind))throw Error('preview_kind cần là image hoặc video.');
  if(!/^(https:\/\/|\/assets\/)/.test(motion.preview_url))throw Error('Đường dẫn preview không hợp lệ.');
 }
 return{items,pending:!items.length};
}
