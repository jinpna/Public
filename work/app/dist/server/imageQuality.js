'use strict';
const fs=require('fs'),path=require('path'),sharp=require('../../vendor/upscale/node_modules/sharp'),{DATA_DIR}=require('./paths');
const active=new Map();
async function exportQuality(url,key,size='4k'){
 if(!['2k','4k'].includes(size))throw Error('Kích thước không hợp lệ');if(!/^\/videos\/[\w.-]+\.(png|jpe?g|webp)$/i.test(url))throw Error('Ảnh nguồn không hợp lệ');
 const dir=path.join(DATA_DIR,'videos'),source=path.join(dir,path.basename(url));if(!fs.existsSync(source)||!fs.realpathSync(source).startsWith(fs.realpathSync(dir)+path.sep))throw Error('Ảnh nguồn không tồn tại');
 const meta=await sharp(source,{limitInputPixels:50000000}).metadata(),swap=[5,6,7,8].includes(meta.orientation),width=swap?meta.height:meta.width,height=swap?meta.width:meta.height,target=size==='2k'?2048:3840;if(!width||!height||meta.pages>1)throw Error('Chỉ hỗ trợ ảnh tĩnh');
 if(Math.max(width,height)>=target)return {url,width,height,originalUrl:url,exportSize:size,method:'original'};
 const name='upscale_'+String(key).replace(/[^\w-]/g,'').slice(0,100)+'_'+size+'.png',out=path.join(dir,name);
 if(!active.has(out))active.set(out,(async()=>{if(!fs.existsSync(out)){const tmp=out+'.tmp';try{await sharp(source,{limitInputPixels:50000000}).rotate().resize({width:target,height:target,fit:'inside',kernel:'lanczos3',withoutEnlargement:false}).sharpen({sigma:.6,m1:.25,m2:.75}).png({compressionLevel:6}).toFile(tmp);fs.renameSync(tmp,out)}catch(e){try{fs.unlinkSync(tmp)}catch{}throw e}}const m=await sharp(out).metadata();return {url:'/videos/'+name,width:m.width,height:m.height,originalUrl:url,exportSize:size,method:'local-lanczos3-lossless-png'}})().finally(()=>active.delete(out)));
 return active.get(out);
}
module.exports={exportQuality};
