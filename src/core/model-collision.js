import { Box3, Matrix4, Quaternion, Vector3 } from 'three';

const key = name => name?.normalize('NFC').toLowerCase();
function matrix(frame) {
  const rotation=frame.rotation??[1,0,0,0];
  if(rotation.length!==4||rotation.some(n=>!Number.isFinite(n))||Math.hypot(...rotation)<1e-8)throw new Error('Kolize: neplatná rotace frame.');
  if([frame.position??[0,0,0],frame.scale??[1,1,1]].some(values=>values.length!==3||values.some(n=>!Number.isFinite(n))))throw new Error('Kolize: neplatná transformace frame.');
  return new Matrix4().compose(new Vector3(...(frame.position??[0,0,0])),new Quaternion(-rotation[1],-rotation[2],-rotation[3],rotation[0]).normalize(),new Vector3(...(frame.scale??[1,1,1])));
}

// Native LS3D coordinates: the viewport's Z reflection is intentionally absent.
export function modelCollisionBox(model, object, scene, geometry) {
  if(object.frameType!==9||!object.model||object.actorBound)throw new Error('Kolize: vyberte samostatný statický model bez aktéra.');
  if(model.meshes.some(mesh=>mesh.type===10||mesh.skin?.length||[3,5].includes(mesh.visual)))throw new Error('Kolize: animovaný model potřebuje dynamické kolize aktéra.');
  const byName=new Map();
  for(const frame of geometry.meshes){const name=key(frame.name),list=byName.get(name)??[];list.push({frame,geometry:true});byName.set(name,list);}
  for(const frame of scene.objects){const name=key(frame.name),list=byName.get(name)??[];list.push({frame,geometry:false});byName.set(name,list);}
  const resolveName=name=>{
    const list=byName.get(key(name))??[],base=list.filter(item=>item.geometry),overrides=list.filter(item=>!item.geometry);
    if(base.length>1||overrides.length>1||!list.length)throw new Error(`Kolize: chybějící nebo nejednoznačný rodič ${name}.`);
    return {frame:base[0]?.frame,override:overrides[0]?.frame};
  };
  const world=(item,seen=new Set())=>{
    const frame=item.override??item.frame,identity=key(frame.name);if(seen.has(identity))throw new Error('Kolize: cyklická hierarchie scény.');seen.add(identity);
    const transform=matrix({...item.frame,...item.override});let parent;
    if(item.override?.parent){if(!['primary sector','backdrop sector'].includes(key(item.override.parent)))parent=resolveName(item.override.parent);}
    else if(item.frame?.parent){const parentFrame=geometry.meshes.find(mesh=>mesh.id===item.frame.parent);if(!parentFrame)throw new Error('Kolize: neplatná hierarchie geometrie.');parent=resolveName(parentFrame.name);}
    return parent?world(parent,seen).multiply(transform):transform;
  };
  const root=world(resolveName(object.name)),worlds=new Map(),enabled=new Map();
  const meshWorld=(mesh,seen=new Set())=>{
    if(worlds.has(mesh.id))return worlds.get(mesh.id);if(seen.has(mesh.id))throw new Error('Kolize: cyklická hierarchie modelu.');seen.add(mesh.id);
    const parent=mesh.parent?model.meshes.find(m=>m.id===mesh.parent):null;if(mesh.parent&&!parent)throw new Error('Kolize: chybějící rodič modelu.');
    const result=(parent?meshWorld(parent,seen):root.clone()).clone().multiply(matrix(mesh));worlds.set(mesh.id,result);
    enabled.set(mesh.id,(parent?enabled.get(parent.id):true)&&(mesh.culling===undefined||Boolean(mesh.culling&1)));return result;
  };
  const lod=(mesh,seen=new Set())=>{if(seen.has(mesh.id))throw new Error('Kolize: cyklická instance modelu.');seen.add(mesh.id);if(mesh.instance){const source=model.meshes[mesh.instance-1];if(!source)throw new Error('Kolize: chybějící instance modelu.');return lod(source,seen);}return mesh.lods?.[0];};
  const bounds=new Box3(),point=new Vector3();let vertices=0;
  for(const mesh of model.meshes){
    const transform=meshWorld(mesh);if(mesh.type!==1||!enabled.get(mesh.id)||(mesh.renderFlags&0x40)||/(?:^|\s)SECT(?:\s|$)/i.test(mesh.properties??''))continue;
    if(mesh.skin?.length)throw new Error('Kolize: skinovaný model potřebuje dynamické kolize aktéra.');
    const data=lod(mesh);if(!data?.positions?.length)continue;
    const indices=new Set(data.faces.flatMap(face=>face.indices));
    for(const index of indices){if(!Number.isInteger(index)||index<0||index*3+2>=data.positions.length)throw new Error('Kolize: neplatný vertex modelu.');point.fromArray(data.positions,index*3).applyMatrix4(transform);if(point.toArray().some(n=>!Number.isFinite(n)))throw new Error('Kolize: neplatné světové souřadnice modelu.');bounds.expandByPoint(point);vertices++;}
  }
  if(!vertices||bounds.isEmpty())throw new Error('Kolize: model nemá viditelný povrch pro generování.');
  // Flat decorations need a nonzero collision thickness (2 cm).
  for(const axis of ['x','y','z'])if(bounds.max[axis]-bounds.min[axis]<.02){const center=(bounds.min[axis]+bounds.max[axis])/2;bounds.min[axis]=center-.01;bounds.max[axis]=center+.01;}
  return {name:object.name,min:bounds.min.toArray(),max:bounds.max.toArray()};
}
