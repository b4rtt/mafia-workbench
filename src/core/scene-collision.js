import { hash } from './files.js';
import { inspectScene } from './scene.js';
import { parseFourDs } from './fourds.js';
import { parseCollision, appendCollisionBoxes } from './collision.js';
import { modelCollisionBox, modelCollisionSurface, modelCollisionFrameSurfaces, geometryCollisionResolver } from './model-collision.js';
import { replaceCollisionSurfaces, collisionTriangleVertices } from './collision-surfaces.js';

const key = name => name.normalize('NFC').toLowerCase();
export function collisionOwnership(manifest, scenePath) {
  const snapshot=manifest.history.findLast(entry=>entry.collisionOwnership&&key(entry.collisionOwnership.path)===key(scenePath));
  if(!snapshot)return [];
  const objects=snapshot.collisionOwnership.objects;
  if(!Array.isArray(objects)||objects.length>65536||objects.some(o=>!o||typeof o.name!=='string'||!o.name||!['aabb','mesh'].includes(o.kind)||o.kind==='mesh'&&(![o.triangleStart,o.triangleCount,o.vertexStart,o.vertexCount].every(Number.isInteger)||o.triangleStart<0||o.vertexStart<0||o.triangleCount<=0||(o.storage==='frame'?o.vertexCount!==0:o.vertexCount<=0)||typeof o.doubleSided!=='boolean')||!/^[0-9a-f]{64}$/.test(o.signature))||new Set(objects.map(o=>key(o.name))).size!==objects.length)throw new Error('Kolize: neplatná evidence generovaných kolizí.');
  for(const object of objects){
    if(object.storage!==undefined&&(object.kind!=='mesh'||!['world','frame'].includes(object.storage)))throw new Error('Kolize: neplatné uložení povrchu.');
    if(object.storage==='frame'){
      const parts=object.parts;let start=object.triangleStart;
      if(!Array.isArray(parts)||!parts.length||parts.length>65536)throw new Error('Kolize: neplatné části povrchu.');
      const names=new Set();
      for(const part of parts){if(!part||typeof part.frame!=='string'||!key(part.frame).startsWith(key(object.name)+'.')||names.has(key(part.frame))||part.triangleStart!==start||!Number.isInteger(part.triangleCount)||part.triangleCount<=0||!Number.isInteger(part.vertexCount)||part.vertexCount<1||part.vertexCount>65536)throw new Error('Kolize: neplatné části povrchu.');names.add(key(part.frame));start+=part.triangleCount;}
      if(start!==object.triangleStart+object.triangleCount)throw new Error('Kolize: neúplné části povrchu.');
    }else if(object.parts!==undefined)throw new Error('Kolize: neplatné části světového povrchu.');
  }
  if(objects.some(o=>o.opaqueOnly!==undefined&&(o.kind!=='mesh'||typeof o.opaqueOnly!=='boolean')))throw new Error('Kolize: neplatný výběr neprůhledných ploch.');
  if(objects.some(object=>object.boxIndex!==undefined&&(!Number.isInteger(object.boxIndex)||object.boxIndex<0||object.kind!=='aabb')))throw new Error('Kolize: neplatný index generovaného boxu.');
  return objects.map(object=>({...object,...(object.parts?{parts:object.parts.map(part=>({...part}))}:{})}));
}

export function surfaceSignature(parsed, group) {
  if(group.storage==='frame')return hash(Buffer.concat([parsed.primitives.triangles.raw.subarray(group.triangleStart*32,(group.triangleStart+group.triangleCount)*32),...group.parts.map(part=>{const record=parsed.primitives.triangles.records[part.triangleStart];return parsed.links[record?.vertices[0].link]?.raw??Buffer.alloc(0);})]));
  return hash(Buffer.concat([parsed.primitives.triangles.raw.subarray(group.triangleStart*32,(group.triangleStart+group.triangleCount)*32),parsed.extraVertices.subarray(group.vertexStart*12,(group.vertexStart+group.vertexCount)*12)]));
}
// One editable owner can span several native LOD0 buffers.
export function collisionSurfaceOwners(checked,groups,surfaces){
  const owners=[];
  for(let i=0;i<groups.length;i++){
    const group=groups[i];let owner={...group,kind:'mesh'};
    if(group.frame){
      const parts=[];let count=0;
      while(i<groups.length&&groups[i].name===group.name){const part=groups[i];parts.push({frame:part.frame,triangleStart:part.triangleStart,triangleCount:part.triangleCount,vertexCount:surfaces[i].positions.length/3});count+=part.triangleCount;i++;}i--;
      const {frame,...base}=owner;owner={...base,storage:'frame',parts,triangleCount:count};
    }
    if(surfaces.find(s=>s.name===group.name)?.opaqueOnly)owner.opaqueOnly=true;
    owners.push({...owner,signature:surfaceSignature(checked,owner)});
  }
  return owners;
}
export function ownedCollisionRecords(parsed, ownership) {
  const usedTriangles=new Set(),usedVertices=new Set();
  return ownership.map(owned=>{
    if(owned.kind==='mesh'){
      if(owned.triangleStart+owned.triangleCount>parsed.primitives.triangles.count||owned.vertexStart+owned.vertexCount>parsed.vertexCount||surfaceSignature(parsed,owned)!==owned.signature)throw new Error(`Kolize ${owned.name} byla změněna mimo editor.`);
      const records=parsed.primitives.triangles.records.slice(owned.triangleStart,owned.triangleStart+owned.triangleCount);
      let partIndex=0;
      for(const record of records){
        const framed=owned.storage==='frame';if(framed)while(record.index>=owned.parts[partIndex].triangleStart+owned.parts[partIndex].triangleCount)partIndex++;
        const part=framed?owned.parts[partIndex]:null;
        if(usedTriangles.has(record.index)||record.vertices.some(v=>framed?(v.link===0x7fff||![1,3].includes(parsed.links[v.link]?.type)||key(parsed.links[v.link].name)!==key(part.frame)||v.index>=part.vertexCount):(v.link!==0x7fff||v.index<owned.vertexStart||v.index>=owned.vertexStart+owned.vertexCount)))throw new Error('Kolize: překrývající se nebo neplatné vlastnictví povrchu.');usedTriangles.add(record.index);
      }
      for(let i=owned.vertexStart;i<owned.vertexStart+owned.vertexCount;i++){if(usedVertices.has(i))throw new Error('Kolize: překrývající se vlastnictví vrcholů.');usedVertices.add(i);}
      if(records.some(r=>r.material!==records[0].material))throw new Error('Kolize: nestejné materiály generovaného povrchu.');
      return {...owned,records,material:records[0].material};
    }
    const matches=(owned.boxIndex===undefined?parsed.primitives.aabbs.records:[parsed.primitives.aabbs.records[owned.boxIndex]].filter(Boolean)).filter(record=>hash(record.raw)===owned.signature&&key(parsed.links[record.link].name)===key(owned.name));
    if(matches.length!==1)throw new Error(`Kolize ${owned.name} byla změněna mimo editor nebo je nejednoznačná. Vraťte změnu nebo obnovte odpovídající projekt.`);
    return matches[0];
  });
}
export function collisionSurfacePreview(parsed, owned, resolveFrame) {
  return {name:owned.name,kind:'mesh',...(owned.storage?{storage:owned.storage}:{}),material:owned.material,doubleSided:owned.doubleSided,triangleCount:owned.triangleCount,positions:owned.records.flatMap(record=>collisionTriangleVertices(parsed,record,resolveFrame).flat())};
}

// Native static triangles can refer to prefixed children of external model
// frames, not just scene.4ds visuals (e.g. zboren27.Box01). Resolve those using
// the same parent transforms and protect every read model in the transaction.
export async function collisionGeometry(project,scene,geometry,parsed,dependencies,rootNames=[]) {
  const names=new Set(geometry.meshes.map(m=>key(m.name))),roots=new Set();
  for(const record of parsed.primitives.triangles.records){if(record.vertices[0].link===0x7fff)continue;const name=key(parsed.links[record.vertices[0].link].name);if(names.has(name))continue;
    const candidates=scene.objects.filter(o=>o.model&&name.startsWith(key(o.name)+'.')).sort((a,b)=>b.name.length-a.name.length);if(candidates[0])roots.add(candidates[0]);
  }
  for(const name of rootNames){const matches=scene.objects.filter(o=>o.model&&key(o.name)===key(name));if(matches.length!==1)throw new Error('Kolize: nejednoznačný kořen modelu.');roots.add(matches[0]);}
  const meshes=[...geometry.meshes];let id=Math.max(0,...meshes.map(m=>m.id))+1;
  for(const root of roots){
    const path=project.asset(`models/${root.model.replace(/\.(?:i3d|4ds)$/i,'.4ds')}`).path;if(!dependencies.has(path))dependencies.set(path,await project.read(path));const model=parseFourDs(dependencies.get(path),true);
    const existing=meshes.filter(m=>key(m.name)===key(root.name));if(existing.length>1)throw new Error('Kolize: nejednoznačný kořen externího modelu.');
    let parent=existing[0]?.id;if(parent===undefined){parent=id++;meshes.push({id:parent,name:root.name,parent:0,type:6,position:[0,0,0],rotation:[1,0,0,0],scale:[1,1,1]});}
    const ids=new Map(model.meshes.map(m=>[m.id,id++])),base=meshes.length;
    for(const mesh of model.meshes)meshes.push({...mesh,id:ids.get(mesh.id),name:root.name+'.'+mesh.name,parent:mesh.parent?ids.get(mesh.parent):parent,instance:mesh.instance?base+mesh.instance:0});
  }
  return {...geometry,meshes};
}

// Ownership lives in the same atomic history entry as the scene/KLZ overlays.
// A normal undo restores both bytes and the preceding ownership snapshot.
export async function prepareSceneCollision(project, scenePath, before, after, options = {}) {
  const ownership=collisionOwnership(project.manifest,scenePath),requests=options.requests??[];
  if(!ownership.length&&!requests.length)return null;
  const folder=project.asset(scenePath).path.slice(0,project.asset(scenePath).path.lastIndexOf('/')),klzPath=`${folder}/tree.klz`,bytes=await project.read(klzPath),expectedHash=hash(bytes);
  if(options.expectedHash!==undefined&&options.expectedHash!==expectedHash)throw new Error('Kolize se od otevření mapy změnily. Otevřete mapu znovu.');
  const parsed=parseCollision(bytes),owned=ownedCollisionRecords(parsed,ownership),scene=inspectScene(after),oldScene=inspectScene(before),renames=options.renames??new Map(),desired=new Map();
  ownership.forEach((object,i)=>desired.set(key(renames.get(object.name)??object.name),{name:renames.get(object.name)??object.name,kind:object.kind,record:owned[i],previous:object}));
  for(const request of requests){
    if(!request||typeof request.name!=='string'||!['aabb','mesh','none'].includes(request.kind)||request.kind!=='none'&&(!Number.isInteger(request.material)||request.material<0||request.material>255))throw new Error('Kolize: neplatný způsob generování nebo materiál.');
    const previous=desired.get(key(request.name));
    if(request.kind==='none')desired.delete(key(request.name));
    else {if(request.storage!==undefined&&(request.kind!=='mesh'||!['world','frame'].includes(request.storage)))throw new Error('Kolize: neplatné uložení povrchu.');if(request.opaqueOnly!==undefined&&(request.kind!=='mesh'||typeof request.opaqueOnly!=='boolean'))throw new Error('Kolize: neplatný výběr neprůhledných ploch.');if(request.doubleSided!==undefined&&typeof request.doubleSided!=='boolean')throw new Error('Kolize: neplatná oboustrannost.');desired.set(key(request.name),{...previous,name:request.name,kind:request.kind,storage:request.storage??previous?.previous?.storage,material:request.material,opaqueOnly:request.opaqueOnly??previous?.previous?.opaqueOnly,doubleSided:request.doubleSided??previous?.previous?.doubleSided??true});}
  }
  const geometryPath=`${folder}/scene.4ds`,geometryBytes=await project.read(geometryPath),geometry=parseFourDs(geometryBytes,true),dependencies=new Map([[geometryPath,geometryBytes]]),removed=new Set(owned.filter(record=>record.kind!=='mesh').map(record=>record.index)),boxes=[],surfaces=[],next=[];
  const removedVertexIndices=ownership.filter(o=>o.kind==='mesh').flatMap(owner=>Array.from({length:owner.vertexCount},(_,i)=>owner.vertexStart+i));
  for(const definition of desired.values()){
    const matches=scene.objects.filter(object=>key(object.name)===key(definition.name)),object=matches[0];
    if(matches.length>1)throw new Error('Kolize: nejednoznačný objekt scény.');
    if(!object){if(!definition.previous||!oldScene.objects.some(o=>key(o.name)===key(definition.previous.name)))throw new Error('Kolize: chybějící objekt scény.');continue;}
    if(typeof object.model!=='string'||!/^[^/\\]+\.(?:i3d|4ds)$/i.test(object.model))throw new Error('Kolize: vyberte model z hlavní složky models.');
    const modelPath=project.asset(`models/${object.model.replace(/\.(?:i3d|4ds)$/i,'.4ds')}`).path;
    if(!dependencies.has(modelPath))dependencies.set(modelPath,await project.read(modelPath));
    if(definition.kind==='mesh'){
      const opaqueOnly=definition.opaqueOnly??definition.previous?.opaqueOnly,model=parseFourDs(dependencies.get(modelPath),true),framed=(definition.storage??definition.previous?.storage)==='frame',parts=framed?modelCollisionFrameSurfaces(model,object,scene,geometry,{opaqueOnly}):[modelCollisionSurface(model,object,scene,geometry,{opaqueOnly})];
      for(const part of parts)surfaces.push({...part,...(opaqueOnly?{opaqueOnly:true}:{}),material:definition.material??definition.record?.material??0,doubleSided:definition.doubleSided??definition.previous?.doubleSided??true});continue;
    }
    const box={...modelCollisionBox(parseFourDs(dependencies.get(modelPath),true),object,scene,geometry),sort:definition.record?.sort??0,flags:definition.record?.flags??0,material:definition.material??definition.record?.material??0},record=definition.record?.kind==='mesh'?null:definition.record;
    if(record&&key(parsed.links[record.link].name)===key(box.name)&&box.material===record.material&&box.min.every((n,i)=>Math.fround(n)===record.min[i])&&box.max.every((n,i)=>Math.fround(n)===record.max[i])){
      removed.delete(record.index);next.push({...definition.previous,name:object.name,boxIndex:record.index});
    }else boxes.push(box);
  }
  const boxed=appendCollisionBoxes(bytes,boxes,[...removed]),replacement=replaceCollisionSurfaces(boxed,surfaces,{removedIndices:owned.filter(r=>r.kind==='mesh').flatMap(r=>r.records.map(t=>t.index)),removedVertexIndices,resolveFrame:geometryCollisionResolver(scene,surfaces.length?await collisionGeometry(project,scene,geometry,parsed,dependencies,[...new Set(surfaces.filter(s=>s.frame).map(s=>s.name))]):geometry)}),result=replacement.bytes,checked=parseCollision(result),first=parsed.primitives.aabbs.count-removed.size;
  for(const owner of next)if(owner.kind==='aabb')owner.boxIndex-=[...removed].filter(index=>index<owner.boxIndex).length;
  boxes.forEach((box,i)=>next.push({name:box.name,kind:'aabb',boxIndex:first+i,signature:hash(checked.primitives.aabbs.records[first+i].raw)}));
  next.push(...collisionSurfaceOwners(checked,replacement.groups,surfaces));
  return {files:[{path:klzPath,data:result,expectedHash},...[...dependencies].map(([path,data])=>({path,data,expectedHash:hash(data)}))],ownership:{path:project.asset(scenePath).path,objects:next}};
}
