'use strict';
const express=require('express'),crypto=require('crypto'),router=express.Router();
router.use((req,res,next)=>{const port=process.env.MUSE_STAGING_PORT||process.env.PORT||'3001',origin=req.get('origin');if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)||(origin&&!['http://localhost:'+port,'http://127.0.0.1:'+port].includes(origin)))return res.status(403).json({error:'Chỉ dùng trên máy này'});next()});
router.get('/config',(_req,res)=>res.json({configured:require('../spaceComponents').aiConfigured(),provider:'MUSE',model:'MUSE',imageReferences:true,maxReferences:15}));
router.post('/improve',async(req,res)=>{
 const body=req.body||{};
 if(body.action!==undefined&&!['generate','refine'].includes(body.action))return res.status(400).json({error:'Thao tác trợ lý không hợp lệ'});
 if(body.prompt!==undefined&&typeof body.prompt!=='string')return res.status(400).json({error:'Mô tả phải là văn bản'});
 const refs=Array.isArray(body.references)?body.references.filter(ref=>ref&&typeof ref.tag==='string').map(ref=>({tag:ref.tag.replace(/^@/,''),role:typeof ref.role==='string'?ref.role.slice(0,100):'Tham chiếu'})).filter(ref=>ref.tag):[],tags=[...new Set(refs.map(ref=>ref.tag))],prompt=String(body.prompt||'').trim()||(tags.length?'Viết prompt phù hợp từ các ảnh tham chiếu đã chọn.':'');
 if(!prompt||prompt.length>30000)return res.status(400).json({error:'Nhập ý tưởng hoặc chọn ảnh để MUSE viết prompt'});
 if(tags.length>15)return res.status(400).json({error:'Chọn tối đa 15 ảnh tham chiếu chính'});
 try{
  if(tags.length){const resolved=require('../refManifest').resolveJobRefs('',JSON.stringify(tags));if(resolved.missingTags.length||resolved.missingFiles.length)return res.status(400).json({error:'Ảnh không còn trên máy: '+[...resolved.missingTags,...resolved.missingFiles].join(', ')})}
  const key='assistant_'+crypto.randomUUID(),packed=tags.length>4?await require('../spaceSmart').packGuides(key,{guide:{refTags:tags,roleRefs:refs}}):null,attached=packed?.guide?.refTags||tags,kind=body.kind==='video'?'video':'ảnh';
  const result=await require('../spaceComponents').aiPrompt(key,{prompt:{text:prompt+'\n\nVai trò và tên ảnh gốc: '+JSON.stringify(refs)+(packed?'\nẢnh tham chiếu được ghép theo thứ tự ô: '+tags.map((tag,index)=>(index+1)+' = @'+tag).join('; ')+'\n'+packed.guide.text:'')}},{data:{refTags:attached,text:(body.action==='generate'?'Viết prompt từ ý tưởng và ảnh.':'Tối ưu prompt, giữ ý định và toàn bộ tên @tag gốc.')+' Chỉ trả prompt '+kind+' hoàn chỉnh, không lời dẫn, không tạo media. '+(kind==='video'?'Giữ nguyên phong cách ảnh nguồn (kể cả tranh 2D), thứ tự cảnh, thời gian, thoại và mọi vai trò tham chiếu. Không tự thêm camera lock, một cảnh liên tục, nhạc nền hoặc phong cách ảnh thật. Chỉ làm rõ ý người dùng, không đổi cốt truyện.':'Giữ danh tính, chất liệu, chi tiết tự nhiên và bố cục được yêu cầu.')}});
  if(!result.text?.trim())throw Error('MUSE chưa trả về prompt. Hãy thử lại.');
  res.json({prompt:result.text,provider:'MUSE',model:'MUSE',attachedImages:tags.length,attachedFiles:attached.length});
 }catch(error){res.status(502).json({error:error.message})}
});
router.use('/motion-reference',require('./motionReference.cjs').router);
module.exports=router;
