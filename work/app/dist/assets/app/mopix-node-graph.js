export const NODE_WIDTH=236,NODE_HEIGHT=220;
export function makeNode(kind,x=80,y=80){return{id:crypto.randomUUID(),kind,x,y,title:kind==='image'?'Ảnh':kind==='video'?'Video':'Text',prompt:'',ratio:'16:9',duration:5,style:''}}
export function initialGraph(){
 const text=makeNode('text',40,60),image=makeNode('image',350,60),video=makeNode('video',660,60);
 text.title='Ý tưởng';text.prompt='Mô tả chủ thể, bối cảnh và chuyển động.';
 return{version:1,nodes:[text,image,video],edges:[{id:crypto.randomUUID(),from:text.id,to:image.id},{id:crypto.randomUUID(),from:image.id,to:video.id}]};
}
export function canConnect(graph,from,to){
 if(from===to||!graph.nodes.some(n=>n.id===from)||!graph.nodes.some(n=>n.id===to))return false;
 if(graph.edges.some(e=>e.from===from&&e.to===to))return false;
 if(graph.nodes.find(n=>n.id===to)?.kind==='text')return false;
 const seen=new Set(),stack=[to];while(stack.length){const id=stack.pop();if(id===from)return false;if(seen.has(id))continue;seen.add(id);stack.push(...graph.edges.filter(e=>e.from===id).map(e=>e.to))}
 return true;
}
export function connectNodes(graph,from,to){
 if(!canConnect(graph,from,to))throw Error('Không thể nối: đường trùng, vòng lặp hoặc cổng không phù hợp.');
 return{...graph,edges:[...graph.edges,{id:crypto.randomUUID(),from,to}]};
}
export const incomingNodes=(graph,id)=>graph.edges.filter(e=>e.to===id).map(e=>graph.nodes.find(n=>n.id===e.from)).filter(Boolean);
export function graphSnapshot(graph){return{version:1,nodes:graph.nodes.map(({id,kind,x,y,title,prompt,ratio,duration,style,asset,study,analysis,analysisKey,job})=>({id,kind,x,y,title,prompt,ratio,duration,style,asset,study,analysis,analysisKey,job:job?{id:job.id,status:job.status,video_url:job.video_url,media_type:job.media_type}:undefined})),edges:graph.edges}}
// Drafts are local state, not trusted media manifests. Only app-owned media paths
// and the fixed engine settings survive a reload.
export const localMediaURL=value=>typeof value==='string'&&/^\/(?:uploads|videos|media)\/[A-Za-z0-9_./%?=&-]+$/.test(value)&&!value.includes('..')?value:undefined;
export function sanitizeGraph(g){
 if(g?.version!==1||!Array.isArray(g.nodes)||!Array.isArray(g.edges)||g.nodes.length>40||g.edges.length>150)throw Error('Invalid canvas');
 const ids=new Set(),nodes=g.nodes.map(n=>{
  if(!['text','image','video'].includes(n.kind)||typeof n.id!=='string'||!n.id||ids.has(n.id)||!Number.isFinite(n.x)||!Number.isFinite(n.y))throw Error('Invalid node');ids.add(n.id);
  const clean={id:n.id,kind:n.kind,x:Math.max(-100000,Math.min(100000,n.x)),y:Math.max(-100000,Math.min(100000,n.y)),title:String(n.title||n.kind).slice(0,80),prompt:String(n.prompt||'').slice(0,20000),ratio:['16:9','9:16','1:1'].includes(n.ratio)?n.ratio:'16:9',duration:n.duration===10?10:5,style:/^m[0-9]{1,2}$/i.test(n.style||'')?n.style:''};
  if(n.asset&&/^[\p{L}\p{N}_-]{1,200}$/u.test(n.asset.tag||'')){const url=localMediaURL(n.asset.url||n.asset.file_url||('/uploads/'+n.asset.filename));if(url)clean.asset={tag:n.asset.tag,url,original_name:String(n.asset.original_name||'').slice(0,200)}}
  if(n.study&&/^[a-zA-Z0-9_-]+$/.test(n.study.id||'')){const url=localMediaURL(n.study.url);if(url)clean.study={id:n.study.id,url,tag:n.study.tag,duration:n.study.duration}}
  if(n.job&&typeof n.job.id==='string')clean.job={id:n.job.id.slice(0,200),status:['pending','running','completed','failed','cancelled'].includes(n.job.status)?n.job.status:'failed',media_type:n.kind,video_url:localMediaURL(n.job.video_url)};
  return clean;
 });
 const clean={version:1,nodes,edges:[]},edgeIds=new Set();for(const e of g.edges){if(typeof e.id!=='string'||edgeIds.has(e.id)||!canConnect(clean,e.from,e.to))throw Error('Invalid edge');edgeIds.add(e.id);clean.edges.push({id:e.id,from:e.from,to:e.to})}return clean;
}
export function readGraph(){try{return sanitizeGraph(JSON.parse(localStorage.getItem('mopix-node-canvas')||'null'))}catch{return initialGraph()}}
