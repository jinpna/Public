'use strict';
const {spawn}=require('child_process'),fs=require('fs'),path=require('path');
function run(bin,args,{probe=false}={}){return new Promise((resolve,reject)=>{let err='',done=false;const p=spawn(bin,args,{stdio:['ignore','ignore','pipe']}),timer=setTimeout(()=>{p.kill('SIGKILL')},600000);p.stderr.on('data',b=>err=(err+b).slice(-12000));p.on('error',e=>{clearTimeout(timer);if(!done){done=true;reject(e)}});p.on('close',code=>{clearTimeout(timer);if(done)return;done=true;if(code===0||probe)resolve(err);else reject(Error('FFmpeg: '+err.slice(-700)))})})}
async function renderFilm({ffmpeg,clips,out,work,ratio='16:9',transition='fade',audio=true,onProgress=()=>{}}){
 const [w,h]=ratio==='9:16'?[720,1280]:ratio==='1:1'?[960,960]:[1280,720];let normalized=[];
 for(let i=0;i<clips.length;i++){
  const clip=clips[i],info=await run(ffmpeg,['-hide_banner','-i',clip.file],{probe:true});
  if(!/Video:/.test(info))throw Error('Cảnh '+(i+1)+' không có luồng video hợp lệ.');
  const dest=path.join(work,'scene_'+i+'.mp4'),hasAudio=audio&&/Audio:/.test(info);
  await run(ffmpeg,['-y','-i',clip.file,'-f','lavfi','-i','anullsrc=r=48000:cl=stereo','-map','0:v:0','-map',hasAudio?'0:a:0':'1:a:0','-vf',`scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=25,tpad=stop_mode=clone:stop_duration=10,setpts=PTS-STARTPTS`,'-af','aresample=48000,apad,asetpts=PTS-STARTPTS','-t',String(clip.duration),'-c:v','libx264','-preset','veryfast','-crf','20','-pix_fmt','yuv420p','-c:a','aac','-ac','2',dest]);normalized.push(dest);onProgress(Math.round((i+1)/clips.length*65));
 }
 if(transition==='cut'||clips.length===1){const list=path.join(work,'concat.txt');fs.writeFileSync(list,normalized.map(f=>"file '"+f.replaceAll("'","'\\''")+"'").join('\n'));await run(ffmpeg,['-y','-f','concat','-safe','0','-i',list,'-c','copy','-movflags','+faststart',out]);}
 else {let merged=normalized[0],length=clips[0].duration;for(let i=1;i<clips.length;i++){const dest=i===clips.length-1?out:path.join(work,'join_'+i+'.mp4');await run(ffmpeg,['-y','-i',merged,'-i',normalized[i],'-filter_complex',`[0:v][1:v]xfade=transition=fade:duration=0.25:offset=${(length-.25).toFixed(3)},format=yuv420p[v];[0:a][1:a]acrossfade=d=0.25[a]`,'-map','[v]','-map','[a]','-c:v','libx264','-preset','veryfast','-crf','20','-c:a','aac','-movflags','+faststart',dest]);merged=dest;length+=clips[i].duration-.25;onProgress(65+Math.round(i/(clips.length-1)*34));}}
 return {duration:clips.reduce((n,c)=>n+c.duration,0)-(transition==='fade'?.25*(clips.length-1):0)};
}
module.exports={renderFilm,run};
