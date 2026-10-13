import {parseFourDs} from './fourds.js';
import {geometryPreview} from '../shared/geometry-draft.js';

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
  const context=inspectModelGeometry(source,request?.mesh);
  if(!Array.isArray(request.levels)||request.levels.length>context.mesh.lods.length)throw new Error('4DS: neplatný seznam LOD.');
  const result=Buffer.from(source),seen=new Set();
  for(const level of request.levels){if(!level||seen.has(level.lod))throw new Error('4DS: neplatný nebo opakovaný LOD.');seen.add(level.lod);editLevel(result,context,level);}
  parseFourDs(result,'all');return result;
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
    const value=preview[array][change.index*count+component],at=lod.vertexOffset+change.index*32+offset+component*4;
    // Skip identical f32 values, including signed zero. Preview fallbacks must
    // never silently serialize unused NaN/Inf fields unless explicitly edited.
    if(!Object.is(value,result.readFloatLE(at)))result.writeFloatLE(value,at);
  }
  if(request.recomputeNormals)for(let i=0;i<preview.normals.length;i++){const at=lod.vertexOffset+Math.floor(i/3)*32+12+i%3*4;if(!Object.is(preview.normals[i],result.readFloatLE(at)))result.writeFloatLE(preview.normals[i],at);}
}
