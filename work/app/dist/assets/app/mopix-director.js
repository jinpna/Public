import{studioAPI as api}from'./studio-assets.js?v=7';
import{requireMuseLogin}from'./mopix-session.js';
export function parseStoryboard(text){
 let data;try{data=JSON.parse(String(text).replace(/^\s*```(?:json)?\s*/i,'').replace(/\s*```\s*$/,''))}catch{throw Error('MUSE chưa trả storyboard hợp lệ. Thử lại; bản hiện tại vẫn được giữ.');}
 if(!Array.isArray(data.scenes)||data.scenes.length!==3)throw Error('Storyboard cần đúng 3 cảnh. Thử lại.');
 return data.scenes.map(scene=>{if(typeof scene.title!=='string'||!scene.title.trim()||typeof scene.prompt!=='string'||!scene.prompt.trim()||![5,10].includes(scene.duration))throw Error('Cảnh chưa có đủ nội dung hoặc thời lượng 5s / 10s. Thử lại.');return{id:crypto.randomUUID(),title:scene.title.trim().slice(0,100),prompt:scene.prompt.trim().slice(0,10000),duration:scene.duration}});
}
export async function draftStoryboard(brief,refs=[],ratio='16:9'){
 if(!brief.trim())throw Error('Nhập ý tưởng xuyên suốt trước.');await requireMuseLogin();
 const result=await api('/api/prompt-assistant/improve',{action:'generate',kind:'video',references:refs.map(r=>({tag:r.tag,role:'Nhân vật / bối cảnh xuyên suốt'})),prompt:'You are drafting a storyboard, not generating media. Return ONLY a valid JSON object, no markdown or prose: {"scenes":[{"title":"short Vietnamese title","prompt":"complete English video prompt","duration":5}]}. Exactly THREE scenes: opening, development, ending. Each scene duration must be 5 or 10 seconds only. Frame ratio '+ratio+'. Each prompt must specify exact timing, a motivated camera path and subject action; keep one consistent protagonist, wardrobe, product geometry, props, lighting and connected world across all scenes. No slideshow or disconnected poster cuts; at most two text layers if requested. Preserve Vietnamese accents in requested on-screen wording. Use only facts in the brief. Keep source @tags unchanged; no invented image tags. No new claims or statistics. Return the editable scene plan only.\n\nUSER BRIEF:\n'+brief});
 return parseStoryboard(result.prompt);
}
