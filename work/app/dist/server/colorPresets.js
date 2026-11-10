'use strict';
const express=require('express'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const sharp=require('../../vendor/upscale/node_modules/sharp');
const {db}=require('./db'),{DATA_DIR}=require('./paths');
const router=express.Router();
db.exec('CREATE TABLE IF NOT EXISTS monday_color_presets(id TEXT PRIMARY KEY,name TEXT NOT NULL,ref_tag TEXT NOT NULL,palette TEXT NOT NULL,created_at TEXT NOT NULL,archived_at TEXT)');
router.get('/',(_req,res)=>{try{res.json(db.prepare('SELECT * FROM monday_color_presets WHERE archived_at IS NULL ORDER BY created_at DESC').all().map(row=>({...row,palette:JSON.parse(row.palette),url:'/api/refs/'+encodeURIComponent(row.ref_tag)+'/file'})))}catch{res.status(500).json({error:'Không tải được preset màu'})}});
router.post('/',async(req,res)=>{
 let target;
 try{
  const name=String(req.body.name||'').trim(),tag=String(req.body.refTag||'');
  if(!name||name.length>80)throw Error('Đặt tên preset từ 1–80 ký tự');
  const source=db.prepare('SELECT * FROM ref_images WHERE tag=? AND archived_at IS NULL').get(tag);
  if(!source||!fs.existsSync(source.filepath))throw Error('Ảnh mẫu không còn trong thư viện');
  const real=fs.realpathSync(source.filepath),allowed=['uploads','videos'].map(folder=>path.join(DATA_DIR,folder)+path.sep);
  if(!allowed.some(folder=>real.startsWith(folder)))throw Error('Ảnh nằm ngoài thư viện');
  if(db.prepare('SELECT COUNT(*) AS count FROM monday_color_presets WHERE archived_at IS NULL').get().count>=100)throw Error('Tối đa 100 preset màu');
  const {data,info}=await sharp(real,{limitInputPixels:50000000}).rotate().resize(48,48,{fit:'inside'}).removeAlpha().toColourspace('srgb').raw().toBuffer({resolveWithObject:true});
  const bins=new Map();
  for(let offset=0;offset<data.length;offset+=info.channels){const values=[data[offset],data[offset+1],data[offset+2]].map(value=>Math.min(255,Math.floor(value/32)*32+16)),key=values.map(value=>value.toString(16).padStart(2,'0')).join('');bins.set(key,(bins.get(key)||0)+1)}
  const palette=[...bins].sort((first,second)=>second[1]-first[1]).slice(0,5).map(([color])=>'#'+color),id=crypto.randomUUID(),refTag='colorpreset_'+id.replaceAll('-',''),filename=refTag+path.extname(source.filename).toLowerCase();
  target=path.join(DATA_DIR,'uploads',filename);fs.copyFileSync(real,target,fs.constants.COPYFILE_EXCL);
  const created=new Date().toISOString();
  db.transaction(()=>{db.prepare('INSERT INTO ref_images(id,tag,filename,filepath,size,mime_type,internal_only,created_at) VALUES(?,?,?,?,?,?,1,?)').run(crypto.randomUUID(),refTag,filename,target,fs.statSync(target).size,source.mime_type,created);db.prepare('INSERT INTO monday_color_presets(id,name,ref_tag,palette,created_at) VALUES(?,?,?,?,?)').run(id,name,refTag,JSON.stringify(palette),created)})();
  res.status(201).json({id,name,ref_tag:refTag,palette,url:'/api/refs/'+refTag+'/file',created_at:created});
 }catch(error){if(target)try{fs.unlinkSync(target)}catch{}res.status(422).json({error:error.message})}
});
router.delete('/:id',(req,res)=>{const changed=db.prepare('UPDATE monday_color_presets SET archived_at=? WHERE id=? AND archived_at IS NULL').run(new Date().toISOString(),req.params.id);res.status(changed.changes?200:404).json(changed.changes?{ok:true}:{error:'Không tìm thấy preset'})});
router.post('/:id/restore',(req,res)=>{const changed=db.prepare('UPDATE monday_color_presets SET archived_at=NULL WHERE id=?').run(req.params.id);res.status(changed.changes?200:404).json(changed.changes?{ok:true}:{error:'Không tìm thấy preset'})});
module.exports={router};
