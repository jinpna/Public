'use strict';
const express=require('express'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const sharp=require('../../../vendor/upscale/node_modules/sharp');
const {listRefs}=require('../referenceLibrary');
const {db}=require('../db'),{DATA_DIR}=require('../paths'),{broadcast}=require('../ws');
sharp.cache({memory:64,files:0,items:16});
const router=express.Router(),pending=new Map();
const videos=path.join(DATA_DIR,'videos'),uploads=path.join(DATA_DIR,'uploads');
fs.mkdirSync(videos,{recursive:true});fs.mkdirSync(uploads,{recursive:true});
function managedFile(url){if(!/^\/videos\/(?:image_|upscale_)[a-zA-Z0-9_.-]+\.(png|jpg|jpeg|webp)$/i.test(url||''))throw Error('Đường dẫn ảnh không hợp lệ');const file=path.join(videos,path.basename(url));if(!fs.existsSync(file))throw Error('File ảnh đã mất trên máy');const real=fs.realpathSync(file);if(!real.startsWith(fs.realpathSync(videos)+path.sep))throw Error('File nằm ngoài thư viện ảnh');return real}
function jobFor(id){return db.prepare("SELECT * FROM jobs WHERE id = ? AND media_type = 'image'").get(id)}
router.use((req,res,next)=>{const remote=req.socket.remoteAddress||'',origin=req.get('origin');const port=String(process.env.PORT||3001);const origins=['http://localhost:'+port,'http://127.0.0.1:'+port];if(process.env.MUSE_STAGING_PORT)origins.push('http://localhost:'+process.env.MUSE_STAGING_PORT);if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(remote)||(origin&&!origins.includes(origin)))return res.status(403).json({error:'Chỉ thao tác trong ứng dụng trên máy này'});next()});

db.exec('CREATE TABLE IF NOT EXISTS monday_image_catalog(job_id TEXT PRIMARY KEY,category TEXT NOT NULL,hashtags TEXT NOT NULL,updated_at TEXT NOT NULL)');
router.get('/catalog',(_,res)=>res.json(db.prepare('SELECT * FROM monday_image_catalog').all().map(r=>({...r,hashtags:JSON.parse(r.hashtags)}))));
router.put('/:id/catalog',(req,res)=>{if(!jobFor(req.params.id))return res.status(404).json({error:'Không tìm thấy ảnh'});const category=String(req.body.category||'image');if(!['image','character','props'].includes(category))return res.status(400).json({error:'Nhóm ảnh không hợp lệ'});const hashtags=[...new Set((Array.isArray(req.body.hashtags)?req.body.hashtags:[]).map(t=>String(t).replace(/^#+/,'').trim().toLowerCase()).filter(t=>/^[\p{L}\p{N}_-]{1,40}$/u.test(t)))].slice(0,20);db.prepare("INSERT INTO monday_image_catalog VALUES(?,?,?,datetime('now')) ON CONFLICT(job_id) DO UPDATE SET category=excluded.category,hashtags=excluded.hashtags,updated_at=excluded.updated_at").run(req.params.id,category,JSON.stringify(hashtags));res.json({job_id:req.params.id,category,hashtags})});
router.get('/:id/ratio',(req,res)=>{const job=jobFor(req.params.id);if(!job?.video_url)return res.status(404).json({error:'Chưa có ảnh'});try{const file=managedFile(job.video_url),meta=fs.existsSync(file+'.ratio.json')?JSON.parse(fs.readFileSync(file+'.ratio.json','utf8')):{adjusted:false};res.json(meta)}catch(e){res.status(422).json({error:e.message})}});
router.get('/:id/download',async(req,res)=>{
    const job=jobFor(req.params.id);
    if(!job||job.status!=='completed')return res.status(404).json({error:'Không tìm thấy ảnh đã hoàn tất'});
    const format=String(req.query.format||'png').toLowerCase();
    if(!['png','jpg','original'].includes(format))return res.status(400).json({error:'Chỉ hỗ trợ tải PNG hoặc JPG'});
    const fourK=req.query.version==='4k';
    if(fourK&&!job.upscale_url)return res.status(409).json({error:'Tạo bản 4K trước khi tải'});
    try{
        if(format==='original'){const file=managedFile(job.video_url),meta=fs.existsSync(file+'.ratio.json')?JSON.parse(fs.readFileSync(file+'.ratio.json','utf8')):null;return res.download(meta?.originalUrl?managedFile(meta.originalUrl):file)}const quality=null;
        const source=managedFile(quality?quality.url:fourK?job.upscale_url:job.video_url);
        let image=sharp(source,{limitInputPixels:50_000_000}).rotate().toColourspace('srgb');
        image=format==='jpg'?image.flatten({background:'#ffffff'}).jpeg({quality:95,chromaSubsampling:'4:4:4'}):image.png({compressionLevel:6});
        const buffer=await image.toBuffer();
        const slug=String(job.prompt||'image').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,48)||'image';const name='Monday_'+String(job.created_at||'').slice(0,10)+'_'+slug+'_'+job.id.slice(-8)+(fourK?'_4K':quality?'_2K':'_Original')+'.'+format;
        res.set('Content-Disposition','attachment; filename="'+name+'"');res.set('X-Content-Type-Options','nosniff');
        res.type(format==='jpg'?'image/jpeg':'image/png');return res.send(buffer);
    }catch(e){return res.status(422).json({error:e.message||'Không chuyển được định dạng ảnh'})}
});
router.post('/upscale-reference',async(req,res)=>{try{const tag=String(req.body?.tag||''),ref=listRefs().find(r=>r.tag===tag);if(!ref)throw Error('Chọn ảnh nguồn trong thư viện');const row=db.prepare('SELECT filepath FROM ref_images WHERE tag=? AND archived_at IS NULL').get(tag);if(!row?.filepath||!fs.existsSync(row.filepath))throw Error('Ảnh nguồn không còn trên máy');const real=fs.realpathSync(row.filepath);if(!real.startsWith(fs.realpathSync(uploads)+path.sep))throw Error('Ảnh nằm ngoài thư viện');const output=path.join(videos,'upscale_ref_'+crypto.createHash('sha256').update(tag+fs.statSync(real).mtimeMs).digest('hex').slice(0,24)+'_4k.png');const result=await require('../upscaleLocal.cjs').upscale(real,output);res.json(result)}catch(e){res.status(422).json({error:e.message})}});
router.post('/:id/upscale',async(req,res)=>{try{const job=jobFor(req.params.id);if(!job||job.status!=='completed'||job.archived_at)throw Error('Chọn kết quả ảnh đã hoàn tất');const result=await require('../upscaleLocal.cjs').upscale(managedFile(job.video_url),path.join(videos,'upscale_'+job.id+'_4k.png'));db.prepare('UPDATE jobs SET upscale_url=?,upscale_width=?,upscale_height=? WHERE id=?').run(result.url,result.width,result.height,job.id);res.json(result)}catch(e){res.status(422).json({error:e.message})}});
router.post('/:id/reference',async(req,res)=>{const job=jobFor(req.params.id);if(!job||job.status!=='completed'||job.archived_at)return res.status(404).json({error:'Ảnh không có trong thư viện'});try{const source=managedFile(job.video_url),id=crypto.randomUUID(),tag='created_'+job.id;let ref=db.prepare('SELECT * FROM ref_images WHERE tag = ?').get(tag);if(!ref||!fs.existsSync(ref.filepath)){const ext=path.extname(source).toLowerCase(),filename='ref_'+id+ext,target=path.join(uploads,filename);fs.copyFileSync(source,target);const mime=ext==='.png'?'image/png':ext==='.webp'?'image/webp':'image/jpeg';if(ref){db.prepare('UPDATE ref_images SET filename=?, filepath=?, size=?, mime_type=? WHERE id=?').run(filename,target,fs.statSync(target).size,mime,ref.id)}else db.prepare("INSERT INTO ref_images (id,tag,filename,filepath,size,mime_type,created_at) VALUES (?,?,?,?,?,?,datetime('now'))").run(id,tag,filename,target,fs.statSync(target).size,mime);ref=db.prepare('SELECT * FROM ref_images WHERE tag = ?').get(tag)}db.prepare('UPDATE ref_images SET archived_at=NULL WHERE tag=?').run(tag);const all=listRefs();broadcast('REFS_UPDATED',all);res.json({success:true,reference:all.find(r=>r.tag===tag)})}catch(e){res.status(422).json({error:e.message||'Không lưu được ảnh tham chiếu'})}});
const imageTrash=require('../imageTrashRuntime.cjs');
router.get('/trash',(_req,res)=>res.json(imageTrash.stats()));
router.delete('/trash',(req,res)=>{if(req.body?.confirm!==true)return res.status(409).json({error:'Xác nhận trước khi dọn sạch thùng rác'});try{const result=imageTrash.clean();res.json({...result,...imageTrash.stats()})}catch(error){res.status(500).json({error:'Chưa dọn được thùng rác. Hãy thử lại.'})}});
// Library trash: validate each item, retain files still referenced elsewhere.
router.delete('/trash/library',(req,res)=>{
 if(req.body?.confirm!==true)return res.status(409).json({error:'Cần xác nhận xóa vĩnh viễn.'});
 if(db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE status IN ('pending','running')").get().n)return res.status(409).json({error:'Có tác vụ đang xử lý. Hãy dừng hoặc chờ xong trước khi dọn thùng rác.'});
 const items=Array.isArray(req.body.items)?req.body.items:[...db.prepare('SELECT id, tag FROM ref_images WHERE archived_at IS NOT NULL AND COALESCE(internal_only,0)=0').all().map(r=>({...r,source:'ref'})),...db.prepare('SELECT id FROM jobs WHERE archived_at IS NOT NULL').all().map(r=>({...r,source:'job'}))];
 let removed=0;const failed=[];
 for(const item of items){try{
  if(item.source==='job'){
   const row=db.prepare('SELECT * FROM jobs WHERE id=? AND archived_at IS NOT NULL').get(String(item.id));if(!row)throw Error('Mục không còn ở thùng rác');
   if(row.media_type==='image'){imageTrash.remove(row.id);removed++;continue}
   cleanFiles([row.video_url,row.thumbnail_url],row.id,null);db.prepare('DELETE FROM jobs WHERE id=? AND archived_at IS NOT NULL').run(row.id);
  }else if(item.source==='ref'){
   const row=db.prepare('SELECT * FROM ref_images WHERE tag=? AND archived_at IS NOT NULL AND COALESCE(internal_only,0)=0').get(String(item.tag));if(!row)throw Error('Mục không còn ở thùng rác');
   cleanFiles([row.filepath],null,row.id);db.prepare('DELETE FROM ref_images WHERE id=? AND archived_at IS NOT NULL').run(row.id);
  }else throw Error('Loại mục không hợp lệ');removed++;
 }catch(error){failed.push({id:item.id,error:error.message})}}
 broadcast('REFS_UPDATED',listRefs());res.json({removed,failed});
});
function cleanFiles(values,jobId,refId){
 const base=path.resolve(DATA_DIR),normalize=value=>{if(!value)return null;const file=value.startsWith('/videos/')||value.startsWith('/uploads/')?path.resolve(base,'.'+value):path.resolve(value);if(![path.join(base,'videos')+path.sep,path.join(base,'uploads')+path.sep].some(dir=>file.startsWith(dir)))throw Error('File không thuộc thư viện');if(fs.existsSync(file)&&![path.join(fs.realpathSync(base),'videos')+path.sep,path.join(fs.realpathSync(base),'uploads')+path.sep].some(dir=>fs.realpathSync(file).startsWith(dir)))throw Error('Không xóa liên kết ngoài thư viện');return file};
 const protectedFiles=new Set();for(const row of db.prepare('SELECT id,filepath FROM ref_images').all())if(row.id!==refId)try{protectedFiles.add(normalize(row.filepath))}catch{}
 for(const row of db.prepare('SELECT id,video_url,thumbnail_url,upscale_url FROM jobs').all())if(row.id!==jobId)for(const value of [row.video_url,row.thumbnail_url,row.upscale_url])try{protectedFiles.add(normalize(value))}catch{}
 const files=values.filter(Boolean).map(normalize);for(const file of files)if(file&&!protectedFiles.has(file)&&fs.existsSync(file))fs.unlinkSync(file);
}
// One deliberate library Delete action removes one image and its exclusive files.
router.delete('/library/remove',(req,res)=>{try{
 const source=req.body?.source;
 if(source==='job'){
  const row=jobFor(String(req.body.id||''));if(!row)return res.status(404).json({error:'Ảnh không còn trong thư viện.'});
  if(['pending','running'].includes(row.status))return res.status(409).json({error:'Ảnh đang xử lý. Chờ hoàn tất rồi xóa.'});
  db.prepare("UPDATE jobs SET archived_at=COALESCE(archived_at,datetime('now')) WHERE id=?").run(row.id);imageTrash.remove(row.id);
  db.prepare('DELETE FROM job_context WHERE job_id=?').run(row.id);
  for(const record of db.prepare('SELECT id,payload FROM mopix_upscales').all()){
   const u=JSON.parse(record.payload);if(u.resultJobId===row.id){if(!u.tag&&!u.sourceJobId&&u.beforeUrl?.startsWith('/uploads/upscale_input_'))cleanFiles([u.beforeUrl],null,null);db.prepare('DELETE FROM mopix_upscales WHERE id=?').run(record.id)}
  }
 }else if(source==='ref'){
  const row=db.prepare('SELECT * FROM ref_images WHERE tag=? AND COALESCE(internal_only,0)=0').get(String(req.body.tag||''));if(!row)return res.status(404).json({error:'Ảnh không còn trong thư viện.'});
  const inUse=db.prepare("SELECT ref_tags FROM jobs WHERE status IN ('pending','running')").all().some(j=>{try{return JSON.parse(j.ref_tags||'[]').includes(row.tag)}catch{return true}});
  if(inUse)return res.status(409).json({error:'Ảnh đang được dùng trong một tác vụ. Chờ hoàn tất rồi xóa.'});
  cleanFiles([row.filepath],null,row.id);db.prepare('DELETE FROM ref_images WHERE id=?').run(row.id);
 }else return res.status(400).json({error:'Chọn đúng một ảnh trong thư viện.'});
 broadcast('REFS_UPDATED',listRefs());broadcast('IMAGE_LIBRARY_UPDATED',{});res.json({success:true,permanent:true});
 }catch(e){res.status(409).json({error:e.message||'Chưa xóa được ảnh.'})}});
router.delete('/:id',(req,res)=>{if(req.body?.confirm!==true)return res.status(409).json({error:'Xác nhận trước khi xóa vĩnh viễn'});try{const result=imageTrash.remove(req.params.id);if(result.missing)return res.status(404).json({error:'Không tìm thấy ảnh'});res.json({success:true})}catch(error){res.status(409).json({error:error.message||'Chưa xóa được ảnh'})}});

module.exports=router;
