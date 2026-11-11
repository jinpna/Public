export function createShapeSketch(React){
 const{createElement:h,useRef:R,useState:S,useEffect:E}=React;
 return function ShapeSketch({onApply,onClose}){
  const dialog=R(null),drawing=R(null),[points,POINTS]=S([]);
  E(()=>{dialog.current.showModal()},[]);
  function point(e){const r=e.currentTarget.getBoundingClientRect();return[Math.max(0,Math.min(480,(e.clientX-r.left)/r.width*480)),Math.max(0,Math.min(360,(e.clientY-r.top)/r.height*360))]}
  function down(e){if(e.button!==0)return;e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);drawing.current=[point(e)];POINTS(drawing.current)}
  function move(e){if(!drawing.current||!e.currentTarget.hasPointerCapture(e.pointerId))return;const p=point(e),last=drawing.current.at(-1);if(Math.hypot(p[0]-last[0],p[1]-last[1])<4)return;drawing.current=[...drawing.current,p].slice(0,800);POINTS(drawing.current)}
  function end(e){drawing.current=null;if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId)}
  const path=points.length?'M '+points.map(p=>p.map(n=>n.toFixed(1)).join(' ')).join(' L ')+' Z':'';
  return h('dialog',{ref:dialog,className:'mopix-options-modal mopix-shape-sketch','aria-label':'Phác hình 3D',onCancel:onClose},
   h('section',null,h('header',null,h('h2',null,'Phác hình'),h('button',{type:'button',onClick:onClose},'Đóng')),
    h('p',null,'Vẽ một đường bao. Điểm đầu và cuối sẽ tự nối thành hình khối.'),
    h('svg',{viewBox:'0 0 480 360',role:'img','aria-label':'Vùng vẽ đường bao',onPointerDown:down,onPointerMove:move,onPointerUp:end,onPointerCancel:end},path&&h('path',{d:path,fill:'#d0d6e022',stroke:'#d0d6e0',strokeWidth:2,strokeLinejoin:'round'})),
    h('footer',null,h('button',{type:'button',onClick:()=>POINTS([]),disabled:!points.length},'Vẽ lại'),h('button',{type:'button',disabled:points.length<4,onClick:()=>onApply('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 360"><path fill="#d0d6e0" d="'+path+'"/></svg>')},'Dùng hình'))));
 };
}
