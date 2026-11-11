// Attribute-only enhancement: React keeps ownership of every control and event.
const controls=[

 '.mopix-home-composer footer button',
 '.mopix-ai-suggest','.muse-create-action','.muse-viewer-toolbar button',
 '.canvas-view-tabs button',
 '.mopix-icon-row button',
 '.mopix-shape-toolbar button','.mopix-work-preview>header button',
 '.mopix-work-panel>header button',
 '.mopix-prompt-instrument>header button',

 '.asset-picker>header button','.asset-picker-toolbar>button',
 '.asset-picker-toolbar .sx-seg button','.asset-picker>footer>button'
].join(',');
export function mountPremiumControls(){
 const root=document.getElementById('root');if(!root)return()=>{};
 let frame=null;const generatedLabels=new WeakMap();
 function refresh(){frame=null;root.querySelectorAll(controls).forEach(el=>{
  // Media thumbnails and editable controls keep their visible content.
  if(!el.querySelector('svg')||el.querySelector('img,video,input'))return;
  const text=el.textContent.trim().replace(/\s+/g,' ');
  if(text&&(!el.hasAttribute('aria-label')||generatedLabels.has(el))){el.setAttribute('aria-label',text);generatedLabels.set(el,text)}
  el.classList.add('mopix-icon-action');
 });}
 const observer=new MutationObserver(()=>{if(frame===null)frame=requestAnimationFrame(refresh)});
 refresh();observer.observe(root,{childList:true,subtree:true,characterData:true});
 return()=>{observer.disconnect();if(frame!==null)cancelAnimationFrame(frame)};
}
