import{makeNode,connectNodes,NODE_WIDTH}from'./mopix-node-graph.js';
import{MOTION_STYLES}from'./mopix-motion-styles.js';
import{CANVAS_PRESETS,canvasPresetDirection}from'./mopix-canvas-options.js';
// Templates append to the current canvas and preserve every existing node/job.
export function appendMotionTemplate(graph,patch,selectedId){
 if(graph.nodes.length>37)throw Error('Canvas cần chỗ cho 3 node mới. Tối đa 40 node.');
 const selected=graph.nodes.find(n=>n.id===selectedId),style=MOTION_STYLES.find(s=>s.id===patch.style),preset=CANVAS_PRESETS.find(p=>p.id===patch.preset);
 if(!style&&!preset)throw Error('Chọn một phong cách hoặc chuyển động.');
 const label=style?.name||preset.label,direction=style?.description||preset.direction;
 const input=selected?.kind==='image'?selected:graph.nodes.find(n=>n.kind==='image'&&graph.edges.some(e=>e.from===n.id&&e.to===selectedId));
 const brief=selected?.prompt?.trim()||'A carefully composed product scene with one clear subject, believable materials and controlled studio lighting.';
 const y=graph.nodes.length?Math.max(...graph.nodes.map(n=>n.y))+300:80;
 const idea=makeNode('text',40,y),image=makeNode('image',40+NODE_WIDTH+70,y),video=makeNode('video',40+2*(NODE_WIDTH+70),y);
 idea.title=label+' · Ý tưởng';idea.prompt=brief;
 image.title=label+' · Ảnh nguồn';image.prompt='Create one finished reference image for this creative brief. Establish a single coherent subject and scene, clear composition and realistic materials. No comparison, collage or unrequested text.\n\n'+brief;
 image.ratio=video.ratio=selected?.ratio||'16:9';if(input?.asset)image.asset={...input.asset};
 video.title=label+' · Video';video.prompt='Animate @image1 as one continuous scene. Preserve the exact subject identity, geometry, colors and composition. '+(direction||'Use restrained, physically plausible movement.')+'\n\n'+brief;video.duration=selected?.duration===10?10:5;Object.assign(video,patch);
 let next={...graph,nodes:[...graph.nodes,idea,image,video],edges:[...graph.edges]};
 next=connectNodes(next,idea.id,image.id);next=connectNodes(next,image.id,video.id);next=connectNodes(next,idea.id,video.id);
 return{graph:next,selected:video.id,videoId:video.id,label};
}
