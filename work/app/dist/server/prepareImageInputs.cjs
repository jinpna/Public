const crypto=require('crypto'),fs=require('fs'),path=require('path');
async function prepareImageInputs(spec,{db,dir,sharp}){
 const tags=[...new Set(spec.refTags||[])];
 const replaceAlias=p=>String(p).replace(/@(?:mention|image([1-9]\d*)|hinh([1-9]\d*))(?![\p{L}\p{N}_-])/giu,(all,a,b)=>{const index=a||b?Number(a||b)-1:0;if(!tags[index])throw Error('Thêm ảnh đầu vào trước khi sử dụng '+all);return '@'+tags[index]});
 if(Array.isArray(spec.prompts))spec={...spec,prompts:spec.prompts.map(replaceAlias)};
 if(tags.length>10)throw Error('Tối đa 10 ảnh đầu vào.');
 if(!Array.isArray(spec.prompts)||!spec.prompts.length||spec.prompts.some(p=>typeof p!=='string'||p.length>20000))throw Error('Yêu cầu ảnh không hợp lệ.');
 const records=tags.map(tag=>{if(typeof tag!=='string'||!/^[-\p{L}\p{N}_]+$/u.test(tag))throw Error('Mã ảnh không hợp lệ');const row=db.prepare('SELECT * FROM ref_images WHERE tag=?').get(tag);if(!row||!fs.existsSync(row.filepath))throw Error('Ảnh đầu vào không còn trên máy');return row});
 if(tags.length<=4)return {prompts:spec.prompts,refTags:tags,mediaType:'image',ratio:spec.ratio};
 const guides=records.slice(1),key=crypto.createHash('sha256').update(JSON.stringify(guides.map(r=>[r.tag,fs.statSync(r.filepath).mtimeMs]))).digest('hex').slice(0,24),boardTag='input_board_'+key;
 let board=db.prepare('SELECT * FROM ref_images WHERE tag=?').get(boardTag);
 if(!board){const tile=768,cols=3,rows=Math.ceil(guides.length/cols),overlays=[];for(let i=0;i<guides.length;i++){overlays.push({input:await sharp(guides[i].filepath,{limitInputPixels:50000000}).rotate().resize(tile,tile-44,{fit:'contain',background:'#eeeeee'}).jpeg().toBuffer(),left:i%cols*tile,top:Math.floor(i/cols)*tile+44});overlays.push({input:Buffer.from(`<svg width="768" height="44"><rect width="768" height="44" fill="#111"/><text x="20" y="30" font-family="sans-serif" font-size="24" fill="white">REF ${i+2}</text></svg>`),left:i%cols*tile,top:Math.floor(i/cols)*tile})}const filename=boardTag+'.jpg',filepath=path.join(dir,filename);fs.mkdirSync(dir,{recursive:true});await sharp({create:{width:cols*tile,height:rows*tile,channels:3,background:'#eeeeee'}}).composite(overlays).jpeg({quality:92}).toFile(filepath);db.prepare("INSERT INTO ref_images(id,tag,filename,filepath,size,mime_type,internal_only,created_at) VALUES(?,?,?,?,?,'image/jpeg',1,datetime('now'))").run(crypto.randomUUID(),boardTag,filename,filepath,fs.statSync(filepath).size);board={tag:boardTag}}
 const mapping=new Map(guides.map((r,i)=>[r.tag,`REF ${i+2} in @${boardTag}`]));
 const prompts=spec.prompts.map(p=>'INPUT GUIDE: @'+tags[0]+' is the separate primary image. @'+boardTag+' is a numbered reference board. Read REF 2–'+tags.length+' separately, left to right, top to bottom. Follow each reference role specified below. Never reproduce the board, grid, labels or numbers in the output.\n\n'+p.replace(/@([\p{L}\p{N}_-]+)/gu,(all,tag)=>mapping.get(tag)||all));
 return {prompts,refTags:[tags[0],boardTag],mediaType:'image',ratio:spec.ratio};
}
module.exports={prepareImageInputs};
