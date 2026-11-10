'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const RETENTION_MS=24*60*60*1000;
function createImageTrash({db,dataDir,now=()=>Date.now(),isBusy=()=>false}){
 const videos=path.resolve(dataDir,'videos'),disposal=path.join(dataDir,'.image-disposal');
 function managed(url){if(!/^\/videos\/(?:image_|upscale_)[a-zA-Z0-9_.-]+\.(png|jpg|jpeg|webp)$/i.test(url||''))throw Error('Đường dẫn ảnh không hợp lệ');const file=path.join(videos,path.basename(url));if(fs.existsSync(file)&&!fs.realpathSync(file).startsWith(fs.realpathSync(videos)+path.sep))throw Error('File nằm ngoài thư viện ảnh');return file}
 function filesFor(job){const files=new Set();for(const url of [job.video_url,job.upscale_url].filter(Boolean)){const file=managed(url);files.add(file);const sidecar=file+'.ratio.json';if(fs.existsSync(sidecar)){const meta=JSON.parse(fs.readFileSync(sidecar,'utf8'));files.add(sidecar);if(meta.originalUrl)files.add(managed(meta.originalUrl))}}return files}
 function remove(id){
  const job=db.prepare("SELECT * FROM jobs WHERE id=? AND media_type='image'").get(id);
  if(!job)return {missing:true};if(!job.archived_at)throw Error('Chuyển ảnh vào thùng rác trước khi xóa');if(['pending','running'].includes(job.status)||isBusy(id))throw Error('Ảnh đang xử lý, hãy chờ hoàn tất');
  const files=filesFor(job),protectedFiles=new Set();
  for(const other of db.prepare("SELECT * FROM jobs WHERE id<>? AND media_type='image' AND (video_url IS NOT NULL OR upscale_url IS NOT NULL)").all(id))try{for(const file of filesFor(other))protectedFiles.add(file)}catch{}
  for(const ref of db.prepare('SELECT filepath FROM ref_images').all())if(ref.filepath)protectedFiles.add(path.resolve(ref.filepath));
  const staging=path.join(disposal,crypto.randomUUID()),moved=[];let committed=false;
  try{
   fs.mkdirSync(staging,{recursive:true});
   for(const file of files){if(protectedFiles.has(file)||!fs.existsSync(file))continue;const target=path.join(staging,path.basename(file));fs.renameSync(file,target);moved.push([file,target])}
   db.transaction(()=>{const fresh=db.prepare("SELECT archived_at,status FROM jobs WHERE id=? AND media_type='image'").get(id);if(!fresh?.archived_at||['pending','running'].includes(fresh.status))throw Error('Trạng thái ảnh đã thay đổi');db.prepare('DELETE FROM monday_image_catalog WHERE job_id=?').run(id);db.prepare("DELETE FROM jobs WHERE id=? AND media_type='image'").run(id)})();committed=true;
  }catch(error){if(!committed)for(const [file,target]of moved.reverse())if(fs.existsSync(target))fs.renameSync(target,file);throw error}
  finally{if(!committed)try{fs.rmSync(staging,{recursive:true,force:true})}catch{}}
  try{fs.rmSync(staging,{recursive:true,force:true})}catch{}return {deleted:true};
 }
 function clean({expiredOnly=false}={}){const cutoff=new Date(now()-RETENTION_MS).toISOString(),rows=db.prepare("SELECT id FROM jobs WHERE media_type='image' AND archived_at IS NOT NULL AND status NOT IN ('pending','running')"+(expiredOnly?' AND julianday(archived_at)<=julianday(?)':'')+' ORDER BY archived_at,id').all(...(expiredOnly?[cutoff]:[]));let deleted=0;const failed=[];for(const row of rows)try{if(remove(row.id).deleted)deleted++}catch{failed.push(row.id)}return {deleted,failed,retentionHours:24}}
 function stats(){const row=db.prepare("SELECT count(*) AS total FROM jobs WHERE media_type='image' AND archived_at IS NOT NULL").get();return {total:row.total,retentionHours:24}}
 return {remove,clean,stats};
}
module.exports={createImageTrash,RETENTION_MS};
