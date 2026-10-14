import { Box3, Matrix4, Quaternion, Vector3 } from 'three';

const key = name => name?.normalize('NFC').toLowerCase();
function matrix(frame) {
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
  const world=(item,seen=new Set())=>{
    const frame=item.override??item.frame,identity=key(frame.name);if(seen.has(identity))throw new Error('Kolize: cyklická hierarchie scény.');seen.add(identity);
    const transform=matrix({...item.frame,...item.override});let parent;
    if(item.override?.parent){if(!['primary sector','backdrop sector'].includes(key(item.override.parent)))parent=resolveName(item.override.parent);}
    else if(item.frame?.parent){const parentFrame=geometry.meshes.find(mesh=>mesh.id===item.frame.parent);if(!parentFrame)throw new Error('Kolize: neplatná hierarchie geometrie.');parent=resolveName(parentFrame.name);}
    return parent?world(parent,seen).multiply(transform):transform;
  };
  return name=>world(resolveName(name));
}

// Native LS3D coordinates: the viewport's Z reflection is intentionally absent.
function modelCollisionGeometry(model, object, scene, geometry, surface) {
  if(object.frameType!==9||!object.model||object.actorBound)throw new Error('Kolize: vyberte samostatný statický model bez aktéra.');
  if(model.meshes.some(mesh=>mesh.type===10||mesh.skin?.length||[3,5].includes(mesh.visual)))throw new Error('Kolize: animovaný model potřebuje dynamické kolize aktéra.');
  const root=sceneWorld(scene,geometry)(object.name),worlds=new Map(),enabled=new Map();
  const meshWorld=(mesh,seen=new Set())=>{
    if(worlds.has(mesh.id))return worlds.get(mesh.id);if(seen.has(mesh.id))throw new Error('Kolize: cyklická hierarchie modelu.');seen.add(mesh.id);
    const parent=mesh.parent?model.meshes.find(m=>m.id===mesh.parent):null;if(mesh.parent&&!parent)throw new Error('Kolize: chybějící rodič modelu.');
    const result=(parent?meshWorld(parent,seen):root.clone()).clone().multiply(matrix(mesh));worlds.set(mesh.id,result);
    enabled.set(mesh.id,(parent?enabled.get(parent.id):true)&&(mesh.culling===undefined||Boolean(mesh.culling&1)));return result;
  };
  const lod=(mesh,seen=new Set())=>{if(seen.has(mesh.id))throw new Error('Kolize: cyklická instance modelu.');seen.add(mesh.id);if(mesh.instance){const source=model.meshes[mesh.instance-1];if(!source)throw new Error('Kolize: chybějící instance modelu.');return lod(source,seen);}return mesh.lods?.[0];};
  const bounds=new Box3(),point=new Vector3(),positions=[],faces=[],unique=new Map();let vertices=0,degenerate=0;
  for(const mesh of model.meshes){
    const transform=meshWorld(mesh);if(mesh.type!==1||!enabled.get(mesh.id)||(mesh.renderFlags&0x40)||/(?:^|\s)SECT(?:\s|$)/i.test(mesh.properties??''))continue;
    if(mesh.skin?.length)throw new Error('Kolize: skinovaný model potřebuje dynamické kolize aktéra.');
    const data=lod(mesh);if(!data?.positions?.length)continue;
    const indices=new Set(data.faces.flatMap(face=>face.indices)),mapped=new Map();
    for(const index of indices){if(!Number.isInteger(index)||index<0||index*3+2>=data.positions.length)throw new Error('Kolize: neplatný vertex modelu.');point.fromArray(data.positions,index*3).applyMatrix4(transform);if(point.toArray().some(n=>!Number.isFinite(n)))throw new Error('Kolize: neplatné světové souřadnice modelu.');bounds.expandByPoint(point);vertices++;
      if(surface){const values=point.toArray().map(Math.fround);if(values.some(n=>!Number.isFinite(n)))throw new Error('Kolize: světové souřadnice přesahují float32.');const key=values.join(',');let vertex=unique.get(key);if(vertex===undefined){vertex=positions.length/3;unique.set(key,vertex);positions.push(...values);}mapped.set(index,vertex);}
    }
    if(surface){
      if(mesh.visual===2)throw new Error('Kolize: billboard potřebuje dynamické kolize aktéra.');
      for(const face of data.faces){if(face.indices.length%3)throw new Error('Kolize: neplatné trojúhelníky modelu.');for(let i=0;i<face.indices.length;i+=3){
        const triangle=face.indices.slice(i,i+3).map(index=>mapped.get(index)),a=new Vector3().fromArray(positions,triangle[0]*3),b=new Vector3().fromArray(positions,triangle[1]*3).sub(a),c=new Vector3().fromArray(positions,triangle[2]*3).sub(a);
        if(b.cross(c).length()<1e-8){degenerate++;continue;}faces.push(...triangle);
      }}
    }
  }
  if(!vertices||bounds.isEmpty())throw new Error('Kolize: model nemá viditelný povrch pro generování.');
  if(surface){if(!faces.length)throw new Error('Kolize: model nemá nedegenerovaný povrch.');return {name:object.name,positions,indices:faces,degenerate};}
  // Flat decorations need a nonzero collision thickness (2 cm).
  for(const axis of ['x','y','z'])if(bounds.max[axis]-bounds.min[axis]<.02){const center=(bounds.min[axis]+bounds.max[axis])/2;bounds.min[axis]=center-.01;bounds.max[axis]=center+.01;}
  return {name:object.name,min:bounds.min.toArray(),max:bounds.max.toArray()};
}

export function modelCollisionBox(model, object, scene, geometry) { return modelCollisionGeometry(model,object,scene,geometry,false); }
export function modelCollisionSurface(model, object, scene, geometry) { return modelCollisionGeometry(model,object,scene,geometry,true); }

// Existing KLZ frame triangles address the first LOD's vertex buffer. These
// world coordinates are needed to merge new surfaces into the X-sorted cells.
export function geometryCollisionResolver(scene, geometry) {
  const world=sceneWorld(scene,geometry),cache=new Map();
  return (name,indices)=>{
    const keyName=key(name);let frame=cache.get(keyName);
    if(!frame){const matches=geometry.meshes.filter(m=>key(m.name)===keyName);if(matches.length!==1)throw new Error(`Kolize: původní frame ${name} není jednoznačný ve scene.4ds.`);let mesh=matches[0],seen=new Set();
      while(mesh.instance){if(seen.has(mesh.id))throw new Error('Kolize: cyklická instance geometrie.');seen.add(mesh.id);mesh=geometry.meshes[mesh.instance-1];if(!mesh)throw new Error('Kolize: chybějící instance geometrie.');}
      frame={matrix:world(name),positions:mesh.lods?.[0]?.positions};if(!frame.positions?.length)throw new Error(`Kolize: původní frame ${name} nemá vrcholy prvního LOD.`);cache.set(keyName,frame);
    }
    return indices.map(index=>{if(!Number.isInteger(index)||index<0||index*3+2>=frame.positions.length)throw new Error('Kolize: původní povrch odkazuje mimo vertex buffer.');return new Vector3().fromArray(frame.positions,index*3).applyMatrix4(frame.matrix).toArray();});
  };
}
