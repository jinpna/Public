const {VIDEO_ROLES,productionInstruction}=require('./videoProductionV2.cjs');
const {REF_ROLES,settingsErrors,combinedInstruction,negativeInstruction}=require('./combinedEditSpec.cjs');
const {TRANSFERS,TRANSFER_LABELS,transferInstruction}=require('./transferSpec.cjs');
const DECORATIVE=['board','note'];
const TEXT=['prompt','text','table','promptList','joinText','aiPrompt'];
const GENERATORS=['image','clone','outfit','angle','pose','style','material','colorMatch','video','storyboard'];
const LABELS={clone:'Tái hiện theo ảnh mẫu',pickImage:'Chọn ảnh / cảnh',promptList:'List prompt',imageList:'List ảnh',storyboard:'Tạo storyboard',splitStoryboard:'Tách khung storyboard',board:'Board / Khung nhóm',note:'Ghi chú',text:'Văn bản',table:'Bảng dữ liệu',joinText:'Ghép văn bản',aiPrompt:'AI viết prompt',source:'Ảnh nguồn',prompt:'Prompt',image:'Tạo ảnh',outfit:'Thay trang phục',angle:'Đổi góc nhìn',pose:'Tái hiện tư thế',style:'Đồng bộ phong cách',material:'Chuyển chất liệu',colorMatch:'Đồng bộ màu sắc',cutout:'Tách nền',upscale:'Nâng ảnh 4K',video:'Tạo video',videoSource:'Video nguồn',motion:'Motion Control',combine:'Ghép video',delay:'Chờ',download:'Lưu kết quả',output:'Kết quả'};
const TYPES=Object.keys(LABELS);
function validOutputShape(out){return !!out&&['text','image','video'].includes(out.mediaType)&&(out.mediaType==='text'?typeof out.text==='string':typeof out.url==='string'&&/^\/(uploads|videos)\/[\w.-]+$/.test(out.url))&&(!out.items||Array.isArray(out.items)&&out.items.every(i=>!i.items&&validOutputShape(i)))}
function validateGraph(graph,{ready=false,cachedIds=[]}={}){
 const errors=[];
 if(!graph||!Array.isArray(graph.nodes)||!Array.isArray(graph.edges))return ['Workflow không hợp lệ'];
 const {nodes,edges}=graph,byId=new Map(),incoming=new Map(),outgoing=new Map(),degree=new Map();
 if(!nodes.length)return ['Thêm ít nhất một node'];
 for(const n of nodes){
  if(!n||typeof n.id!=='string'||!n.id||n.id.length>100||byId.has(n.id)||!n.data||!TYPES.includes(n.data.kind)||!Number.isFinite(n.position?.x)||!Number.isFinite(n.position?.y))return ['Cấu trúc hoặc ID node không hợp lệ'];
  if(['text','label','refTag','ratio','pitch','framing','assetId','color','format','separator'].some(k=>n.data[k]!==undefined&&typeof n.data[k]!=='string'))return ['Thiết lập node phải là văn bản hợp lệ'];
  if(n.data.videoProduction!==undefined&&(typeof n.data.videoProduction!=='boolean'||n.data.videoProduction&&n.data.kind!=='video'))return ['Thiết lập dựng video không hợp lệ'];
  if(n.data.multiEdit!==undefined&&typeof n.data.multiEdit!=='boolean')return ['Thiết lập chỉnh kết hợp không hợp lệ'];
  if(n.data.multiEdit){if(n.data.kind!=='image')return ['Chỉnh kết hợp dùng node tạo ảnh'];const editErrors=settingsErrors(n.data);if(editErrors.length)return editErrors;}
  if(GENERATORS.includes(n.data.kind)&&String(n.data.text||'').length>20000)return ['Prompt tạo ảnh/video tối đa 20.000 ký tự'];
  if(TRANSFERS.includes(n.data.kind)){const d=n.data;if(d.fidelity!==undefined&&!['strict','balanced','creative'].includes(d.fidelity))return ['Mức tham chiếu không hợp lệ'];if(['copyCamera','copyExpression','referenceColors','copyPose','copyStyle','copyOutfit','copyBackground','autoRatio'].some(k=>d[k]!==undefined&&typeof d[k]!=='boolean'))return ['Tùy chọn tham chiếu không hợp lệ'];if(d.transferTarget!==undefined&&(typeof d.transferTarget!=='string'||d.transferTarget.length>1000))return ['Vùng chỉnh sửa tối đa 1.000 ký tự'];if(d.colorMode!==undefined&&!['reference','custom'].includes(d.colorMode))return ['Nguồn màu không hợp lệ'];if(d.targetColor!==undefined&&(typeof d.targetColor!=='string'||!/^#[0-9a-f]{6}$/i.test(d.targetColor)))return ['Màu đích phải có dạng #RRGGBB'];}
  if(n.data.kind==='motion'&&n.data.characterOrientation!==undefined&&!['image','video'].includes(n.data.characterOrientation))return ['Chế độ hướng chuyển động không hợp lệ'];
  if(n.data.savedOutput&&!validOutputShape(n.data.savedOutput))return ['Kết quả gắn sẵn không hợp lệ hoặc trỏ ra ngoài thư viện trên máy'];
  if(n.data.refTags!==undefined&&(!Array.isArray(n.data.refTags)||n.data.refTags.some(t=>typeof t!=='string'||t.length>200)))return ['List ảnh không hợp lệ'];
  if(n.data.rows!==undefined&&(!Array.isArray(n.data.rows)||n.data.rows.some(r=>!Array.isArray(r)||r.some(c=>typeof c!=='string'))))return ['Các ô trong bảng phải là văn bản'];
  if(n.style&&Object.keys(n.style).some(k=>!['width','height'].includes(k)))return ['Style node chỉ hỗ trợ chiều rộng và chiều cao'];
  if(n.style&&['width','height'].some(k=>n.style[k]!==undefined&&(!Number.isFinite(n.style[k])||n.style[k]<80)))return ['Kích thước node không hợp lệ'];
  byId.set(n.id,n);incoming.set(n.id,[]);outgoing.set(n.id,[]);degree.set(n.id,0);
 }
 for(const n of nodes)if(n.parentId){if(byId.get(n.parentId)?.data.kind!=='board'||n.parentId===n.id)return ['Board cha không hợp lệ'];const trail=new Set([n.id]);let parent=n.parentId;while(parent){if(trail.has(parent))return ['Board không được lồng thành vòng lặp'];trail.add(parent);parent=byId.get(parent)?.parentId}}
 const edgeIds=new Set();
 for(const e of edges){if(!e||typeof e.id!=='string'||edgeIds.has(e.id)||!byId.has(e.source)||!byId.has(e.target)||e.source===e.target)return ['Kết nối thiếu node, bị trùng hoặc nối vào chính nó'];edgeIds.add(e.id);incoming.get(e.target).push(e);outgoing.get(e.source).push(e);degree.set(e.target,degree.get(e.target)+1)}
 const queue=nodes.filter(n=>degree.get(n.id)===0).map(n=>n.id),types=new Map();let head=0;
 while(head<queue.length){const id=queue[head++],node=byId.get(id),kind=node.data.kind,ins=incoming.get(id);let type=TEXT.includes(kind)?'text':['video','videoSource','motion','combine'].includes(kind)?'video':DECORATIVE.includes(kind)?'none':'image';if(['delay','output','download'].includes(kind))type=types.get(ins.find(e=>e.data?.enabled!==false)?.source)||'any';types.set(id,type);for(const e of outgoing.get(id)){degree.set(e.target,degree.get(e.target)-1);if(!degree.get(e.target))queue.push(e.target)}}
 if(head!==nodes.length)return ['Workflow có vòng lặp'];
 for(const e of edges){const a=byId.get(e.source),b=byId.get(e.target),ak=a.data.kind,bk=b.data.kind,h=e.targetHandle||'base',type=types.get(a.id);
  if(DECORATIVE.includes(ak)||DECORATIVE.includes(bk)||['source','videoSource','prompt','text','table'].includes(bk)||['output','download'].includes(ak)){errors.push('Board/ghi chú không chạy; nguồn không nhận dây; kết quả là cổng cuối');continue}
  if(['joinText','aiPrompt','promptList'].includes(bk)){if(h!=='prompt'||type!=='text')errors.push('Cổng văn bản chỉ nhận Text, Prompt, Bảng hoặc AI viết prompt');continue}
  if(['delay','output','download'].includes(bk)){if(h!=='base')errors.push('Nối vào cổng Đầu vào / Kết quả');continue}
  if(bk==='combine'){if(!/^clip[1-9]\d*$/.test(h)||type!=='video')errors.push('Ghép video chỉ nhận video tại các cổng Clip có số thứ tự');continue}
  if(h==='prompt'){if(type!=='text'||['cutout','upscale','pickImage','splitStoryboard'].includes(bk))errors.push('Cổng Prompt chỉ nhận văn bản');continue}
  if(h==='motion'){if(bk!=='motion'||type!=='video')errors.push('Cổng Chuyển động chỉ nhận video');continue}
  if(h==='guide'){if(ready&&b.data.videoProduction&&!Object.hasOwn(VIDEO_ROLES,e.data?.role||''))errors.push('Gán vai trò cho từng ảnh tham chiếu video');if(ready&&b.data.multiEdit&&!Object.hasOwn(REF_ROLES,e.data?.role||''))errors.push('Gán vai trò cho từng dây Guide của Chỉnh kết hợp');if(type!=='image'||!['image','clone','outfit','pose','style','material','colorMatch','storyboard','video'].includes(bk))errors.push('Cổng hướng dẫn cần ảnh');continue}
  if(h!=='base'||type!=='image')errors.push('Cổng chủ thể chỉ nhận ảnh; nối văn bản vào Prompt');
 }
 for(const n of nodes){const kind=n.data.kind,ins=incoming.get(n.id).filter(e=>e.data?.enabled!==false),ports=new Map();for(const e of ins){const h=e.targetHandle||'base';ports.set(h,(ports.get(h)||0)+1)}for(const[h,count]of ports)if(ready&&count>(h==='guide'?Infinity:h==='prompt'||kind==='imageList'?Infinity:1))errors.push(`${LABELS[kind]}: cổng ${h} đã đầy`);
  if(!ready||cachedIds.includes(n.id))continue;
  if(kind==='source'&&!n.data.refTag)errors.push('Chọn ảnh nguồn');if(kind==='videoSource'&&!n.data.assetId)errors.push('Chọn video nguồn');
  if(['prompt','text'].includes(kind)&&!n.data.text?.trim())errors.push(`${LABELS[kind]} chưa có nội dung`);
  if(kind==='table'&&!n.data.rows?.some(r=>r.some(c=>c.trim())))errors.push('Bảng dữ liệu chưa có nội dung');
  if(kind==='imageList'&&!n.data.refTags?.length&&!ins.length)errors.push('List ảnh cần ảnh hoặc đầu vào');
  if(kind==='promptList'&&!n.data.text?.trim()&&!ports.has('prompt'))errors.push('List prompt cần nội dung');
  if(['storyboard','splitStoryboard'].includes(kind)&&(!Number.isInteger(n.data.columns??3)||!Number.isInteger(n.data.rowsCount??2)||(n.data.columns??3)<1||(n.data.columns??3)>8||(n.data.rowsCount??2)<1||(n.data.rowsCount??2)>8))errors.push('Lưới storyboard: mỗi chiều từ 1 đến 8 ô');
  if(kind==='aiPrompt'&&!n.data.text?.trim()&&!ports.has('prompt'))errors.push('AI viết prompt cần yêu cầu đầu vào');
  if(kind==='joinText'&&!ins.length&&!n.data.text?.trim())errors.push('Ghép văn bản cần đầu vào hoặc nội dung');
  if(['outfit','clone','angle','pose','style','material','colorMatch','cutout','upscale','output','download','delay','motion','splitStoryboard','pickImage'].includes(kind)&&!ports.has('base'))errors.push(`${LABELS[kind]} cần đầu vào`);
  if(kind==='pickImage'&&(!Number.isInteger(n.data.frameIndex??1)||(n.data.frameIndex??1)<1))errors.push('Số thứ tự ảnh/cảnh phải là số nguyên từ 1');
  if(kind==='motion'&&!ports.has('motion'))errors.push('Motion Control cần video chuyển động');if(kind==='combine'&&ins.length<2)errors.push('Ghép video cần ít nhất hai clip');
  if(['pose','clone','style','material','colorMatch'].includes(kind)&&!(kind==='colorMatch'&&n.data.colorMode==='custom')&&!ports.has('guide'))errors.push(`${LABELS[kind]} cần ảnh mẫu`);if(kind==='outfit'&&!ports.has('guide')&&!n.data.text?.trim())errors.push('Thêm ảnh hoặc mô tả trang phục');
  if(n.data.multiEdit){const roleSet=new Set(ins.filter(e=>e.targetHandle==='guide').map(e=>e.data?.role));for(const [role,enabled]of [['material',n.data.editMaterial],['accessory',n.data.editAccessory],['outfit',n.data.editOutfit],['pose',n.data.editPose||n.data.editCamera||n.data.editExpression],['color',n.data.editColor],['style',n.data.editStyle],['background',n.data.editBackground]])if(enabled&&!roleSet.has(role)&&!n.data.text?.trim())errors.push('Thêm ảnh ref cho '+REF_ROLES[role]);if(!ports.has('base'))errors.push('Chỉnh kết hợp cần ảnh MASTER');}
  if(['image','video','storyboard'].includes(kind)&&!n.data.multiEdit&&!n.data.text?.trim()&&!ports.has('prompt'))errors.push(`${LABELS[kind]} cần prompt`);
  if(kind==='angle'&&(!Number.isFinite(Number(n.data.yaw??45))||Math.abs(Number(n.data.yaw??45))>180))errors.push('Góc từ -180 đến 180 độ');
  if(kind==='video'&&![3,5,7,8,10,15].includes(Number(n.data.duration||10)))errors.push('Video hỗ trợ 3, 5, 7, 8 hoặc 10 giây');
  if(kind==='delay'&&(!Number.isFinite(Number(n.data.seconds??5))||Number(n.data.seconds??5)<0))errors.push('Thời gian chờ phải từ 0 giây');
  if(GENERATORS.includes(kind)&&!(kind==='video'?['9:16','16:9','1:1']:['1:1','9:16','16:9','4:3','3:4']).includes(n.data.ratio||'1:1'))errors.push('Tỉ lệ không được model hỗ trợ');
 }
 return [...new Set(errors)]
}
function compileNode(node,inputs){const d=node.data,kind=d.kind;const label={base:d.videoProduction?(d.storyMode==='whole'?'Storyboard tổng thể; quyết định thứ tự cảnh':'Khung khởi đầu; quyết định bố cục, góc máy và hướng chủ thể'):'Ảnh chủ thể gốc; quyết định danh tính và các chi tiết cần giữ',guide:TRANSFERS.includes(kind)?`Ảnh ${TRANSFER_LABELS[kind]}; chỉ chuyển thuộc tính của chế độ ${kind}, không lấy danh tính hay nội dung ngoài phạm vi đã chọn`:'Ảnh hướng dẫn sáng tạo, áp dụng theo yêu cầu prompt'};const tags=[],parts=[];for(const h of ['base','guide'])for(const tag of inputs[h]?.refTags||[]){if(!tags.includes(tag)){tags.push(tag);parts.push(`Ảnh ${tags.length} @${tag}: ${label[h]}.`)}}
for(const tag of inputs.base?.anchorTags||[]){if(!tags.includes(tag)){tags.push(tag);parts.push(`Ảnh ${tags.length} @${tag}: mốc gốc để đối chiếu danh tính/khuôn mặt và các đặc điểm cố định; không ghi đè trang phục, dáng hoặc góc đã được thay đổi có chủ đích ở bước trước.`)}}
let instruction=kind==='outfit'?'Thay trang phục của chủ thể trong ảnh gốc theo ảnh trang phục/mô tả. Giữ nguyên khuôn mặt, danh tính, tóc, dáng người, tư thế, bối cảnh và ánh sáng; chỉ thay quần áo, phối đồ khớp tự nhiên.':kind==='pose'?'Tạo lại chủ thể của ảnh gốc với tư thế và bố cục từ ảnh mẫu dáng. Giữ danh tính, khuôn mặt, tóc và trang phục của ảnh gốc. Chỉ chuyển tư thế cơ thể, hướng tay chân; không sao chép danh tính người mẫu dáng.':kind==='angle'?`Tái tạo cùng chủ thể từ góc nhìn mới: góc ngang ${Number(d.yaw)||0} độ, máy ${d.pitch==='high'?'từ trên xuống':d.pitch==='low'?'từ dưới lên':'ngang mắt'}, khung ${d.framing==='close'?'cận cảnh':d.framing==='full'?'toàn thân':'trung cảnh'}. Giữ danh tính, trang phục, chất liệu, bối cảnh và ánh sáng; bố cục nhất quán. Đây là suy diễn góc mới từ ảnh tham chiếu.`:kind==='video'?'Tạo video có chuyển động tự nhiên. Giữ nhất quán danh tính, trang phục, màu sắc, sản phẩm và bối cảnh của ảnh tham chiếu trong toàn bộ cảnh.':'Tạo một ảnh nhất quán theo prompt và ảnh tham chiếu.';
if(d.videoProduction)instruction=productionInstruction(d);
if(d.multiEdit)instruction=combinedInstruction(d);
if(TRANSFERS.includes(kind))instruction=transferInstruction(d);
if(kind==='storyboard')instruction+=` Tạo một storyboard dạng lưới chính xác ${d.columns||3} cột × ${d.rowsCount||2} hàng, tổng ${(d.columns||3)*(d.rowsCount||2)} khung. Các ô bằng nhau, không khoảng cách, không viền, không chữ. Cảnh đi từ trái sang phải, trên xuống dưới, giữ cùng chủ thể, thiết kế, chất liệu và màu sắc theo ảnh nguồn.`;
return {prompt:[instruction,inputs.guide?.text||'',...((d.multiEdit||d.videoProduction)?(inputs.guide?.roleRefs||[]).map(r=>'Ref @'+r.tag+(r.cell?' ô '+r.cell:'')+' → '+((d.videoProduction?VIDEO_ROLES:REF_ROLES)[r.role]||'Chưa gán vai trò')):[]),...parts,inputs.prompt?.text||'',d.text||'',d.multiEdit&&negativeInstruction(d)?'NEGATIVE / TRÁNH: '+negativeInstruction(d):''].filter(Boolean).join('\n\n'),refTags:tags,mediaType:kind==='video'?'video':'image',ratio:d.ratio||'1:1',duration:Number(d.duration)||10}}
function parseDelimited(text,separator=','){text=String(text).replace(/^\uFEFF/,'');const rows=[];let row=[],cell='',quoted=false;for(let i=0;i<text.length;i++){const c=text[i];if(quoted){if(c==='"'&&text[i+1]==='"'){cell+='"';i++}else if(c==='"')quoted=false;else cell+=c}else if(c==='"'&&!cell)quoted=true;else if(c===separator){row.push(cell);cell=''}else if(c==='\n'||c==='\r'){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);rows.push(row);row=[];cell=''}else cell+=c}if(quoted)throw Error('Bảng CSV thiếu dấu ngoặc kép đóng');if(cell||row.length||!rows.length){row.push(cell);rows.push(row)}return rows}
function parsePromptList(text){text=String(text||'').trim();try{const v=JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g,''));if(Array.isArray(v))return v.map(x=>typeof x==='string'?x:x&&typeof x==='object'?String(x.prompt||x.description||''):'').filter(x=>x.trim())}catch{}return text.split(/\n\s*\n|\n(?=\s*(?:[-*•]|\d+[.)]))/).flatMap(p=>p.includes('\n')&&!/\n\s*\n/.test(text)?p.split('\n'):[p]).map(p=>p.replace(/^\s*(?:[-*•]|\d+[.)])\s*/,'').trim()).filter(Boolean)}
module.exports={parsePromptList,parseDelimited,TYPES,LABELS,DECORATIVE,TEXT,GENERATORS,validateGraph,compileNode};
