const legacy=require('./videoProductionSpec.cjs');
const VIDEO_ROLES={...legacy.VIDEO_ROLES,end:'Khung kết thúc',style:'Ánh sáng & phong cách',material:'Chi tiết & chất liệu',reference:'Tham chiếu chung'};
const DURATIONS=[3,5,7,8,10];
function productionInstruction(data){
 const common=legacy.productionInstruction(data).split('\n').slice(2).join('\n');
 const opening=data.storyMode==='text'?'TẠO VIDEO TỪ MÔ TẢ. Không có khung bắt đầu bắt buộc. Dựng đúng chủ thể, hành động, ánh sáng và môi trường trong mô tả.':data.storyMode==='whole'?'DỰNG THEO STORYBOARD: diễn giải các ô theo thứ tự trái sang phải, trên xuống dưới; mỗi thời điểm chỉ một khung video, không quay cả tấm storyboard.':'DỰNG VIDEO TỪ ẢNH. BASE là khung bắt đầu; giữ bố cục, danh tính, hướng nhìn và chất liệu. Không tự ép nhân vật nhìn camera.';
 return [opening,data.hasEndFrame?'Ảnh có vai trò Khung kết thúc là đích cuối cảnh. Nội suy chuyển động liên tục từ BASE tới khung này, giữ nhận diện và vật lý; không hiển thị hai ảnh cạnh nhau.':'',common,'Tham chiếu Ánh sáng & phong cách chỉ quyết định ngôn ngữ chiếu sáng và tông hình; không thay nhân vật hoặc sản phẩm. Tham chiếu Chi tiết & chất liệu chỉ bổ sung texture và chi tiết tương thích; không đổi hình học, trang phục hoặc nhận diện ngoài yêu cầu.','Thời lượng mục tiêu '+data.duration+' giây. Một cảnh chuyển động hoàn chỉnh, không chèn tiêu đề, giao diện hoặc watermark.'].filter(Boolean).join('\n');
}
function buildVideoProduction({mode='image',base,end,storyboard,frames=[],roles={},settings={},make,edge}){
 if(!['image','text','frames','whole','multishot'].includes(mode))throw Error('Chế độ video không hợp lệ');
 const duration=Number(settings.duration||5);
 if(!DURATIONS.includes(duration))throw Error('Chọn thời lượng 3, 5, 7, 8 hoặc 10 giây');
 const shots=['frames','multishot'].includes(mode)?frames.filter(frame=>frame.enabled!==false):[{tag:mode==='whole'?storyboard:mode==='text'?null:base,label:mode==='text'?'Ý tưởng':mode==='whole'?'Storyboard':'Ảnh đầu',width:settings.width,height:settings.height}];
 if(!shots.length||shots.length>12)throw Error('Chọn từ 1 đến 12 cảnh');
 if(mode!=='text'&&shots.some(shot=>!shot.tag))throw Error('Mỗi cảnh cần một ảnh khởi đầu');
 if(mode==='text'&&!String(settings.text||'').trim())throw Error('Nhập mô tả video');
 const ratio=settings.ratio==='auto'||!settings.ratio?legacy.videoRatio(shots[0].width,shots[0].height):settings.ratio;
 if(!['9:16','16:9','1:1'].includes(ratio))throw Error('Tỉ lệ video không hợp lệ');
 if(!Object.hasOwn(legacy.CAMERAS,settings.camera||'still'))throw Error('Máy quay không hợp lệ');
 const nodes=[],edges=[],sources=new Map();
 function source(tag,label){if(!sources.has(tag)){const node=make('source',0,sources.size*240,{refTag:tag,label});sources.set(tag,node);nodes.push(node)}return sources.get(tag)}
 const guides=Object.entries(roles).filter(([role])=>['character','product','background','style','material','reference'].includes(role)).flatMap(([role,tags])=>[...new Set(tags)].filter(Boolean).map(tag=>({role,tag})));
 if(mode==='frames'&&settings.includeBoard&&storyboard)guides.push({role:'storyboard',tag:storyboard});
 const videos=shots.map((shot,index)=>{
  const last=mode==='image'?end:null;
  const aliases=new Map();if(shot.tag)aliases.set(shot.tag.toLowerCase(),'khung bắt đầu');if(last)aliases.set(last.toLowerCase(),'khung kết thúc');for(const [role,tags]of Object.entries(roles))for(const [position,tag]of tags.entries())if(!aliases.has(tag.toLowerCase()))aliases.set(tag.toLowerCase(),(VIDEO_ROLES[role]||'Tham chiếu')+' số '+(position+1));
  const text=([settings.text,shot.motion].filter(Boolean).join('\n')||'Chuyển động tự nhiên theo ảnh khởi đầu.').replace(/@([\p{L}\p{N}_-]+)/gu,(mention,tag)=>aliases.get(tag.toLowerCase())||mention);
  const video=make('video',480,index*360,{videoProduction:true,storyMode:mode==='text'?'text':mode==='whole'?'whole':'frame',sceneIndex:index+1,sceneKey:shot.tag||'text',hasEndFrame:!!last,ratio,duration,camera:settings.camera||'still',motionLevel:settings.motionLevel||'subtle',textureLock:settings.textureLock!==false,pace:settings.pace||'natural',negativeText:String(settings.negativeText||'').slice(0,4000),text,label:'Cảnh '+String(index+1).padStart(2,'0')+' · '+(shot.label||'Video')});
  nodes.push(video);
  if(shot.tag)edges.push(edge(source(shot.tag,shot.label||'Khung đầu'),video));
  for(const guide of [...guides,...(last?[{role:'end',tag:last}]:[])]){if(guide.tag===shot.tag)continue;const connection=edge(source(guide.tag,VIDEO_ROLES[guide.role]),video,'guide');connection.data={...connection.data,role:guide.role};edges.push(connection)}
  return video;
 });
 let final=videos[0];
 if(videos.length>1&&settings.combine!==false){final=make('combine',950,0,{label:'Ghép '+videos.length+' cảnh',ratio,clipCount:videos.length});nodes.push(final);videos.forEach((video,index)=>edges.push(edge(video,final,'clip'+(index+1))))}
 const output=make('output',1380,0,{label:'Video hoàn chỉnh'});nodes.push(output);edges.push(edge(final,output));
 return {reviewBeforeNext:false,nodes,edges,viewport:{x:60,y:70,zoom:.65},production:{version:2,mode,ratio,sceneCount:shots.length,estimatedSeconds:shots.length*duration}};
}
module.exports={...legacy,VIDEO_ROLES,DURATIONS,productionInstruction,buildVideoProduction};
