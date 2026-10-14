// 4DS stores absolute local positions/normals per region, vertex and target.
// Regions write in order; later regions replace overlapping vertices. Deform
// before skinning and keep an independent buffer for every displayed instance.
export function bindMorph(mesh, morph) {
  const regions=morph?.lods?.[0],position=mesh.geometry.getAttribute('position'),normal=mesh.geometry.getAttribute('normal');
  if(!regions?.length||!position||!normal||regions.some(r=>r.valid===false||r.indices.some(i=>!Number.isInteger(i)||i<0||i>=position.count)||r.targets.some(t=>t.positions.length!==r.indices.length*3||t.normals.length!==r.indices.length*3||[...t.positions,...t.normals].some(n=>!Number.isFinite(n)))))return null;
  mesh.geometry=mesh.geometry.clone();const geometry=mesh.geometry,positions=geometry.getAttribute('position'),normals=geometry.getAttribute('normal'),restPosition=positions.array.slice(),restNormal=normals.array.slice();let previous='rest';
  return {regions,targets:morph.targets,apply(weights=null){
    if(weights&&regions.some((r,i)=>r.indices.length&&weights[i]&&(weights[i].length!==r.targets.length||weights[i].some(n=>!Number.isFinite(n)||n<0))))throw Error('Morfování: neplatné váhy náhledu.');
    const signature=JSON.stringify(weights);if(signature===previous)return;previous=signature;
    positions.array.set(restPosition);normals.array.set(restNormal);
    if(weights)for(let channel=0;channel<regions.length;channel++){
      const region=regions[channel],mix=weights[channel];if(!mix||!region.indices.length)continue;
      for(let vertex=0;vertex<region.indices.length;vertex++)for(let axis=0;axis<3;axis++){
        let p=0,n=0;for(let target=0;target<mix.length;target++){p+=region.targets[target].positions[vertex*3+axis]*mix[target];n+=region.targets[target].normals[vertex*3+axis]*mix[target];}
        const at=region.indices[vertex]*3+axis;positions.array[at]=p;normals.array[at]=n;
      }
    }
    positions.needsUpdate=true;normals.needsUpdate=true;geometry.computeBoundingBox();geometry.computeBoundingSphere();
  }};
}

// PC speech_channel_set_human seeds the same three-region mix as PS2
// DabingTick. DAT sampling is discrete; engine fade-in/out is not simulated.
export function lipWeights(values) {
  if(!Array.isArray(values)||values.length!==6||values.some(n=>!Number.isInteger(n)||n<0||n>255))return null;
  const[b,a,c,e,d,f]=values.map(n=>n/255);
  return [[0,b*a,b*(1-a),(1-c)*(1-b),c*(1-b)],[0,d*e,d*(1-e),1-d,0],[0,d*f,d*(1-f),1-d,0]];
}
export function sampleLip(frames,time) {
  if(!frames?.length||!Number.isFinite(time)||time<0)return null;
  return frames[Math.min(Math.floor(time/40),Math.max(0,frames.length-2))]?.values??null;
}
export function applyLip(root,values) {
  const weights=lipWeights(values);let applied=0;
  root.traverse(object=>{const morph=object.userData.morph;if(object.name.toLowerCase()==='base'&&object.userData.frame?.visual===3&&morph?.regions.length===3&&morph.targets===5){morph.apply(weights);applied++;}});
  return applied;
}
