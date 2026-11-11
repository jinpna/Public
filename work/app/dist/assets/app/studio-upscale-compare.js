import {createSmoothPreview} from './studio-smooth-preview.js?v=4';
import {createStudioIcon} from './studio-icons.js?v=24';
export function createUpscaleCompare(React){
 const{createElement:h,useState:S,useEffect:E,useRef:R}=React,PanZoom=createSmoothPreview(React),Icon=createStudioIcon(React);
 return function UpscaleCompare({before,after,width,height,onClose,inline=false,beforeLabel='Trước',afterLabel='Sau',downloadLabel='Tải ảnh 4K',beforeControl=null,controlsRef=null}){
  const position=R(50),plane=R(null),slider=R(null),pending=R(null),stage=R(null),localControls=R(null);const controls=controlsRef||localControls;
  const[axis,AXIS]=S('x'),[pan,PAN]=S(true),[split,SPLIT]=S(50),[zoom,ZOOM]=S(1),[dimensions,DIM]=S(null),[error,ERR]=S(''),[viewport,VP]=S(null);
  function action(label,icon,fn,extra={}){return h('button',{type:'button',title:label,'aria-label':label,onClick:fn,...extra},h(Icon,{name:icon,size:18}))}
  function move(value){const n=Number(value);if(!Number.isFinite(n))return;position.current=Math.max(0,Math.min(100,n));SPLIT(position.current);if(pending.current!==null)return;pending.current=requestAnimationFrame(()=>{pending.current=null;plane.current?.style.setProperty('--split',position.current+'%');slider.current?.setAttribute('aria-valuenow',String(Math.round(position.current)));slider.current?.setAttribute('aria-valuetext',Math.round(position.current)+'% '+beforeLabel)})}
  function pointer(e){const rect=plane.current.getBoundingClientRect();move(axis==='x'?(e.clientX-rect.left)/rect.width*100:(e.clientY-rect.top)/rect.height*100)}
  function release(e){if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId)}
  function key(e){const delta=e.shiftKey?10:1;let value;if(e.key==='Home')value=0;else if(e.key==='End')value=100;else if(['ArrowLeft','ArrowUp'].includes(e.key))value=position.current-delta;else if(['ArrowRight','ArrowDown'].includes(e.key))value=position.current+delta;else return;e.preventDefault();e.stopPropagation();move(value)}
  E(()=>()=>{if(pending.current!==null)cancelAnimationFrame(pending.current)},[]);
  E(()=>{if(!stage.current)return;const measure=()=>VP({width:Math.max(1,stage.current.clientWidth-20),height:Math.max(1,stage.current.clientHeight-20)});measure();const observer=new ResizeObserver(measure);observer.observe(stage.current);return()=>observer.disconnect()},[]);
  E(()=>{const handle=e=>{if(e.key==='Escape'&&!inline)onClose?.()};window.addEventListener('keydown',handle);return()=>window.removeEventListener('keydown',handle)},[onClose,inline]);
  return h('div',{className:inline?'upscale-compare-inline':'upscale-compare-backdrop',role:inline?'region':'dialog','aria-modal':inline?undefined:true,'aria-label':'So sánh ảnh trước và sau'},
   h('section',{className:'upscale-compare-dialog'},
    h('header',null,h('div',null,h('strong',null,'Trước / Sau'),h('small',null,(width&&height?width+' × '+height+' px · ':'')+'Kéo để so sánh')),beforeControl,
     h('div',{className:'upscale-icon-actions'},action(axis==='x'?'Chuyển sang chia trên / dưới':'Chuyển sang chia trái / phải','compare',()=>AXIS(axis==='x'?'y':'x'),{'aria-pressed':axis==='y'}),action(pan?'Khóa kéo ảnh':'Di chuyển ảnh','view',()=>PAN(!pan),{'aria-pressed':pan}),action('Thu nhỏ','zoomOut',()=>controls.current?.zoomOut()),h('output',{'aria-label':'Mức phóng đại'},zoom.toFixed(1)+'×'),action('Phóng to','zoomIn',()=>controls.current?.zoomIn()),action('Vừa khung','reset',()=>{controls.current?.reset();move(50)}),h('a',{href:after,download:true,title:downloadLabel,'aria-label':downloadLabel},h(Icon,{name:'download',size:18})),!inline&&action('Đóng so sánh','close',onClose))),
    h(PanZoom,{className:'upscale-compare-scroll',scrollRef:stage,controls,panEnabled:pan,onZoom:ZOOM},
     h('div',{className:'upscale-compare-canvas mopix-split-compare',ref:plane,'data-axis':axis,style:{'--split':position.current+'%',width:viewport?Math.max(1,Math.min(viewport.width,viewport.height*((dimensions?.width||width||1)/(dimensions?.height||height||1))))+'px':'100%',aspectRatio:dimensions?dimensions.width+'/'+dimensions.height:width&&height?width+'/'+height:'1/1'}},
      h('img',{src:after,decoding:'async',alt:afterLabel==='Sau'?'Sau upscale':afterLabel,draggable:false,onLoad:e=>DIM({width:e.currentTarget.naturalWidth,height:e.currentTarget.naturalHeight}),onError:()=>ERR('Không tải được ảnh kết quả.')}),
      h('img',{className:'mopix-split-before-image',src:before,decoding:'async',alt:beforeLabel==='Trước'?'Trước upscale':beforeLabel,draggable:false,onError:()=>ERR('Không tải được ảnh gốc.')}),

      h('div',{className:'mopix-compare-handle',ref:slider,role:'slider',tabIndex:0,'aria-label':'Kéo so sánh trước và sau','aria-valuemin':0,'aria-valuemax':100,'aria-valuenow':Math.round(position.current),'aria-valuetext':Math.round(position.current)+'% '+beforeLabel,'aria-orientation':axis==='x'?'horizontal':'vertical',onKeyDown:key,onPointerDown:e=>{if(e.button!==0)return;e.preventDefault();e.stopPropagation();e.currentTarget.focus({preventScroll:true});e.currentTarget.setPointerCapture(e.pointerId);pointer(e)},onPointerMove:e=>{if(e.currentTarget.hasPointerCapture(e.pointerId))pointer(e)},onPointerUp:release,onPointerCancel:release,onDoubleClick:e=>{e.stopPropagation();move(50)}},h('span',{'aria-hidden':true},h('svg',{width:18,height:18,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:1.5,strokeLinecap:'round',strokeLinejoin:'round'},h('path',{d:'m8 7-5 5 5 5m8-10 5 5-5 5'})))))),
    h('div',{className:'mopix-compare-scrubber'},h('input',{type:'range',min:0,max:100,step:0.1,value:split,'aria-label':'Mức so sánh ảnh',onChange:e=>move(e.target.value)})),error&&h('footer',null,h('span',{role:'alert'},error)))
 );
 }
}
