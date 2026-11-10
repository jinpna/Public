'use strict';
const fs=require('fs'),path=require('path');
const sharp=require('../../vendor/upscale/node_modules/sharp');
const active=new Map();
async function upscale(source,output){
 if(active.has(output))return active.get(output);
 if(active.size>=2)throw Error('Đang xuất 4K cho hai ảnh. Hãy chờ hoàn tất rồi thử lại.');
 const job=(async()=>{const meta=await sharp(source,{limitInputPixels:50000000}).metadata();if(!meta.width||!meta.height||meta.pages>1)throw Error('Chỉ hỗ trợ ảnh tĩnh');const swap=[5,6,7,8].includes(meta.orientation),w=swap?meta.height:meta.width,h=swap?meta.width:meta.height;
 const scale=Math.max(1,3840/Math.max(w,h));if(Math.round(w*scale)*Math.round(h*scale)>50000000)throw Error('Ảnh vượt giới hạn 50 megapixel');
 const tmp=output+'.'+process.pid+'.tmp';try{await sharp(source,{limitInputPixels:50000000}).rotate().resize({width:Math.round(w*scale),height:Math.round(h*scale),fit:'fill',kernel:'lanczos3',withoutEnlargement:false}).sharpen({sigma:.6,m1:.25,m2:.75}).png({compressionLevel:4}).toFile(tmp);fs.renameSync(tmp,output)}catch(error){try{fs.unlinkSync(tmp)}catch{}throw error}const m=await sharp(output).metadata();return {url:'/videos/'+path.basename(output),width:m.width,height:m.height,method:'local-lanczos3-sharpen',note:'Nội suy cục bộ, không phải AI khôi phục chi tiết'}
 })();active.set(output,job);try{return await job}finally{active.delete(output)}
}
module.exports={upscale};
