import{studioAPI as api,createAssetPicker,assetURL}from'./studio-assets.js?v=7';
import{requireMuseLogin}from'./mopix-session.js';
import{createAIHelper}from'./mopix-ai-helper.js?v=2';
import{createStudioIcon}from'./studio-icons.js?v=24';
import{motionStyleDirection,MOTION_STYLES}from'./mopix-motion-styles.js';
import{NODE_WIDTH as W,NODE_HEIGHT as H,makeNode,initialGraph,readGraph,connectNodes,incomingNodes,graphSnapshot}from'./mopix-node-graph.js';
export function createNodeCanvas(React){
 const{createElement:h,useState:S,useRef:R,useEffect:E}=React,Icon=createStudioIcon(React),AI=createAIHelper(React),Picker=createAssetPicker(React);
 return function NodeCanvas(){
  const[g,G]=S(readGraph),[selected,SEL]=S(null),[view,V]=S({x:80,y:130,z:1}),[connections,CON]=S(true),[minimap,MINI]=S(true),[pending,PEND]=S(null),[wire,WIRE]=S(null),[picker,PICK]=S(null),[error,ERR]=S(''),[busy,B]=S(null),[edge,EDGE]=S(null);
  const root=R(null),world=R(null),latest=R(g),currentView=R(view),drag=R(null),undo=R([]),lock=R(false),file=R(null),alive=R(true),raf=R(0),suppressPortClick=R(false);
  latest.current=g;currentView.current=view;
  const node=g.nodes.find(n=>n.id===selected),inputs=node?incomingNodes(g,node.id):[],imageInputs=inputs.filter(n=>n.kind==='image'),refs=imageInputs.map(n=>n.asset||{tag:'unready_'+n.id,missing:true}),mentionRefs=[...imageInputs.map((n,i)=>({...n.asset,url:n.asset?assetURL(n.asset):n.job?.video_url,alias:'image'+(i+1)})),...inputs.filter(n=>n.kind==='video').map((n,i)=>({alias:'Video'+(i+1)}))];
  function remember(){undo.current.push(graphSnapshot(latest.current));if(undo.current.length>25)undo.current.shift()}
  function update(id,patch){if(!alive.current){latest.current={...latest.current,nodes:latest.current.nodes.map(n=>n.id===id?{...n,...patch}:n)};try{localStorage.setItem('mopix-node-canvas',JSON.stringify(graphSnapshot(latest.current)))}catch{}return}G(old=>({...old,nodes:old.nodes.map(n=>n.id===id?{...n,...patch}:n)}))}
  function icon(label,name,fn,extra={}){return h('button',{type:'button','aria-label':label,title:label,onClick:fn,...extra},h(Icon,{name,size:18}))}
  function remove(id){remember();G(old=>({...old,nodes:old.nodes.filter(n=>n.id!==id),edges:old.edges.filter(e=>e.from!==id&&e.to!==id)}));SEL(null)}
  function add(kind){if(g.nodes.length>=40){ERR('Mỗi canvas tối đa 40 node.');return}remember();const r=root.current.getBoundingClientRect(),n=makeNode(kind,(r.width/2-view.x)/view.z-W/2,(r.height/2-view.y)/view.z-H/2);for(let i=0;i<80&&g.nodes.some(o=>Math.abs(o.x-n.x)<W+30&&Math.abs(o.y-n.y)<H+30);i++){n.x+=W+55;if(i%4===3){n.x=40;n.y+=H+70}}G(old=>({...old,nodes:[...old.nodes,n]}));SEL(n.id);setTimeout(fit,30)}
   function attach(from,to){try{const next=connectNodes(latest.current,from,to);remember();G(next);ERR('')}catch(e){ERR(e.message)}PEND(null);WIRE(null)}
  function fit(){
   if(!g.nodes.length){V({x:80,y:130,z:1});return}
   const r=root.current.getBoundingClientRect(),nodes=latest.current.nodes,minX=Math.min(...nodes.map(n=>n.x))-50,minY=Math.min(...nodes.map(n=>n.y))-60,maxX=Math.max(...nodes.map(n=>n.x+W))+50,maxY=Math.max(...nodes.map(n=>n.y+H))+60,z=Math.max(.25,Math.min(1.2,(r.width-60)/(maxX-minX),(r.height-110)/(maxY-minY)));V({x:(r.width-(maxX-minX)*z)/2-minX*z,y:(r.height-(maxY-minY)*z)/2-minY*z,z});
  }
  E(()=>{const observer=new ResizeObserver(fit);observer.observe(root.current);return()=>observer.disconnect()},[]);
  function zoom(z,px,py){const r=root.current.getBoundingClientRect(),old=currentView.current;z=Math.max(.25,Math.min(2,z));px??=r.width/2;py??=r.height/2;V({x:px-(px-old.x)*z/old.z,y:py-(py-old.y)*z/old.z,z})}
  function down(e,id){
   if(e.button!==0&&e.button!==1)return;if(e.target.closest('button,input,textarea,video,a'))return;
   if(id){SEL(id);remember()}else{SEL(null);EDGE(null)}
   e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);drag.current={id,pointer:e.pointerId,x:e.clientX,y:e.clientY,view:{...currentView.current},node:latest.current.nodes.find(n=>n.id===id)};
  }
  function move(e){const d=drag.current;if(!d)return;const dx=e.clientX-d.x,dy=e.clientY-d.y;cancelAnimationFrame(raf.current);raf.current=requestAnimationFrame(()=>{if(d.id)update(d.id,{x:d.node.x+dx/d.view.z,y:d.node.y+dy/d.view.z});else V({...d.view,x:d.view.x+dx,y:d.view.y+dy})})}
  function up(e){if(drag.current?.pointer===e.pointerId){drag.current=null;if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId)}}
  E(()=>{alive.current=true;return()=>{alive.current=false;cancelAnimationFrame(raf.current);try{localStorage.setItem('mopix-node-canvas',JSON.stringify(graphSnapshot(latest.current)))}catch{}}},[]);
  E(()=>{const t=setTimeout(()=>{try{localStorage.setItem('mopix-node-canvas',JSON.stringify(graphSnapshot(g)))}catch{ERR('Không lưu được bản nháp Canvas.')}},250);return()=>clearTimeout(t)},[g]);
  E(()=>{const el=root.current;function wheel(e){if(e.target.closest('textarea,select,video'))return;e.preventDefault();if(e.ctrlKey||e.metaKey){const r=el.getBoundingClientRect();zoom(currentView.current.z*Math.exp(-e.deltaY*.005),e.clientX-r.left,e.clientY-r.top)}else V(v=>({...v,x:v.x-e.deltaX,y:v.y-e.deltaY}))}el.addEventListener('wheel',wheel,{passive:false});return()=>el.removeEventListener('wheel',wheel)},[]);
  E(()=>{function key(e){if(e.target.closest('input,textarea,[contenteditable=true],dialog'))return;if(e.key==='Escape'){PEND(null);WIRE(null);EDGE(null)}if((e.metaKey||e.ctrlKey)&&e.key==='z'){e.preventDefault();const previous=undo.current.pop();if(previous)G(previous)}if(e.key==='Delete'||e.key==='Backspace'){if(edge){remember();G(old=>({...old,edges:old.edges.filter(x=>x.id!==edge)}));EDGE(null)}else if(selected&&!busy)remove(selected)}}window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key)},[selected,edge,busy]);
  E(()=>{let stopped=false;async function poll(){const pending=latest.current.nodes.filter(n=>['pending','running'].includes(n.job?.status));if(!pending.length)return;try{const lists=await Promise.all(['image','video'].map(media=>api('/api/queue/jobs?media='+media+'&limit=5000')));if(stopped)return;const rows=lists.flatMap(d=>d.jobs||[]);G(old=>({...old,nodes:old.nodes.map(n=>{const row=rows.find(j=>j.id===n.job?.id);return row?{...n,job:row}:n})}))}catch{}}poll();const t=setInterval(poll,2000);return()=>{stopped=true;clearInterval(t)}},[]);
  E(()=>{let stopped=false;const sources=imageInputs.filter(n=>!n.asset&&n.job?.status==='completed');(async()=>{for(const source of sources){try{const result=await api('/api/images/'+encodeURIComponent(source.job.id)+'/reference',{});if(!stopped)update(source.id,{asset:result.reference})}catch(e){if(!stopped)ERR(e.message)}}})();return()=>{stopped=true}},[selected,imageInputs.map(n=>n.id+':'+n.job?.status+':'+n.asset?.tag).join('|')]);
  async function uploadVideo(f){if(!f||!node||lock.current)return;const id=node.id;lock.current=true;B(id);ERR('');try{const body=new FormData();body.append('file',f);const response=await fetch('/api/prompt-assistant/motion-reference/prepare',{method:'POST',body}),study=await response.json();if(!response.ok)throw Error(study.error||'Không đọc được video.');update(id,{study,analysis:null,job:null})}catch(e){ERR(e.message)}finally{lock.current=false;if(alive.current)B(null)}}
  async function run(id){
   if(lock.current)return;const target=latest.current.nodes.find(n=>n.id===id);if(!target||target.kind==='text')return;
   lock.current=true;B(id);ERR('');
   try{
    await requireMuseLogin();
    const incoming=incomingNodes(latest.current,id),images=[],videos=incoming.filter(n=>n.kind==='video'),text=incoming.filter(n=>n.kind==='text').map(n=>n.prompt).filter(Boolean);
    for(const source of incoming.filter(n=>n.kind==='image')){
     let asset=source.asset;if(!asset&&source.job?.status==='completed'){asset=(await api('/api/images/'+encodeURIComponent(source.job.id)+'/reference',{})).reference;update(source.id,{asset})}
     if(!asset)throw Error('Node '+source.title+' chưa có ảnh. Tải ảnh hoặc chạy node đó trước.');
     images.push(asset);
    }
    if(images.length>5)throw Error('Một node nhận tối đa 5 ảnh. Bỏ bớt đường nối ảnh.');
    let prompt=[...text,target.prompt].filter(Boolean).join('\n\n');if(!prompt.trim())throw Error('Nhập prompt hoặc nối một node Text.');
    for(const [i,source]of videos.entries()){
     if(target.kind==='image')throw Error('Tham chiếu video dành cho node Video.');
     let study=source.study,analysis=source.analysis;
     if(!study&&source.job?.status==='completed'){
      const response=await fetch(source.job.video_url);if(!response.ok)throw Error('Không tải được video tham chiếu.');
      const form=new FormData();form.append('file',new File([await response.blob()],'reference.mp4',{type:'video/mp4'}));const r=await fetch('/api/prompt-assistant/motion-reference/prepare',{method:'POST',body:form});study=await r.json();if(!r.ok)throw Error(study.error);update(source.id,{study});
     }
     if(!study)throw Error('Node video tham chiếu chưa có clip. Tải clip hoặc chạy node đó trước.');
     // Sampled-frame analysis, not direct video conditioning or motion cloning.
     const key=images[0]?.tag+':'+target.duration;
     if(!analysis||source.analysisKey!==key){analysis=await api('/api/prompt-assistant/motion-reference/analyze',{id:study.id,targetTag:images[0]?.tag||'',duration:target.duration});update(source.id,{analysis,analysisKey:key})}
     prompt=prompt.replace(/@video\s*(\d+)(?![\p{L}\p{N}_-])/giu,(token,n)=>Number(n)===i+1?'motion reference '+(i+1):token);
     prompt+='\n\nMOTION REFERENCE '+(i+1)+' (sampled-frame interpretation, preserve target appearance):\n'+analysis.prompt;
    }
    if(target.kind==='video'&&target.style)prompt+='\n\n'+motionStyleDirection(target.style,target.duration);
    const spec={mediaType:target.kind,prompts:[prompt],ratio:target.ratio,duration:target.kind==='video'?target.duration:5,refTags:images.map(r=>r.tag)};
    const prepared=target.kind==='image'&&images.length?await api('/api/refs/prepare-inputs',spec):spec;
    const guard=await api('/api/queue/preflight',prepared);if(guard.errors?.length)throw Error(guard.errors.join('\n'));if(guard.warnings?.length)throw Error(guard.warnings.join('\n'));
    const result=await api('/api/queue/enqueue',{...prepared,clientContext:{mode:'canvas',prompt:target.prompt,ratio:target.ratio,duration:target.duration,references:images.map(r=>({tag:r.tag,url:assetURL(r)}))}});
    if(!result.jobs?.[0])throw Error('Không nhận được tác vụ từ MUSE.');update(id,{job:result.jobs[0],asset:null});await api('/api/queue/process',{});
   }catch(e){ERR(e.message)}finally{lock.current=false;if(alive.current)B(null)}
  }
  const port=(n,output)=>h('button',{type:'button',className:'mopix-node-port '+(output?'is-output':'is-input'),'data-node-in':output?undefined:n.id,'aria-label':(output?'Nối từ ':'Nối vào ')+n.title,title:output?'Kéo nối hoặc bấm chọn nguồn':'Thả dây hoặc bấm để nối',onClick:e=>{e.stopPropagation();if(output){if(suppressPortClick.current){suppressPortClick.current=false;return}PEND(n.id)}else if(pending)attach(pending,n.id)},onPointerDown:e=>{if(!output)return;e.stopPropagation();e.currentTarget.setPointerCapture(e.pointerId);PEND(n.id);WIRE({from:n.id,x:e.clientX,y:e.clientY})},onPointerMove:e=>{if(output&&e.currentTarget.hasPointerCapture(e.pointerId))WIRE({from:n.id,x:e.clientX,y:e.clientY})},onPointerUp:e=>{if(!output)return;if(e.currentTarget.hasPointerCapture(e.pointerId)){e.currentTarget.releasePointerCapture(e.pointerId);const dest=document.elementFromPoint(e.clientX,e.clientY)?.closest('[data-node-in]')?.dataset.nodeIn;if(dest){suppressPortClick.current=true;attach(n.id,dest)}else WIRE(null)}}});
  function media(n){const url=n.asset?assetURL(n.asset):n.job?.status==='completed'?n.job.video_url:n.study?.url;if(url)return n.kind==='video'?h('video',{src:url,controls:true,playsInline:true,preload:'metadata','aria-label':'Preview '+n.title}):h('img',{src:url,alt:'Preview '+n.title,draggable:false});return h('div',{className:'mopix-node-empty'},h(Icon,{name:n.kind==='text'?'prompt':n.kind==='video'?'video':'background',size:26}),h('small',null,['pending','running'].includes(n.job?.status)?'Đang xử lý…':n.kind==='text'?n.prompt.slice(0,130)||'Text':n.job?.status==='failed'?'Tác vụ chưa hoàn tất':'Chưa có kết quả'))}
  function curve(a,b){const d=Math.max(60,Math.abs(b.x-a.x)*.45);return`M ${a.x} ${a.y} C ${a.x+d} ${a.y}, ${b.x-d} ${b.y}, ${b.x} ${b.y}`}
  const bounds={x:Math.min(0,...g.nodes.map(n=>n.x))-40,y:Math.min(0,...g.nodes.map(n=>n.y))-40};bounds.w=Math.max(800,...g.nodes.map(n=>n.x+W))-bounds.x+40;bounds.h=Math.max(480,...g.nodes.map(n=>n.y+H))-bounds.y+40;
  return h('main',{className:'mopix-canvas-workspace'},h('section',{ref:root,className:'mopix-node-stage','aria-label':'Canvas node',onPointerDown:e=>down(e,null),onPointerMove:move,onPointerUp:up,onPointerCancel:up},
   h('div',{className:'mopix-canvas-toolbar'},icon('Thêm node Text','prompt',()=>add('text')),icon('Thêm node Ảnh','background',()=>add('image')),icon('Thêm node Video','video',()=>add('video')),icon('Vừa toàn bộ Canvas','view',fit),icon(connections?'Ẩn đường nối':'Hiện đường nối','compare',()=>CON(!connections),{'aria-pressed':connections}),icon('Minimap','grid',()=>MINI(!minimap),{'aria-pressed':minimap})),
   h('div',{ref:world,className:'mopix-node-world',style:{transform:`translate(${view.x}px,${view.y}px) scale(${view.z})`}},connections&&h('svg',{className:'mopix-node-edges','aria-label':'Đường nối'},...g.edges.map(e=>{const from=g.nodes.find(n=>n.id===e.from),to=g.nodes.find(n=>n.id===e.to);if(!from||!to)return null;return h('path',{key:e.id,d:curve({x:from.x+W,y:from.y+110},{x:to.x,y:to.y+110}),className:edge===e.id?'is-selected':'',tabIndex:0,role:'button','aria-label':'Đường nối '+from.title+' tới '+to.title,onClick:ev=>{ev.stopPropagation();EDGE(e.id)},onKeyDown:ev=>{if(ev.key==='Delete'||ev.key==='Backspace'){ev.preventDefault();ev.stopPropagation();remember();G(old=>({...old,edges:old.edges.filter(x=>x.id!==e.id)}));EDGE(null)}}})}),wire&&(()=>{const from=g.nodes.find(n=>n.id===wire.from),r=root.current.getBoundingClientRect();return h('path',{className:'is-draft',d:curve({x:from.x+W,y:from.y+110},{x:(wire.x-r.left-view.x)/view.z,y:(wire.y-r.top-view.y)/view.z})})})()),
    ...g.nodes.map(n=>h('article',{key:n.id,className:'mopix-canvas-node'+(selected===n.id?' is-selected':''),'data-node-id':n.id,style:{left:n.x,top:n.y,width:W,height:H},onPointerDown:e=>{e.stopPropagation();down(e,n.id)},onPointerMove:move,onPointerUp:up,onPointerCancel:up,onClick:()=>SEL(n.id),tabIndex:0,'aria-label':'Node '+n.title,onFocus:()=>SEL(n.id)},
     h('header',null,h(Icon,{name:n.kind==='text'?'prompt':n.kind==='video'?'video':'background',size:16}),h('span',null,n.title),n.kind!=='text'&&icon('Chạy node '+n.title,'concept',()=>run(n.id),{disabled:!!busy})),
     h('div',{className:'mopix-node-media'},media(n)),h('footer',null,h('small',null,n.kind==='text'?'Text':n.kind==='image'?n.ratio:n.duration+'s · '+n.ratio),icon('Chi tiết '+n.title,'sliders',()=>SEL(n.id))),
     n.kind!=='text'&&port(n,false),port(n,true)))),
   h('div',{className:'mopix-canvas-zoom'},icon('Thu nhỏ Canvas','zoomOut',()=>zoom(view.z/1.2)),h('output',{'aria-label':'Zoom Canvas'},Math.round(view.z*100)+'%'),icon('Phóng to Canvas','zoomIn',()=>zoom(view.z*1.2))),
   minimap&&h('svg',{className:'mopix-canvas-minimap',viewBox:`${bounds.x} ${bounds.y} ${bounds.w} ${bounds.h}`,'aria-label':'Minimap Canvas',onClick:e=>{const r=e.currentTarget.getBoundingClientRect(),stage=root.current.getBoundingClientRect(),x=bounds.x+(e.clientX-r.left)/r.width*bounds.w,y=bounds.y+(e.clientY-r.top)/r.height*bounds.h;V(v=>({...v,x:stage.width/2-x*v.z,y:stage.height/2-y*v.z}))}},...g.nodes.map(n=>h('rect',{key:n.id,x:n.x,y:n.y,width:W,height:H,rx:12,className:selected===n.id?'is-selected':''}))),
   pending&&h('p',{className:'mopix-canvas-hint',role:'status'},'Chọn cổng vào · Esc để hủy'),error&&h('p',{className:'mopix-canvas-error',role:'alert'},error)),
   h('aside',{className:'mopix-canvas-inspector'},h('header',null,node?h('input',{value:node.title,'aria-label':'Tên node',maxLength:80,onChange:e=>update(node.id,{title:e.target.value})}):h('h1',null,'Canvas'),node&&node.kind!=='text'&&icon(node.kind==='image'?'Chọn ảnh cho node':'Thêm clip tham chiếu · 1–30s','upload',()=>node.kind==='image'?PICK(node.id):file.current.click(),{disabled:!!busy}),node&&icon('Xóa node','trash',()=>remove(node.id),{disabled:!!busy})),
    node?h('div',{className:'mopix-canvas-details'},h('label',{className:'mopix-prompt-field'},h('span',null,'Prompt'),h('textarea',{key:node.id,value:node.prompt,'aria-label':'Prompt node',onChange:e=>update(node.id,{prompt:e.target.value}),placeholder:'Mô tả ý tưởng. Gõ @ để chọn đầu vào.'}),h(AI,{key:node.id,value:node.prompt,onChange:prompt=>update(node.id,{prompt}),references:refs,mentionReferences:mentionRefs,kind:node.kind==='video'?'video':'image',disabled:!!busy||refs.some(r=>r.missing)})),
     node.kind!=='text'&&h('div',{className:'mopix-canvas-properties'},h('label',null,'Khung hình',h('select',{'aria-label':'Khung hình node',value:node.ratio,onChange:e=>update(node.id,{ratio:e.target.value})},...['16:9','9:16','1:1'].map(v=>h('option',{key:v},v)))),node.kind==='video'&&h('label',null,'Thời lượng',h('select',{'aria-label':'Thời lượng node',value:node.duration,onChange:e=>update(node.id,{duration:Number(e.target.value)})},...[5,10].map(v=>h('option',{key:v,value:v},v+'s')))),node.kind==='video'&&h('label',null,'Motion',h('select',{'aria-label':'Phong cách node',value:node.style,onChange:e=>update(node.id,{style:e.target.value})},h('option',{value:''},'Theo prompt'),...MOTION_STYLES.map(s=>h('option',{key:s.id,value:s.id},s.name))))),
     node.kind==='image'&&node.asset&&h('div',{className:'mopix-canvas-source-actions'},icon('Bỏ ảnh nguồn khỏi node','close',()=>update(node.id,{asset:null})) ),
     node.kind==='video'&&h('div',{className:'mopix-canvas-source-actions'},h('input',{ref:file,type:'file',hidden:true,accept:'video/mp4,video/quicktime,video/webm',onChange:e=>{uploadVideo(e.target.files[0]);e.target.value=''}}),node.study&&icon('Bỏ clip tham chiếu','close',()=>update(node.id,{study:null,analysis:null}))),
     inputs.length>0&&h('div',{className:'mopix-canvas-inputs'},...inputs.map(n=>h('div',{key:n.id},h('small',null,n.kind==='image'?'@image'+(imageInputs.findIndex(i=>i.id===n.id)+1):n.kind==='video'?'@Video'+(inputs.filter(i=>i.kind==='video').findIndex(i=>i.id===n.id)+1):'Text'),h('span',null,n.title),icon('Ngắt nối '+n.title,'close',()=>{remember();G(old=>({...old,edges:old.edges.filter(e=>!(e.from===n.id&&e.to===node.id))}))})))),
     
     node.kind!=='text'&&h('footer',null,h('small',{title:inputs.some(n=>n.kind==='video')?'Clip được phân tích từ khung mẫu thành hướng dẫn chuyển động; không sao chép chính xác từng frame.':'Model mặc định của MUSE'},'MUSE'),icon(busy===node.id?'Đang gửi node':'Chạy node','concept',()=>run(node.id),{disabled:!!busy})))
    :h('div',{className:'mopix-canvas-empty'},h(Icon,{name:'sliders',size:24}),h('p',null,'Chọn node để chỉnh.'))),
   picker&&h(Picker,{title:'Ảnh cho node',multiple:false,limit:1,onChoose:rows=>update(picker,{asset:rows[0],job:null}),onClose:()=>PICK(null)}));
 };
}
