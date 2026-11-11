'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const PROVIDER='https://upscale-api.kylenguyen.me';
function createUpscaleService({db,dataDir,sharp,fetchImpl=fetch,notify=()=>{},wait=ms=>new Promise(r=>setTimeout(r,ms))}){
 db.exec('CREATE TABLE IF NOT EXISTS mopix_upscales(id TEXT PRIMARY KEY,payload TEXT NOT NULL)');
 const hidden=new Set(db.prepare('SELECT payload FROM mopix_upscales').all().map(r=>JSON.parse(r.payload)).filter(p=>p.hidden).map(p=>p.id));
 const dir=path.join(dataDir,'videos');fs.mkdirSync(dir,{recursive:true});const active=new Map();
 const identityFile=path.join(dataDir,'mopix-upscale-client-id');let clientId;try{clientId=fs.readFileSync(identityFile,'utf8').trim()}catch{}if(!/^[a-f0-9-]{36}$/.test(clientId||'')){clientId=crypto.randomUUID();fs.writeFileSync(identityFile,clientId,{mode:0o600})}
 const save=p=>{if(hidden.has(p.id))p.hidden=true;else delete p.hidden;p.updatedAt=new Date().toISOString();db.prepare('INSERT OR REPLACE INTO mopix_upscales VALUES(?,?)').run(p.id,JSON.stringify(p));notify(p);return p};
 const get=id=>{const r=db.prepare('SELECT payload FROM mopix_upscales WHERE id=?').get(id);return r?JSON.parse(r.payload):null};
 const headers={'X-Client-Id':clientId};
 async function json(response){let d;try{d=await response.json()}catch{throw Error('Dịch vụ 4K trả phản hồi không hợp lệ.')}if(!response.ok)throw Error(d.error||'Dịch vụ 4K chưa sẵn sàng ('+response.status+').');return d}
 async function process(p,buffer,mime,name){
  try{
   if(!p.remoteId){const d=await json(await fetchImpl(PROVIDER+'/api/v1/upscale',{method:'POST',headers:{...headers,'Content-Type':mime,'X-File-Name':encodeURIComponent(name)},body:buffer,signal:AbortSignal.timeout(60000)}));if(!d.jobId)throw Error('Dịch vụ 4K chưa cấp mã tác vụ.');p.remoteId=String(d.jobId);save(p)}
   for(let i=0;i<600;i++){
    const r=await json(await fetchImpl(PROVIDER+'/api/v1/jobs/'+encodeURIComponent(p.remoteId),{headers,signal:AbortSignal.timeout(30000)}));
    if(r.status==='error')throw Error(r.error||'Không upscale được ảnh.');
    if(r.status==='done'&&r.resultPath){const u=new URL(r.resultPath,PROVIDER);if(u.origin!==PROVIDER)throw Error('Địa chỉ kết quả 4K không hợp lệ.');p.phase='Đang lưu ảnh 4K';p.progress=99;save(p);
     const result=await fetchImpl(u,{headers,signal:AbortSignal.timeout(120000)});if(!result.ok)throw Error('Không tải được ảnh 4K.');const raw=Buffer.from(await result.arrayBuffer());if(raw.length>100*1024*1024)throw Error('Ảnh kết quả quá lớn.');const image=sharp(raw,{limitInputPixels:100000000});const meta=await image.metadata();if(!meta.width||!meta.height)throw Error('Kết quả 4K không phải ảnh hợp lệ.');
     const filename='upscale_'+p.id+'.png';await image.png().toFile(path.join(dir,filename));p.url='/videos/'+filename;p.width=meta.width;p.height=meta.height;p.status='completed';p.phase='Upscale 4K hoàn tất';p.progress=100;
     const resultId='mopix_image_'+p.id;db.prepare("INSERT OR IGNORE INTO jobs(id,prompt,ref_tags,media_type,status,progress,duration,ratio,attempts,max_retries,timeout_minutes,sort_order,created_at,finished_at,video_url,thumbnail_url) VALUES(?,?,?,'image','completed',100,0,?,0,0,3,0,datetime('now'),datetime('now'),?,?)").run(resultId,'Upscale 4K · '+p.name,JSON.stringify(p.tag?[p.tag]:[]),p.width+':'+p.height,p.url,p.url);
     const upscale={id:p.id,sourceJobId:p.sourceJobId,beforeUrl:p.beforeUrl,afterUrl:p.url,width:p.width,height:p.height};let ctx={};if(p.sourceJobId){try{ctx=JSON.parse(db.prepare('SELECT payload FROM job_context WHERE job_id=?').get(p.sourceJobId)?.payload||'{}')}catch{}db.prepare('UPDATE jobs SET upscale_url=?,upscale_width=?,upscale_height=? WHERE id=?').run(p.url,p.width,p.height,p.sourceJobId);db.prepare('INSERT OR REPLACE INTO job_context VALUES(?,?)').run(p.sourceJobId,JSON.stringify({...ctx,upscale}))}db.prepare('INSERT OR REPLACE INTO job_context VALUES(?,?)').run(resultId,JSON.stringify({...ctx,prompt:'Upscale 4K · '+p.name,upscale}));p.resultJobId=resultId;save(p);return p;
    }
    p.progress=Math.max(1,Math.min(98,Number(r.progress)||1));p.phase=r.status==='queued'?'Đang chờ xử lý':'Đang nâng độ phân giải';if(r.queuePosition)p.phase+=' · vị trí '+r.queuePosition;save(p);await wait(2000)
   }
   throw Error('Dịch vụ xử lý lâu hơn dự kiến. Kiểm tra lại trạng thái sau.');
  }catch(e){p.status=p.remoteId?'interrupted':'failed';p.error=String(e.message||'Không upscale được ảnh.').slice(0,300);save(p)}finally{active.delete(p.id)}return p;
 }
 async function start({buffer,mime,name='Ảnh',tag=null,sourceJobId=null,beforeUrl}){
  if(!Buffer.isBuffer(buffer)||buffer.length<16||buffer.length>32*1024*1024)throw Error('Chọn ảnh PNG, JPG hoặc WebP tối đa 32 MB.');
  const meta=await sharp(buffer,{limitInputPixels:100000000}).metadata();if(!['png','jpeg','webp'].includes(meta.format))throw Error('Chỉ hỗ trợ PNG, JPG và WebP.');mime={png:'image/png',jpeg:'image/jpeg',webp:'image/webp'}[meta.format];
  const hash=crypto.createHash('sha256').update(buffer).digest('hex');const old=db.prepare('SELECT payload FROM mopix_upscales ORDER BY rowid DESC LIMIT 100').all().map(r=>JSON.parse(r.payload)).find(r=>r.hash===hash&&r.status==='running');if(old){hidden.delete(old.id);return save(old)}
  const p=save({id:'mopix_'+crypto.randomUUID(),hash,name,tag,sourceJobId,beforeUrl,status:'running',phase:'Đang gửi ảnh',progress:1,createdAt:new Date().toISOString()});active.set(p.id,process(p,buffer,mime,name));return p;
 }
 function resume(id){const p=get(id);if(!p?.remoteId)throw Error('Không có tác vụ 4K để tiếp tục kiểm tra.');if(!active.has(id)){p.status='running';delete p.error;save(p);active.set(id,process(p))}return p}
 for(const row of db.prepare('SELECT payload FROM mopix_upscales').all()){const p=JSON.parse(row.payload);if(p.status==='running'){p.status='interrupted';p.error='App đã đóng khi xử lý. Bấm Kiểm tra lại để tiếp tục tác vụ cũ.';save(p)}}
 function hide(id){const p=get(id);if(p){hidden.add(id);save(p)}return p}
 return {start,get,resume,hide,active};
}
module.exports={createUpscaleService,PROVIDER};
