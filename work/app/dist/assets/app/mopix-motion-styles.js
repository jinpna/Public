// Original MOPIX prompt adaptations of the style names supplied in the brief.
// Posters: Miushare / Bang Motion. These are not HTML/GSAP renders or 60fps promises.
export const MOTION_STYLES=[
 ['m1','Grainy Gradient','Ra mắt sản phẩm AI','01-grainy-gradient.jpg','A tactile grain-textured gradient world, dimensional product hero and restrained luminous atmosphere.','Push through a foreground shape into a slow orbit.','One short headline softly resolves from grain; one optional support line.'],
 ['m2','Poster Color-Block','Sale và typography theo nhịp','02-kinetic-colorblock.jpg','Bold editorial color blocks forming a physical poster stage around the same hero product.','A brief lateral whip-pan settles into a controlled push-in.','Short kinetic words land on the beat, never more than two text layers.'],
 ['m3','SaaS UI Tour','Demo ứng dụng và tính năng','03-saas-ui-tour.jpg','A coherent software workspace with plausible real controls and a visible purposeful cursor.','Track one cursor action with a close push-in, then drift to its resulting state.','One brief feature label beside the active control, no fabricated metrics.'],
 ['m4','Flat Vector','Fintech và ứng dụng','04-flat-vector.jpg','A unified flat-vector scene with crisp geometric characters and elastic, physically connected shapes.','A gentle crane move follows the main shape into the next composition.','Simple vector typography, one headline and at most one support line.'],
 ['m5','Flat Pop Photo','Ảnh sản phẩm và sticker','07-flat-pop-photo.jpg','The exact source product photo anchors a playful cut-paper set with a few original dimensional stickers.','A short push-in followed by a shallow orbit keeps the product stable.','One punchy title pops with a restrained elastic settle; preserve labels.'],
 ['m6','Luxury Dark','Sản phẩm cao cấp','12-more-combinations.jpg','Deep dark studio, subtle warm metallic highlights, premium materials and negative space.','Slow macro orbit-drift with a deliberate rack focus from material to hero.','A small elegant title fades in; no invented luxury claims or badges.'],
 ['m7','Visual Journalism','Câu chuyện và dữ liệu','09-visual-journalism.jpg','An editorial documentary desk with connected evidence cards, annotations and a clear narrative focus.','Move through the same desk with a measured push-through and purposeful rack focus.','At most two readable editorial text layers; use only data supplied by the user.'],
 ['m8','White Catalog','Lookbook và nội thất','08-white-catalog.jpg','A refined bright catalog environment with clean grids, real material detail and consistent product identity.','A slow lateral dolly reveals a connected catalog set, then cranes slightly.','One small catalog heading and one optional item label.'],
 ['m9','Continuous Action','Quy trình liên tục','05-continuous-action.jpg','A single connected world in which one object initiates a logical chain of actions.','Follow the same object continuously through a motivated push-through.','Sparse captions anchored to the relevant action, no slide transitions.'],
 ['m10','Cartoon Collage','Giáo dục và cắt dán','11-cartoon-collage.jpg','An original mixed-paper cartoon collage with consistent character shapes, visible paper edges and tactile depth.','A low orbit follows the character while foreground paper creates natural occlusions.','One short cut-paper title with hand-set rhythm and optional support line.'],
 ['m11','Vintage Sketch','Lịch sử và phác thảo','10-vintage-sketch.jpg','A coherent vintage ink-sketch world on warm archival paper; original linework grows into a spatial scene.','A slow overhead crane descends into a shallow tracking move along the drawing.','One carefully inked title; preserve Vietnamese accents and supplied facts.'],
 ['m12','Cartoon Stage','Câu chuyện hoạt hình','06-cartoon-stage.jpg','A dimensional cartoon theater with a consistent protagonist, physical props and restrained stage lighting.','A smooth stage dolly transitions into a gentle orbit without changing protagonist.','A short theatrical title enters as a physical stage element, at most two text layers.']
].map(([id,name,description,poster,look,camera,text])=>({id,name,description,poster:'/assets/motion-styles/'+poster,look,camera,text}));
export function motionStyleDirection(id,duration){
 if(!id)return'';
 const style=MOTION_STYLES.find(s=>s.id===id);if(!style)throw Error('Phong cách Motion không tồn tại.');
 if(![5,10].includes(Number(duration)))throw Error('Motion chỉ hỗ trợ 5 hoặc 10 giây.');
 // 5 seconds = exactly one scene. 10 seconds = exactly two connected 5s scenes.
 const timing=Number(duration)===5?'One continuous scene, 0–5 seconds. Establish, develop one action, then settle.':'Two connected scenes: 0–5 seconds establishes the hero and one action; 5–10 seconds follows that same action into a payoff. Transition smoothly through motivated camera motion or physical occlusion; preserve the same world and protagonist.';
 return['MOPIX MOTION STYLE: '+style.name,style.look,'CAMERA: '+style.camera,'TYPOGRAPHY: '+style.text,timing,'CONTINUITY: One connected world, consistent protagonist and source identity. Real camera translation with parallax, not a sequence of static slides. At most two text layers in each scene. Render only explicitly requested text with complete, exact Vietnamese accents. If no wording is supplied, omit text. Never invent facts, percentages, logos or endorsements. These instructions override generic no-text instructions only for text explicitly requested by the user.'].join('\n');
}
export function createMotionStylePicker(React){
 const{createElement:h,useState:S,useRef:R,useEffect:E}=React;
 return function MotionStylePicker({value,onChange,disabled=false}){
  const[open,O]=S(false),dialog=R(null),active=MOTION_STYLES.find(s=>s.id===value);
  E(()=>{if(open)dialog.current?.showModal()},[open]);
  return h('div',{className:'mopix-motion-style-picker'},
   h('button',{type:'button','aria-label':'Phong cách Motion',title:active?.name||'Phong cách Motion',disabled,onClick:()=>O(true)},h('svg',{width:20,height:20,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:1.5,'aria-hidden':true},h('path',{d:'m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5'})),h('span',null,active?.name||'Phong cách Motion')),
   open&&h('dialog',{ref:dialog,className:'mopix-options-modal mopix-motion-style-dialog','aria-label':'12 phong cách Motion',onCancel:()=>O(false),onClick:e=>{if(e.target===e.currentTarget)O(false)}},h('section',null,
    h('header',null,h('h2',null,'Phong cách Motion'),h('button',{type:'button','aria-label':'Đóng phong cách Motion',onClick:()=>O(false)},'×')),
    h('p',null,'Công thức prompt và camera · 5s / 10s'),
    h('div',{className:'mopix-motion-style-grid'},...MOTION_STYLES.map(s=>h('button',{key:s.id,type:'button','aria-label':s.name,'aria-pressed':value===s.id,onClick:()=>{onChange(s.id);O(false)}},h('img',{src:s.poster,alt:'',loading:'lazy'}),h('span',null,h('strong',null,s.name),h('small',null,s.description))))),
    h('footer',null,h('small',null,'Poster: Miushare / Bang Motion'),h('button',{type:'button',onClick:()=>{onChange('');O(false)}},'Bỏ phong cách')))));
 };
}
