import {parseFourDs} from '../../core/fourds.js';
import {modelCollisionBox,modelCollisionSurface} from '../../core/model-collision.js';
import {hash} from '../../core/files.js';

// Audited original urban houses, not a name/size guess over every game model.
// The models and their textures remain in the user's project.
export const osmBuildingModelPaths=Object.freeze(['3rad02','3rad03','3rad05','3rad06','3rad08','9dum6r','%radovk18','%radovk34','%radovk5','%radovk9','%radovk10','%radovk30','#rad022','%hotelv4','dum01','newdum8'].map(name=>`models/${name}.4ds`));
export async function loadOsmBuildingModels(project,paths=osmBuildingModelPaths){
  if(!Array.isArray(paths)||!paths.length||paths.length>16||new Set(paths.map(p=>typeof p==='string'?p.toLowerCase():p)).size!==paths.length||paths.some(p=>typeof p!=='string'||!/^models\/[\x20-\x7e]+\.4ds$/i.test(p)||/[\\/:*?"<>|]/.test(p.slice(7))))throw Error('OpenStreetMap · budovy: vyberte 1–16 modelů ze složky models.');
  const models=[],warnings=[],loaded=new Map();
  for(const path of paths){
    try{
      const asset=project.asset(path),bytes=await project.read(asset.path),model=parseFourDs(bytes,true),object={name:'OSM_BUILDING',frameType:9,model:asset.path,position:[0,0,0],rotation:[1,0,0,0],scale:[1,1,1]},scene={objects:[object]},geometry={meshes:[]};
      const bounds=modelCollisionBox(model,object,scene,geometry),collision=modelCollisionSurface(model,object,scene,geometry);
      if(model.meshes.some(m=>m.type===5||m.visual===2)||bounds.min[1]<-3||bounds.max[1]<5)throw Error('model vyžaduje jiné usazení nebo obsahuje pohyblivé části.');
      for(const m of model.materials)for(const texture of [m.texture,m.alphaTexture,m.environmentTexture].filter(Boolean))project.asset('maps/'+texture);
      const item={path:asset.path,sha256:hash(bytes),min:bounds.min,max:bounds.max,vertices:collision.positions.length/3,triangles:collision.indices.length/3};models.push(item);loaded.set(asset.path.toLowerCase(),model);
    }catch(error){warnings.push(`${path}: ${error.message}`);}
  }
  return {models,warnings,loaded};
}
