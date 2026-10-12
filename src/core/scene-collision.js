import { hash } from './files.js';
import { inspectScene } from './scene.js';
import { parseFourDs } from './fourds.js';
import { parseCollision, appendCollisionBoxes } from './collision.js';
import { modelCollisionBox } from './model-collision.js';

const key = name => name.normalize('NFC').toLowerCase();
export function collisionOwnership(manifest, scenePath) {
  const snapshot=manifest.history.findLast(entry=>entry.collisionOwnership&&key(entry.collisionOwnership.path)===key(scenePath));
  if(!snapshot)return [];
  const objects=snapshot.collisionOwnership.objects;
  if(!Array.isArray(objects)||objects.length>65536||objects.some(o=>!o||typeof o.name!=='string'||!o.name||o.kind!=='aabb'||!/^[0-9a-f]{64}$/.test(o.signature))||new Set(objects.map(o=>key(o.name))).size!==objects.length)throw new Error('Kolize: neplatná evidence generovaných boxů.');
  return objects.map(object=>({...object}));
}

export function ownedCollisionRecords(parsed, ownership) {
  return ownership.map(owned=>{
    const matches=parsed.primitives.aabbs.records.filter(record=>hash(record.raw)===owned.signature&&key(parsed.links[record.link].name)===key(owned.name));
    if(matches.length!==1)throw new Error(`Kolize ${owned.name} byla změněna mimo editor nebo je nejednoznačná. Vraťte změnu nebo obnovte odpovídající projekt.`);
    return matches[0];
  });
}

// Ownership lives in the same atomic history entry as the scene/KLZ overlays.
// A normal undo restores both bytes and the preceding ownership snapshot.
export async function prepareSceneCollision(project, scenePath, before, after, options = {}) {
  const ownership=collisionOwnership(project.manifest,scenePath),requests=options.requests??[];
  if(!ownership.length&&!requests.length)return null;
  const folder=project.asset(scenePath).path.slice(0,project.asset(scenePath).path.lastIndexOf('/')),klzPath=`${folder}/tree.klz`,bytes=await project.read(klzPath),expectedHash=hash(bytes);
  if(options.expectedHash!==undefined&&options.expectedHash!==expectedHash)throw new Error('Kolize se od otevření mapy změnily. Otevřete mapu znovu.');
  const parsed=parseCollision(bytes),owned=ownedCollisionRecords(parsed,ownership),scene=inspectScene(after),oldScene=inspectScene(before),renames=options.renames??new Map(),desired=new Map();
  ownership.forEach((object,i)=>desired.set(key(renames.get(object.name)??object.name),{name:renames.get(object.name)??object.name,record:owned[i],previous:object}));
  for(const request of requests){
    if(!request||typeof request.name!=='string'||!['aabb','none'].includes(request.kind)||request.kind==='aabb'&&(!Number.isInteger(request.material)||request.material<0||request.material>255))throw new Error('Kolize: neplatný způsob generování nebo materiál.');
    const previous=desired.get(key(request.name));
    if(request.kind==='none')desired.delete(key(request.name));
    else desired.set(key(request.name),{...previous,name:request.name,material:request.material});
  }
  const geometryPath=`${folder}/scene.4ds`,geometryBytes=await project.read(geometryPath),geometry=parseFourDs(geometryBytes),dependencies=new Map([[geometryPath,geometryBytes]]),removed=new Set(owned.map(record=>record.index)),boxes=[],next=[];
  for(const definition of desired.values()){
    const matches=scene.objects.filter(object=>key(object.name)===key(definition.name)),object=matches[0];
    if(matches.length>1)throw new Error('Kolize: nejednoznačný objekt scény.');
    if(!object){if(!definition.previous||!oldScene.objects.some(o=>key(o.name)===key(definition.previous.name)))throw new Error('Kolize: chybějící objekt scény.');continue;}
    if(typeof object.model!=='string'||!/^[^/\\]+\.(?:i3d|4ds)$/i.test(object.model))throw new Error('Kolize: vyberte model z hlavní složky models.');
    const modelPath=project.asset(`models/${object.model.replace(/\.(?:i3d|4ds)$/i,'.4ds')}`).path;
    if(!dependencies.has(modelPath))dependencies.set(modelPath,await project.read(modelPath));
    const box={...modelCollisionBox(parseFourDs(dependencies.get(modelPath),true),object,scene,geometry),sort:definition.record?.sort??0,flags:definition.record?.flags??0,material:definition.material??definition.record?.material??0},record=definition.record;
    if(record&&key(parsed.links[record.link].name)===key(box.name)&&box.material===record.material&&box.min.every((n,i)=>Math.fround(n)===record.min[i])&&box.max.every((n,i)=>Math.fround(n)===record.max[i])){
      removed.delete(record.index);next.push({...definition.previous,name:object.name});
    }else boxes.push(box);
  }
  const result=appendCollisionBoxes(bytes,boxes,[...removed]),checked=parseCollision(result),first=parsed.primitives.aabbs.count-removed.size;
  boxes.forEach((box,i)=>next.push({name:box.name,kind:'aabb',signature:hash(checked.primitives.aabbs.records[first+i].raw)}));
  return {files:[{path:klzPath,data:result,expectedHash},...[...dependencies].map(([path,data])=>({path,data,expectedHash:hash(data)}))],ownership:{path:project.asset(scenePath).path,objects:next}};
}
