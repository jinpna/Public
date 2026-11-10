'use strict';
const fs=require('fs'),path=require('path'),sharp=require('../../vendor/upscale/node_modules/sharp');
const RATIOS=['1:1','9:16','16:9','4:3','3:4'];
async function enforce(file,ratio){
 if(!RATIOS.includes(ratio))throw Error('Tỷ lệ ảnh không được hỗ trợ');
 const original=await sharp(file,{limitInputPixels:50000000}).rotate().toBuffer({resolveWithObject:true}),{width,height}=original.info,[a,b]=ratio.split(':').map(Number);
 if(width*b===height*a)return {file,width,height,adjusted:false};
 // Exact integer ratio without stretching or transparent borders. Keep the original file.
 const k=Math.floor(Math.min(width/a,height/b));if(k<1)throw Error('Ảnh nguồn quá nhỏ');
 const w=k*a,h=k*b,target=file.replace(/\.[^.]+$/,'_frame.png'),tmp=target+'.tmp';
 await sharp(original.data).extract({left:Math.floor((width-w)/2),top:Math.floor((height-h)/2),width:w,height:h}).png({compressionLevel:4}).toFile(tmp);fs.renameSync(tmp,target);
 fs.writeFileSync(target+'.ratio.json',JSON.stringify({originalUrl:'/videos/'+path.basename(file),width:w,height:h,originalWidth:width,originalHeight:height,ratio,adjusted:true,method:'center-crop-no-stretch'}));return {file:target,width:w,height:h,adjusted:true};
}
module.exports={enforce,RATIOS};
