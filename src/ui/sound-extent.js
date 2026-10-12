import * as THREE from 'three';

// Read only the selected frame's own sound block, including unsaved drafts.
export function soundExtentSettings(file, object, drafts = new Map()) {
  if(object?.frameType!==4)return null;
  const blocks=file.entries.filter(entry=>entry.soundParameter&&entry.nodeId.startsWith(`${object.id}/`));
  const unavailable=reason=>({mode:null,reason});
  if(blocks.length!==1)return unavailable('Zvuk nemá jednoznačné nastavení dosahu.');
  const entries=file.entries.filter(entry=>entry.id.startsWith(`${blocks[0].nodeId}/`));
  function read(label){const matches=entries.filter(entry=>entry.label===label);return matches.length===1?(drafts.has(matches[0].id)?drafts.get(matches[0].id):matches[0].value):undefined;}
  const type=read('Typ zvuku');
  if(type===3)return unavailable('Okolní zvuk používá sektory; poloměrový náhled se nezobrazuje.');
  if(type===4)return unavailable('Tvar objemového zvuku zatím není ověřený; hranice se nezobrazují.');
  if(![1,2,5].includes(type))return unavailable('Tento typ zvuku nemá podporovaný náhled dosahu.');
  const range=read('Dosah zvuku'),cone=read('Zvukový kužel'),finite=n=>typeof n==='number'&&Number.isFinite(n)&&Number.isFinite(Math.fround(n));
  if(!Array.isArray(range)||![2,4].includes(range.length)||!Array.from(range).every(finite)||range[0]<0||range[1]<=0||range[1]<range[0])return unavailable('Dosah zvuku má neplatné nebo neúplné hodnoty.');
  if(type===2&&(!Array.isArray(cone)||cone.length!==2||!Array.from(cone).every(finite)||cone[0]<0||cone[1]<cone[0]||cone[1]>2*Math.PI+1e-5))return unavailable('Kužel zvuku má neplatné nebo neúplné hodnoty.');
  return {mode:type===2?'cone':'sphere',range:range.slice(0,2),cone:type===2?cone.map(n=>Math.min(n,2*Math.PI)):null,reason:'Modrá: vnitřní poloměr/kužel. Oranžová: vnější poloměr/kužel. Čáry slouží k umístění zvuku; nesimulují hlasitost ani vliv sektorů.'+(type===5?' Účinek bodového okolního zvuku ve hře ještě není ověřený.':'')};
}

// Cone angles describe the full aperture; range is radial distance from the
// source. Spherical arcs avoid the flat cone distortion at wide apertures.
export function createSoundExtent(settings) {
  const group=new THREE.Group();group.name='Sound extent';
  const line=(points,color)=>{const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(points,3));const material=new THREE.LineBasicMaterial({color,transparent:true,opacity:.8,depthWrite:false});group.add(new THREE.LineSegments(geometry,material));};
  function shell(radius,angle,color){
    if(radius<=0)return;
    const points=[],steps=64,segment=(a,b)=>points.push(...a,...b);
    if(angle>=2*Math.PI-1e-5){
      for(let plane=0;plane<3;plane++)for(let i=0;i<steps;i++){
        const point=t=>{const a=radius*Math.cos(t),b=radius*Math.sin(t);return plane===0?[a,b,0]:plane===1?[a,0,b]:[0,a,b];};segment(point(i*2*Math.PI/steps),point((i+1)*2*Math.PI/steps));
      }
    }else{
      const half=angle/2,point=(theta,phi)=>[radius*Math.sin(theta)*Math.cos(phi),radius*Math.sin(theta)*Math.sin(phi),radius*Math.cos(theta)];
      for(let i=0;i<steps;i++)segment(point(half,i*2*Math.PI/steps),point(half,(i+1)*2*Math.PI/steps));
      for(let phi=0;phi<4;phi++){
        const azimuth=phi*Math.PI/2;segment([0,0,0],point(half,azimuth));
        for(let i=0;i<steps;i++)segment(point(i*half/steps,azimuth),point((i+1)*half/steps,azimuth));
      }
      segment([0,0,0],[0,0,radius]);
    }
    line(points,color);
  }
  if(settings?.mode){shell(settings.range[0],settings.mode==='cone'?settings.cone[0]:2*Math.PI,0x60a5fa);shell(settings.range[1],settings.mode==='cone'?settings.cone[1]:2*Math.PI,0xf59e0b);}
  return group;
}
