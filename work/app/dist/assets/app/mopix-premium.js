// Attribute-only enhancement: React keeps ownership of every control and event.
const controls=[
 '.image-preset-grid>button','.design-mode-grid>button',
 '.mopix-home-composer header button','.mopix-home-composer footer button',
 '.mopix-ai-suggest','.muse-create-action','.muse-viewer-toolbar button',
 '.canvas-view-tabs button','.mopix-video-entry-actions button','.video-tool-pages button',
 '.mopix-video-actions button','.mopix-icon-row button','.mopix-two-actions button',
 '.mopix-shape-toolbar button','.mopix-work-preview>header button',
 '.mopix-work-panel>header button','.mopix-prompt-mode button',
 '.mopix-prompt-instrument>footer button','.mopix-prompt-instrument>header button',
 '.muse-home-actions>button','.mopix-segment button',
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
