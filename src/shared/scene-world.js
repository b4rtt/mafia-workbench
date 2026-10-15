import { Matrix4, Quaternion, Vector3 } from 'three';

const key = name => name?.normalize('NFC').toLowerCase();
export function frameMatrix(frame) {
  const rotation=frame.rotation??[1,0,0,0];
  if(rotation.length!==4||rotation.some(n=>!Number.isFinite(n))||Math.hypot(...rotation)<1e-8)throw new Error('Kolize: neplatná rotace frame.');
  if([frame.position??[0,0,0],frame.scale??[1,1,1]].some(values=>values.length!==3||values.some(n=>!Number.isFinite(n))))throw new Error('Kolize: neplatná transformace frame.');
  return new Matrix4().compose(new Vector3(...(frame.position??[0,0,0])),new Quaternion(-rotation[1],-rotation[2],-rotation[3],rotation[0]).normalize(),new Vector3(...(frame.scale??[1,1,1])));
}

export function sceneWorld(scene, geometry) {
  const byName=new Map();
  for(const frame of geometry.meshes){const name=key(frame.name),list=byName.get(name)??[];list.push({frame,geometry:true});byName.set(name,list);}
  for(const frame of scene.objects){const name=key(frame.name),list=byName.get(name)??[];list.push({frame,geometry:false});byName.set(name,list);}
  const resolveName=name=>{
    const list=byName.get(key(name))??[],base=list.filter(item=>item.geometry),overrides=list.filter(item=>!item.geometry);
    if(base.length>1||overrides.length>1||!list.length)throw new Error(`Kolize: chybějící nebo nejednoznačný rodič ${name}.`);
    return {frame:base[0]?.frame,override:overrides[0]?.frame};
  };
  const parentOf=item=>{
    if(item.override?.parent)return ['primary sector','backdrop sector'].includes(key(item.override.parent))?null:resolveName(item.override.parent);
    if(item.frame?.parent){const parentFrame=geometry.meshes.find(mesh=>mesh.id===item.frame.parent);if(!parentFrame)throw new Error('Kolize: neplatná hierarchie geometrie.');return resolveName(parentFrame.name);}
    return null;
  };
  const world=(item,seen=new Set())=>{
    const frame=item.override??item.frame,identity=key(frame.name);if(seen.has(identity))throw new Error('Kolize: cyklická hierarchie scény.');seen.add(identity);
    const transform=frameMatrix({...item.frame,...item.override}),parent=parentOf(item);
    return parent?world(parent,seen).multiply(transform):transform;
  };
  const result=name=>world(resolveName(name));
  result.parent=name=>{const item=parentOf(resolveName(name));return item?(item.override??item.frame).name:null;};
  return result;
}
