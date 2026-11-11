import{uploadStudioImages,studioAPI as api}from'./studio-assets.js?v=7';
import{sanitizeGraph}from'./mopix-node-graph.js';
// Bundled references retain their declared source and exact content hash.
// User-supplied reference files are not labeled as MUSE-generated images.
export function validateDemo(template){
 if(template.demo===undefined)return[];const demo=template.demo;
 if(demo?.version!==1||!['MUSE','user-supplied'].includes(demo.provider)||!Array.isArray(demo.assets)||!demo.assets.length||demo.assets.length>40)throw Error('Bản demo thiếu thông tin nguồn ảnh.');
 const seen=new Set();return demo.assets.map(asset=>{const node=template.nodes.find(n=>n.id===asset.nodeId),bundledPath=/^\/assets\/data\/demo-refs\/[a-z0-9-]+\.(png|jpg|webp)$/.test(asset.url||''),musePath=/^\/assets\/demo-workflows\/[a-z0-9-]+\/[a-z0-9-]+\.(png|jpg|webp)$/.test(asset.url||'');
  if(!node||node.kind!=='image'||seen.has(node.id)||!(demo.provider==='MUSE'?musePath:bundledPath)||demo.provider==='MUSE'&&!/^task_[a-zA-Z0-9_-]+$/.test(asset.jobId||'')||demo.provider==='user-supplied'&&(node.demoImage!==asset.url||!Number.isInteger(asset.width)||!Number.isInteger(asset.height)||asset.width<1||asset.height<1)||!/^[a-f0-9]{64}$/.test(asset.sha256||'')||!['image/png','image/jpeg','image/webp'].includes(asset.mime))throw Error('Ảnh demo không hợp lệ: '+(asset.nodeId||'?'));seen.add(node.id);return asset});
}
export async function hydrateWorkflowDemo(template,graph,{fetchFile=fetch,upload=uploadStudioImages,listReferences=()=>api('/api/refs')}={}){
 const assets=validateDemo(template);if(!assets.length)return graph;
 // Validate and hash EVERY file before importing anything or replacing the current graph.
 const files=[];for(const a of assets){const response=await fetchFile(a.url);if(!response.ok)throw Error('Thiếu ảnh demo '+a.nodeId+'. Canvas hiện tại được giữ nguyên.');const data=await response.arrayBuffer();if(!data.byteLength||data.byteLength>8*1024*1024)throw Error('Dung lượng ảnh demo không hợp lệ.');const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data))).map(b=>b.toString(16).padStart(2,'0')).join('');if(hash!==a.sha256)throw Error('Ảnh demo không khớp bản đã đóng gói: '+a.nodeId);files.push(new File([data],'mopix-demo-'+hash.slice(0,24)+'.'+a.url.split('.').pop(),{type:a.mime}))}
 const references=await listReferences(),refs=new Map();for(let i=0;i<assets.length;i++){const existing=references.find(r=>(r.original_name||r.originalName)===files[i].name);const ref=existing||(await upload([files[i]]))[0];if(!ref?.tag)throw Error('Không nhập được ảnh demo '+assets[i].nodeId);refs.set(assets[i].nodeId,ref)}
 return sanitizeGraph({...graph,nodes:graph.nodes.map(n=>refs.has(n.id)?{...n,asset:refs.get(n.id),job:undefined}:n)});
}
