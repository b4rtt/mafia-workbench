import { hash } from './files.js';
import { parseCollision } from './collision.js';
import { editCollision, collisionRecordGeometry } from './collision-editor.js';
import { inspectScene } from './scene.js';
import { parseFourDs } from './fourds.js';
import { geometryCollisionResolver } from './model-collision.js';
import { collisionGeometry, collisionOwnership, ownedCollisionRecords, surfaceSignature } from './scene-collision.js';

const key=name=>name.normalize('NFC').toLowerCase();
function location(project,name){
  const path=project.asset(name).path;if(!/^missions\/[^/]+\/tree\.klz$/i.test(path))throw new Error('Vyberte tree.klz mise.');
  const folder=path.slice(0,path.lastIndexOf('/'));return {path,folder,scenePath:`${folder}/scene2.bin`};
}
async function context(project,folder,parsed){
  const dependencies=new Map(),warnings=[];let scene={objects:[]},geometry={meshes:[]};
  for(const [filename,parse] of [['scene2.bin',inspectScene],['scene.4ds',bytes=>parseFourDs(bytes,true)]]){
    try{const path=project.asset(`${folder}/${filename}`).path,bytes=await project.read(path);dependencies.set(path,bytes);const value=parse(bytes);if(filename==='scene2.bin')scene=value;else geometry=value;}
    catch(error){warnings.push(`${filename}: ${error.message}`);}
  }
  try{geometry=await collisionGeometry(project,scene,geometry,parsed,dependencies);}catch(error){warnings.push(error.message);}
  const byName=new Map();
  for(const [source,list] of [['scene',scene.objects],['geometry',geometry.meshes]])for(const frame of list){const name=key(frame.name),counts=byName.get(name)??{};counts[source]=(counts[source]??0)+1;byName.set(name,counts);}
  const resolved=parsed.links.map(link=>{const counts=byName.get(key(link.name));return Boolean(counts&&Object.values(counts).every(n=>n===1));});
  const resolver=geometryCollisionResolver(scene,geometry);
  return {dependencies,warnings,resolved,resolver};
}

export async function inspectProjectCollision(project,name){
  const {path,folder,scenePath}=location(project,name),bytes=await project.read(path),parsed=parseCollision(bytes),ctx=await context(project,folder,parsed),owners=new Map(),warnings=[...ctx.warnings];let ownershipWarning;
  try{
    const ownership=collisionOwnership(project.manifest,scenePath),records=ownedCollisionRecords(parsed,ownership);
    records.forEach((record,i)=>{for(const index of ownership[i].kind==='mesh'?record.records.map(r=>r.index):[record.index])owners.set(`${ownership[i].kind==='mesh'?'triangles':'aabbs'}/${index}`,ownership[i].name);});
  }catch(error){ownershipWarning=error.message;warnings.push(ownershipWarning);}
  const unresolved=new Map(),records=[];
  for(const [array,list] of Object.entries(parsed.primitives))for(const record of list.records){
    const id=`${array}/${record.index}`,link=array==='triangles'?(record.vertices[0].link===0x7fff?null:record.vertices[0].link):record.link;
    const item={id,array,index:record.index,link,name:link===null?'Světový povrch':parsed.links[link].name,material:record.material,flags:record.flags,sort:record.sort,owner:owners.get(id)};
    for(const field of ['min','max','extentMin','extentMax','matrix','inverse','center','radius','plane','vertices'])if(record[field]!==undefined)item[field]=record[field];
    try{
      if(unresolved.has(link))throw new Error(unresolved.get(link));
      item.geometry=collisionRecordGeometry(parsed,array,record,ctx.resolver);
      if(['spheres','cylinders'].includes(array)&&(!Number.isFinite(record.radius)||record.radius<=0))throw new Error('Kolize má neplatný původní poloměr.');
      if(!item.geometry.unboundedY&&[...item.geometry.min,...item.geometry.max].some(n=>!Number.isFinite(n)))throw new Error('Kolize má neplatné původní souřadnice.');
      if(array==='triangles')item.points=item.geometry.points;
    }catch(error){item.warning=error.message;if(array==='triangles'&&link!==null)unresolved.set(link,error.message);}
    records.push(item);
  }
  const unavailable=records.filter(record=>record.warning).length;if(unavailable)warnings.unshift(`${unavailable} kolizí nemá platný 3D náhled. Metadata lze upravit; původní data zůstávají zachovaná.`);
  for(const [link,error] of unresolved)warnings.push(`${parsed.links[link].name}: ${error}`);
  return {type:'collision',path,size:bytes.length,sha256:hash(bytes),records,links:parsed.links.map(link=>({index:link.index,name:link.name,type:link.type,resolved:ctx.resolved[link.index]})),grid:{minX:parsed.grid.minX,minZ:parsed.grid.minZ,maxX:parsed.grid.maxX,maxZ:parsed.grid.maxZ,width:parsed.grid.width,length:parsed.grid.length,cellWidth:parsed.grid.cellWidth,cellLength:parsed.grid.cellLength},counts:Object.fromEntries(Object.entries(parsed.primitives).map(([name,array])=>[name,array.count])),dependencyHashes:Object.fromEntries([...ctx.dependencies].map(([path,bytes])=>[path,hash(bytes)])),warnings,ownershipWarning};
}

// Manual collision transactions preserve unrelated generator ownership. A
// changed generated collider becomes independent explicitly, so subsequent
// scene edits cannot overwrite the user's manually edited shape/material.
export async function saveProjectCollision(project,name,operations,expectedHash,dependencyHashes={},options={}){
  const {path,folder,scenePath}=location(project,name),before=await project.read(path);
  if(hash(before)!==expectedHash)throw new Error('Kolize se od otevření změnily. Otevřete je znovu.');
  const parsed=parseCollision(before),ownership=collisionOwnership(project.manifest,scenePath),owned=ownedCollisionRecords(parsed,ownership),files=[{path,data:null,expectedHash}];
  if(!Array.isArray(operations))throw new Error('Neplatný seznam změn kolizí.');
  const needsContext=operations.some(op=>op?.kind!=='delete'&&(op?.kind==='add'||Object.keys(op?.changes??{}).some(k=>!['material','flags'].includes(k))));let ctx;
  if(needsContext){
    ctx=await context(project,folder,parsed);
    for(const [path,data] of ctx.dependencies){const expected=dependencyHashes?.[path];if(expected!==hash(data))throw new Error('Geometrie nebo scéna se od otevření kolizí změnila. Otevřete editor znovu.');files.push({path,data,expectedHash:expected});}
    for(const op of operations)if(op?.array!=='triangles'&&op?.kind!=='delete'&&(op?.kind==='add'||op.changes?.link!==undefined)){
      const link=op.changes?.link??parsed.primitives[op.array]?.records[op.index]?.link;
      if(op.kind==='add'||link!==parsed.primitives[op.array]?.records[op.index]?.link)if(!ctx.resolved[link])throw new Error('Kolize vyžaduje jednoznačný existující frame mise.');
    }
  }
  const result=editCollision(before,operations,{resolveFrame:ctx?.resolver}),revised=parseCollision(result.bytes),next=[],detached=[];
  ownership.forEach((owner,i)=>{
    if(owner.kind==='mesh'){
      const indices=owned[i].records.map(record=>result.mappings.triangles[record.index]),group={...owner,triangleStart:indices[0]};
      if(indices.some((index,n)=>index===null||index!==indices[0]+n)||surfaceSignature(revised,group)!==owner.signature){detached.push(owner.name);return;}
      next.push(group);
    }else{
      const index=result.mappings.aabbs[owned[i].index];if(index===null||hash(revised.primitives.aabbs.records[index].raw)!==owner.signature){detached.push(owner.name);return;}next.push({...owner,boxIndex:index});
    }
  });
  if(detached.length&&options.detachGenerated!==true)throw new Error(`Ruční změna odpojí automatický přepočet kolize modelu: ${detached.join(', ')}.`);
  ownedCollisionRecords(revised,next);files[0].data=result.bytes;
  await project.changeBatch(files,'Ruční úprava kolizí mise',{path:project.index.get(key(scenePath))?.path??scenePath,objects:next});
  return {mappings:result.mappings,added:result.added,detached};
}
