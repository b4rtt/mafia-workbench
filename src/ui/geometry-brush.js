import * as THREE from 'three';

// Capture only left-button brush input; OrbitControls keeps right-button pan
// and wheel zoom. This hook exists solely inside the geometry dialog.
export function geometryBrush(view,mesh,{options,begin,apply,end,error}) {
  const canvas=view.renderer.domElement,material=new THREE.LineBasicMaterial({color:0x5ed7ff,depthTest:false}),geometry=new THREE.BufferGeometry(),circle=new THREE.LineLoop(geometry,material);
  const originalLabel=canvas.getAttribute('aria-label');
  circle.raycast=()=>{};circle.renderOrder=8;circle.visible=false;view.root.add(circle);view.materials.add(material);
  let stroke=null,disposed=false;
  const hitAt=event=>{view.surfaceAt(event);const hit=view.raycaster.intersectObject(mesh,false)[0];return hit?mesh.worldToLocal(hit.point.clone()).toArray():null;};
  function settings(){try{return options();}catch(e){error(e.message);return null;}}
  function indicator(point,settings){
    circle.visible=Boolean(point&&settings);if(!circle.visible)return;
    const positions=[];for(let i=0;i<64;i++){const angle=i*Math.PI/32;positions.push(point[0]+Math.cos(angle)*settings.radius,point[1]+.01,point[2]+Math.sin(angle)*settings.radius);}
    circle.geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));circle.geometry.computeBoundingSphere();
  }
  const consume=event=>{event.preventDefault();event.stopImmediatePropagation();view.start=null;};
  function down(event){
    if(event.button!==0||!options.active())return;consume(event);
    const config=settings(),point=config?hitAt(event):null;indicator(point,config);if(!point)return;
    stroke={id:event.pointerId,last:point,config};begin();canvas.setPointerCapture(event.pointerId);apply([point[0],point[2]],config);
  }
  function move(event){
    if(!options.active())return;
    const config=stroke?.config??settings(),point=config?hitAt(event):null;indicator(point,config);
    if(!stroke||event.pointerId!==stroke.id)return;consume(event);if(!point)return;
    const distance=Math.hypot(point[0]-stroke.last[0],point[2]-stroke.last[2]),spacing=config.radius*.15;
    // Fixed spatial spacing prevents a fast drag from leaving gaps. Keeping
    // the last applied position also prevents stationary moves accumulating.
    const count=Math.floor(distance/spacing),last=stroke.last;
    if(count>512){stroke.last=point;error('Tah překročil 512 otisků. Pro takovou vzdálenost zvětšete poloměr štětce.');return;}
    for(let i=1;i<=count;i++){const t=i*spacing/distance;apply([last[0]+(point[0]-last[0])*t,last[2]+(point[2]-last[2])*t],config);}
    if(count){const t=count*spacing/distance;stroke.last=last.map((value,i)=>value+(point[i]-value)*t);}
  }
  function finish(event){if(!stroke||event.pointerId!==stroke.id)return;consume(event);const id=stroke.id;stroke=null;end();if(canvas.hasPointerCapture(id))canvas.releasePointerCapture(id);}
  function leave(){if(!stroke)circle.visible=false;}
  for(const [name,listener]of [['pointerdown',down],['pointermove',move],['pointerup',finish],['pointercancel',finish],['lostpointercapture',finish],['pointerleave',leave]])canvas.addEventListener(name,listener,true);
  return {
    update(){circle.visible=false;const active=options.active();canvas.style.cursor=active?'crosshair':'';canvas.setAttribute('aria-label',active?'3D štětec terénu: levé tlačítko kreslí, pravé posouvá, kolečko přibližuje':originalLabel);},
    dispose(){if(disposed)return;disposed=true;if(stroke){const id=stroke.id;stroke=null;end();if(canvas.hasPointerCapture(id))canvas.releasePointerCapture(id);}for(const [name,listener]of [['pointerdown',down],['pointermove',move],['pointerup',finish],['pointercancel',finish],['lostpointercapture',finish],['pointerleave',leave]])canvas.removeEventListener(name,listener,true);circle.removeFromParent();geometry.dispose();material.dispose();view.materials.delete(material);canvas.style.cursor='';}
  };
}
