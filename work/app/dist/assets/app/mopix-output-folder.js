import{createStudioIcon}from'./studio-icons.js?v=24';
export function createOutputFolder(React){
 const{createElement:h,useState:S,useEffect:E}=React,Icon=createStudioIcon(React);
 return function OutputFolder({settings=false}){
  const[path,P]=S(''),[busy,B]=S(false),[error,ERR]=S('');
  E(()=>{let live=true;async function load(){try{const r=await fetch('/api/settings');if(!r.ok)return;const d=await r.json();if(live)P(d.download_dir||'')}catch{}}load();window.addEventListener('mopix-output-folder',load);return()=>{live=false;window.removeEventListener('mopix-output-folder',load)}},[]);
  async function choose(){if(busy)return;B(true);ERR('');try{
   if(!window.electronAPI?.selectSaveDirectory)throw Error('Mở app desktop để chọn thư mục.');
   const selected=await window.electronAPI.selectSaveDirectory(path);if(!selected)return;
   const r=await fetch('/api/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({download_dir:selected})});
   const d=await r.json();if(!r.ok)throw Error(d.error||'Chưa lưu được thư mục.');
   P(selected);window.dispatchEvent(new Event('mopix-output-folder'));
  }catch(e){ERR(e.message)}finally{B(false)}}
  return h('div',{className:'mopix-output-folder'+(settings?' is-settings':'')},
   h('span',null,'Thư mục lưu'),
   h('button',{type:'button',disabled:busy,onClick:choose,title:path||'Downloads / Muse Videos','aria-label':'Chọn thư mục lưu'},
    h(Icon,{name:'folder',size:16}),h('span',null,path?path.split(/[\\/]/).filter(Boolean).pop():'Downloads'),h('span',{'aria-hidden':true},'↗')),
   settings&&h('small',null,path||'Downloads / Muse Videos'),
   error&&h('small',{role:'alert'},error));
 };
}
