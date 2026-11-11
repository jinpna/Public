export function resolveImageAliases(prompt,refs=[]){
 const tags=refs.map(r=>String(typeof r==='string'?r:r.tag).replace(/^@/,''));
 return String(prompt||'').replace(/@(?:image|hinh)\s*(\d+)(?![\p{L}\p{N}_-])/giu,(token,n)=>{
  const tag=tags[Number(n)-1];if(!tag)throw Error(token+' cần ảnh đầu vào số '+n+'.');
  return '@'+tag;
 });
}
export function displayImageAliases(prompt,refs=[]){
 const names=new Map(refs.map((r,i)=>[String(typeof r==='string'?r:r.tag).toLowerCase(),'@image'+(i+1)]));
 return String(prompt||'').replace(/@([\p{L}\p{N}_-]+)/gu,(token,tag)=>names.get(tag.toLowerCase())||token);
}
let mentionService;
export function createMentionHook(React){
 return function useImageMentions(refs){
  const input=React.useRef(null),latest=React.useRef(refs);latest.current=refs;
  React.useEffect(()=>{mentionService??=mountImageMentions();return mentionService.attach(input.current,()=>latest.current)},[]);
  return input;
 };
}
// Textareas retain their native editing/IME behavior. The popup never replaces
// the field or moves focus while a Vietnamese composition is in progress.
const registrations=new WeakMap();
export function mountImageMentions(){
 const active=new Set();
 function attach(el,refs){
  if(!el)return()=>{};
  registrations.get(el)?.();
  let menu=null,chosen=0,matches=[],closed=false,composing=false;
  const original=el.getAttribute('aria-autocomplete');
  function hide(){menu?.remove();menu=null;el.removeAttribute('aria-controls');el.removeAttribute('aria-expanded')}
  function insert(index){const r=matches[index];if(!r)return;const pos=el.selectionStart??el.value.length,start=el.value.slice(0,pos).replace(/@(?:image\d*|hinh\d*|[\p{L}\p{N}_-]*)$/iu,'');const text=start+'@image'+(r.i+1)+' '+el.value.slice(pos);const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;setter.call(el,text);el.dispatchEvent(new Event('input',{bubbles:true}));el.setSelectionRange(start.length+('@image'+(r.i+1)+' ').length,start.length+('@image'+(r.i+1)+' ').length);hide();el.focus()}
  function update(){if(closed||composing||document.activeElement!==el)return;hide();const pos=el.selectionStart??0,token=el.value.slice(0,pos).match(/@([\p{L}\p{N}_-]*)$/u);if(!token)return;matches=refs().map((ref,i)=>({ref,i,name:'image'+(i+1)})).filter(r=>r.name.includes(token[1].toLowerCase()));if(!matches.length)return;chosen=0;menu=document.createElement('div');menu.className='mopix-image-mentions';menu.id='mentions-'+crypto.randomUUID();menu.setAttribute('role','listbox');menu.setAttribute('aria-label','Ảnh tham chiếu');el.setAttribute('aria-controls',menu.id);el.setAttribute('aria-expanded','true');for(const [i,r]of matches.entries()){const b=document.createElement('button');b.type='button';b.role='option';b.setAttribute('aria-selected',String(i===chosen));const img=document.createElement('img');img.src=r.ref.url||r.ref.file_url||'/uploads/'+r.ref.filename;img.alt='';const text=document.createElement('span');text.textContent='@image'+(r.i+1);b.append(img,text);b.addEventListener('pointerdown',e=>{e.preventDefault();insert(i)});menu.append(b)}(el.closest('dialog[open]')||document.body).append(menu);const box=el.getBoundingClientRect();menu.style.left=Math.max(8,Math.min(innerWidth-220,box.left))+'px';menu.style.top=Math.max(8,Math.min(innerHeight-menu.offsetHeight-8,box.bottom+6))+'px'}
  function key(e){if(e.isComposing||composing||!menu)return;if(e.key==='Escape'){e.preventDefault();e.stopPropagation();hide()}else if(['ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();chosen=(chosen+(e.key==='ArrowUp'?-1:1)+matches.length)%matches.length;[...menu.children].forEach((b,i)=>b.setAttribute('aria-selected',String(i===chosen)))}else if(e.key==='Enter'||e.key==='Tab'){e.preventDefault();e.stopPropagation();insert(chosen)}}
  const start=()=>{composing=true;hide()},end=()=>{composing=false;update()};
  el.setAttribute('aria-autocomplete','list');el.addEventListener('input',update);el.addEventListener('click',update);el.addEventListener('keydown',key,true);el.addEventListener('blur',hide);el.addEventListener('compositionstart',start);el.addEventListener('compositionend',end);window.addEventListener('resize',hide);window.addEventListener('scroll',hide,true);
  const dispose=()=>{closed=true;hide();el.removeEventListener('input',update);el.removeEventListener('click',update);el.removeEventListener('keydown',key,true);el.removeEventListener('blur',hide);el.removeEventListener('compositionstart',start);el.removeEventListener('compositionend',end);window.removeEventListener('resize',hide);window.removeEventListener('scroll',hide,true);original===null?el.removeAttribute('aria-autocomplete'):el.setAttribute('aria-autocomplete',original);active.delete(dispose);registrations.delete(el)};
  registrations.set(el,dispose);active.add(dispose);return dispose;
 }
 return{attach,dispose:()=>[...active].forEach(fn=>fn())};
}
