export function createToolOptions(React){
 const{createElement:h,useRef:R,useState:S,useEffect:E,Children}=React;
 return function ToolOptions({className='',children}){
  const[open,O]=S(false),dialog=R(null),parts=Children.toArray(children),title=parts[0]?.props?.children;
  E(()=>{if(open&&!dialog.current.open)dialog.current.showModal()},[open]);
  return h('div',{className:className+' mopix-tool-options'},
   h('button',{type:'button',className:'mopix-options-trigger',onClick:()=>O(true)},title),
   open&&h('dialog',{ref:dialog,className:'mopix-options-modal',onCancel:()=>O(false),onClick:e=>{if(e.target===e.currentTarget)O(false)}},
    h('section',null,h('header',null,h('h2',null,title),h('button',{type:'button','aria-label':'Đóng tùy chọn',onClick:()=>O(false)},'×')),
     h('div',{className:'mopix-options-body'},...parts.slice(1)))));
 };
}
