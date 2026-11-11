'use strict';
function resolveVideoAliases(prompt,refs=[]){const tags=refs.map(r=>String(typeof r==='string'?r:r.tag).replace(/^@/,''));return String(prompt||'').replace(/@((?:image|hinh)(\d+))(?![\p{L}\p{N}_]|-(?!@))/giu,(all,name,n)=>{const index=Number(n)-1;if(index<0||index>=tags.length)throw Error('@'+name+' cần ảnh đầu vào số '+n+', hiện chỉ có '+tags.length+' ảnh.');return '@'+tags[index]})}
function normalizeVideoBody(body={}){const refs=Array.isArray(body.refTags)?body.refTags:body.batchRefImage?[body.batchRefImage]:[];return {...body,prompts:Array.isArray(body.prompts)?body.prompts.map(p=>resolveVideoAliases(p,refs)):resolveVideoAliases(body.prompts,refs)}}
module.exports={resolveVideoAliases,normalizeVideoBody};
function canonicalVideoPrompt(prompt,refs=[]){let text=resolveVideoAliases(prompt,refs);const tags=refs.map(r=>String(typeof r==='string'?r:r.tag).replace(/^@/,''));return text.replace(/@([\p{L}\p{N}_-]+)/gu,(all,tag)=>{const i=tags.findIndex(t=>t.toLowerCase()===tag.toLowerCase());return i>=0?'@image'+(i+1):all})}
module.exports.canonicalVideoPrompt=canonicalVideoPrompt;
