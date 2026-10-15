import { Matrix4, Vector3 } from 'three';
import { sceneWorld } from './scene-world.js';

const key=name=>name.normalize('NFC').toLowerCase();

export function sceneTranslationObjects(scene){
  return scene.objects.filter(object=>object.fields.position&&[1,2,4,6,9].includes(object.frameType??scene.geometry?.meshes.find(mesh=>key(mesh.name)===key(object.name))?.type));
}

// Move selected roots once. Descendants (selected or not) inherit their move;
// never add the same world offset again in a child's local coordinate system.
export function planSceneTranslation(scene,geometry,{ids,offset}={}){
  if(!Array.isArray(ids)||!ids.length||ids.length>256||ids.some(id=>typeof id!=='string')||new Set(ids).size!==ids.length)throw Error('Společný posun: vyberte 1–256 různých objektů.');
  if(!Array.isArray(offset)||offset.length!==3||offset.some(value=>typeof value!=='number'||!Number.isFinite(value)||!Number.isFinite(Math.fround(value))))throw Error('Společný posun: zadejte konečný posun XYZ.');
  const available=sceneTranslationObjects({...scene,geometry}),objects=ids.map(id=>available.find(object=>object.id===id));
  if(objects.some(object=>!object))throw Error('Společný posun: objekt nemá upravitelnou pozici nebo jde o sektor.');
  const selected=new Set(objects.map(object=>key(object.name))),world=sceneWorld(scene,geometry),changes=[],inherited=[];
  for(const object of objects){
    const original=world(object.name),parents=[];let parent=world.parent(object.name);
    while(parent){parents.push(parent);parent=world.parent(parent);}
    if(parents.some(name=>selected.has(key(name)))){inherited.push(object.id);continue;}
    const parentMatrix=parents.length?world(parents[0]):new Matrix4();
    if(!Number.isFinite(parentMatrix.determinant())||Math.abs(parentMatrix.determinant())<1e-12)throw Error(`Společný posun: rodič objektu ${object.name} má nevratnou transformaci.`);
    if(offset.every(value=>value===0))continue;
    const target=new Vector3().setFromMatrixPosition(original).add(new Vector3(...offset));
    const value=target.clone().applyMatrix4(parentMatrix.clone().invert()).toArray().map(Math.fround);
    const restored=new Vector3(...value).applyMatrix4(parentMatrix);
    if(value.some(value=>!Number.isFinite(value))||target.toArray().some((value,i)=>Math.abs(value-restored.getComponent(i))>Math.max(1e-5,Math.abs(value)*1e-6)))throw Error(`Společný posun: polohu objektu ${object.name} nelze přesně uložit.`);
    if(value.some((value,i)=>value!==object.position[i]))changes.push({id:object.fields.position,value});
  }
  return {changes,inherited};
}
