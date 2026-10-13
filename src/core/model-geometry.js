import {parseFourDs} from './fourds.js';
import {geometryPreview,topologyPreview,validateTopology} from '../shared/geometry-draft.js';

function resolve(parsed,id){
  if(!Number.isInteger(id)||!parsed.meshes[id-1])throw new Error('4DS: neplatný objekt geometrie.');
  let mesh=parsed.meshes[id-1];const seen=new Set();
  while(mesh.instance){if(seen.has(mesh.id)||!parsed.meshes[mesh.instance-1])throw new Error('4DS: neplatná instance geometrie.');seen.add(mesh.id);mesh=parsed.meshes[mesh.instance-1];}
  if(mesh.type!==1||!mesh.lods?.length)throw new Error('4DS: objekt nemá editovatelnou geometrii.');return mesh;
}
export function inspectModelGeometry(source,id){
  const parsed=parseFourDs(source,'all'),mesh=resolve(parsed,id),instances=[];
  for(const candidate of parsed.meshes){if(candidate.type!==1||(!candidate.instance&&!candidate.lods?.length))continue;try{if(resolve(parsed,candidate.id).id===mesh.id)instances.push({id:candidate.id,name:candidate.name});}catch{/* Unrelated unsupported instances are not edited. */}}
  return {mesh,instances,materials:parsed.materials,editShape:[0,1].includes(mesh.visual)};
}
export function editModelGeometry(source,request){
  source=Buffer.from(source);
  const context=inspectModelGeometry(source,request?.mesh);
  if(!Array.isArray(request.levels)||request.levels.length>context.mesh.lods.length)throw new Error('4DS: neplatný seznam LOD.');
  let result=Buffer.from(source);const seen=new Set();
  for(const level of request.levels){if(!level||!Number.isInteger(level.lod)||!context.mesh.lods[level.lod]||seen.has(level.lod))throw new Error('4DS: neplatný nebo opakovaný LOD.');seen.add(level.lod);}
  // Resize from the end so earlier original offsets stay valid. Opaque frame,
  // material, instance and other LOD bytes are never regenerated.
  for(const level of [...request.levels].sort((a,b)=>b.lod-a.lod)){
    let local=context;const lod=context.mesh.lods[level.lod];
    if(Object.hasOwn(level,'topology')){
      if(!context.editShape)throw new Error('4DS: změna topologie skinovaných/morfovaných modelů zatím není podporovaná.');
      validateTopology(lod,level.topology,context.materials.length);
      const replacement=serializeTopology(source,lod,level.topology);
      result=Buffer.concat([result.subarray(0,lod.vertexOffset-2),replacement,result.subarray(lod.endOffset)]);
      const lods=[...context.mesh.lods];lods[level.lod]={...topologyPreview(lod,level.topology),vertexOffset:lod.vertexOffset};local={...context,mesh:{...context.mesh,lods}};
    }
    editLevel(result,local,level);
  }
  parseFourDs(result,'all');return result;
}
function serializeTopology(source,lod,topology){
  const size=2+topology.vertices.length*32+1+topology.faces.reduce((size,face)=>size+4+face.indices.length*2,0),bytes=Buffer.alloc(size);let at=0;
  bytes.writeUInt16LE(topology.vertices.length,at);at+=2;
  for(const vertex of topology.vertices){
    if(Object.hasOwn(vertex,'source'))source.copy(bytes,at,lod.vertexOffset+vertex.source*32,lod.vertexOffset+(vertex.source+1)*32);
    else [...vertex.position,...vertex.normal,...vertex.uv].forEach((value,i)=>bytes.writeFloatLE(value,at+i*4));
    at+=32;
  }
  bytes.writeUInt8(topology.faces.length,at++);
  for(const face of topology.faces){bytes.writeUInt16LE(face.indices.length/3,at);at+=2;for(const index of face.indices){bytes.writeUInt16LE(index,at);at+=2;}bytes.writeUInt16LE(face.material,at);at+=2;}
  return bytes;
}
function editLevel(result,{mesh,editShape},request){
  const lod=mesh.lods[request.lod];
  if(!Number.isInteger(request.lod)||!lod||!Array.isArray(request.vertices)||request.vertices.length>lod.vertices||typeof request.recomputeNormals!=='boolean')throw new Error('4DS: neplatné úpravy geometrie.');
  if(request.recomputeNormals&&!editShape)throw new Error('4DS: přepočet normál animovaných/morfovaných modelů zatím není podporovaný.');
  const seen=new Set();
  for(const change of request.vertices){
    if(!change||!Number.isInteger(change.index)||change.index<0||change.index>=lod.vertices||seen.has(change.index)||Object.keys(change).some(key=>!['index','position','normal','uv'].includes(key)))throw new Error('4DS: neplatný nebo opakovaný vrchol.');seen.add(change.index);
    if(!editShape&&(change.position||change.normal))throw new Error('4DS: tento typ podporuje zatím pouze úpravu UV; váhy a morfované pozice musí zůstat zachované.');
    if(request.recomputeNormals&&change.normal)throw new Error('4DS: ruční normály nelze kombinovat s přepočtem.');
    for(const [field,count]of [['position',3],['normal',3],['uv',2]])if(Object.hasOwn(change,field)&&(!Array.isArray(change[field])||change[field].length!==count||!Array.from(change[field]).every(value=>typeof value==='number'&&Number.isFinite(value)&&Number.isFinite(Math.fround(value)))))throw new Error('4DS: neplatné souřadnice vrcholu.');
  }
  const preview=geometryPreview(lod,request.vertices,request.recomputeNormals);
  for(const change of request.vertices)for(const [key,array,count,offset]of [['position','positions',3,0],['normal','normals',3,12],['uv','uv',2,24]])if(change[key])for(let component=0;component<count;component++){
    const value=Math.fround(change[key][component]),at=lod.vertexOffset+change.index*32+offset+component*4;
    // Skip identical f32 values, including signed zero. Preview fallbacks must
    // never silently serialize unused NaN/Inf fields unless explicitly edited.
    if(!Object.is(value,result.readFloatLE(at)))result.writeFloatLE(value,at);
  }
  if(request.recomputeNormals)for(let i=0;i<preview.normals.length;i++){const at=lod.vertexOffset+Math.floor(i/3)*32+12+i%3*4;if(!Object.is(preview.normals[i],result.readFloatLE(at)))result.writeFloatLE(preview.normals[i],at);}
}
