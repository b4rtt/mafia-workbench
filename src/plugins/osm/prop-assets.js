import {parseFourDs} from '../../core/fourds.js';
import {parseBmp} from '../../core/bmp.js';
import {modelCollisionBox,modelCollisionSurface} from '../../core/model-collision.js';
import {hash} from '../../core/files.js';

// Audited freestanding original assets. Nothing from the game is distributed.
export const osmPropModels=Object.freeze([
  {kind:'tree',leaf:'broadleaved',path:'models/TH_strom01.4ds',label:'Listnatý strom'},
  {kind:'tree',leaf:'broadleaved',path:'models/strom4.4ds',label:'Velký listnatý strom'},
  {kind:'tree',leaf:'needleleaved',path:'models/s_smrk1.4ds',label:'Smrk'},
  {kind:'bench',path:'models/xlavicka.4ds',label:'Dřevěná lavička'},
  {kind:'bin',path:'models/kos01.4ds',label:'Odpadkový koš'},
  {kind:'lamp',path:'models/lamp01o.4ds',label:'Pouliční lampa'}
]);
export async function loadOsmPropModels(project,saved){
  if(saved!==undefined&&(!Array.isArray(saved)||!saved.length||saved.length>osmPropModels.length||new Set(saved.map(m=>m?.path?.toLowerCase())).size!==saved.length||saved.some(m=>!osmPropModels.some(c=>c.path.toLowerCase()===m?.path?.toLowerCase())||!/^[a-f0-9]{64}$/.test(m?.sha256??''))))throw Error('OpenStreetMap · osazení: neplatný uložený katalog.');
  const models=[],warnings=[],loaded=new Map(),dependencies=new Map();
  for(const entry of osmPropModels.filter(c=>!saved||saved.some(m=>m.path.toLowerCase()===c.path.toLowerCase()))){
    try{
      const asset=project.asset(entry.path),bytes=await project.read(asset.path),sha256=hash(bytes);
      if(saved&&saved.find(m=>m.path.toLowerCase()===asset.path.toLowerCase())?.sha256!==sha256)throw Error('Model se změnil; načtěte katalog znovu.');
      const model=parseFourDs(bytes,true),object={name:'PROP',frameType:9,model:asset.path,position:[0,0,0],rotation:[1,0,0,0],scale:[1,1,1]},scene={objects:[object]},geometry={meshes:[]},bounds=modelCollisionBox(model,object,scene,geometry),solid=modelCollisionSurface(model,object,scene,geometry,{opaqueOnly:entry.kind==='tree'});
      if(model.meshes.some(m=>m.type===5)||solid.positions.length/3>4000||bounds.max[1]-bounds.min[1]>40)throw Error('Model není vhodný samostatný statický objekt.');
      const low=[];for(let i=0;i<solid.positions.length;i+=3)if(entry.kind!=='tree'||solid.positions[i+1]<=bounds.min[1]+1)low.push(solid.positions.slice(i,i+3));
      if(!low.length)throw Error('Chybí základna modelu.');
      const min=[0,1,2].map(k=>Math.min(...low.map(p=>p[k]))),max=[0,1,2].map(k=>Math.max(...low.map(p=>p[k]))),anchor=entry.kind==='tree'?[(min[0]+max[0])/2,min[1],(min[2]+max[2])/2]:[(bounds.min[0]+bounds.max[0])/2,bounds.min[1],(bounds.min[2]+bounds.max[2])/2],textures=[];
      for(const material of model.materials)for(const name of [material.texture,material.alphaTexture,material.environmentTexture,...(material.flags&0x8000&&!(material.flags&0xa1000000)&&!material.alphaTexture&&material.texture?[material.texture.replace(/(\.[^./\\]+)$/,'+$1')]:[])].filter(Boolean)){
        const texture=project.asset('maps/'+name),data=await project.read(texture.path);parseBmp(data);const item={path:texture.path,sha256:hash(data)};textures.push(item);
      }
      const item={...entry,path:asset.path,sha256,min:bounds.min,max:bounds.max,footMin:min,footMax:max,anchor,vertices:solid.positions.length/3,triangles:solid.indices.length/3,textures:[...new Map(textures.map(t=>[t.path.toLowerCase(),t])).values()]};
      if(saved){const old=saved.find(m=>m.path.toLowerCase()===asset.path.toLowerCase());if(!Array.isArray(old.textures)||JSON.stringify(old.textures)!==JSON.stringify(item.textures))throw Error('Textury se změnily; načtěte katalog znovu.');}
      models.push(item);loaded.set(asset.path.toLowerCase(),model);for(const d of [{path:asset.path,sha256},...item.textures])dependencies.set(d.path.toLowerCase(),d);
    }catch(error){warnings.push(`${entry.path}: ${error.message}`);}
  }
  if(saved&&warnings.length)throw Error('OpenStreetMap · osazení: '+warnings.join(' '));
  return {models,warnings,loaded,dependencies:[...dependencies.values()]};
}
