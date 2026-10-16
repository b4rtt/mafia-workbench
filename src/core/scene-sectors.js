import {Matrix4,Quaternion,Vector3} from 'three';
import {inspectScene,editSceneSectorBindings,appendSceneGeometryOverride} from './scene.js';
import {parseFourDs} from './fourds.js';
import {sceneWorld} from './model-collision.js';
import {sceneSectors} from '../shared/lights.js';

const key=name=>name.normalize('NFC').toLowerCase();
function context(source,geometrySource,id){
  const scene=inspectScene(source),geometry=parseFourDs(geometrySource),geometryId=typeof id==='string'&&/^geometry\/[1-9]\d*$/.test(id)?Number(id.slice(9)):null;
  const selected=geometryId===null?scene.objects.find(o=>o.id===id):geometry.meshes.find(m=>m.id===geometryId);
  if(!selected)throw new Error('Sektory: vyberte objekt scény nebo geometrie.');
  const matches=scene.objects.filter(o=>key(o.name)===key(selected.name)),bases=geometry.meshes.filter(m=>key(m.name)===key(selected.name));
  if(matches.length>1||bases.length>1)throw new Error('Sektory: nejednoznačný název objektu.');
  const base=bases[0],geometryOnly=geometryId!==null&&!matches.length,object=geometryOnly?{id,name:base.name,actorBound:scene.actors.some(a=>key(a.name)===key(base.name))}:matches[0];
  if(!object)throw new Error('Sektory: vyberte objekt scény.');
  const frameType=object.frameType??base?.type,parent=object.parent??(base?.parent?geometry.meshes.find(m=>m.id===base.parent)?.name:'Primary sector');
  if(![1,2,4,6,9].includes(frameType))throw new Error('Sektory: vyberte model, světlo, zvuk nebo skriptový bod scény.');
  if(geometryOnly&&![1,6,9].includes(frameType))throw new Error('Sektory: pro tento typ geometrie nelze vytvořit přiřazení.');
  const type=frameType===2?0x4046:frameType===4?0xb200:null,label=type===0x4046?'Sektor světla':'Sektor zvuku';
  const sectors=type?scene.entries.filter(e=>e.id.startsWith(object.id+'/')&&e.label===label).map(e=>e.value):null;
  const available=sceneSectors(scene.objects,geometry.meshes).filter(name=>['primary sector','backdrop sector'].includes(key(name))||(!scene.objects.some(o=>key(o.name)===key(name)&&o.frameType!==undefined&&o.frameType!==5)&&!geometry.meshes.some(m=>key(m.name)===key(name)&&m.type!==5)));
  return {scene,geometry,object,geometryOnly,parent,sectors,available};
}
export function inspectSceneSectors(source,geometrySource,id){
  const c=context(source,geometrySource,id);
  const world=sceneWorld(c.scene,c.geometry),identity=new Matrix4().elements,transformed=c.available.filter(name=>{
    if(['primary sector','backdrop sector'].includes(key(name)))return false;
    try{return world(name).elements.some((v,i)=>Math.abs(v-identity[i])>1e-6);}catch{return false;}
  });
  return {object:{id:c.object.id,name:c.object.name,actorBound:c.object.actorBound},geometryOnly:c.geometryOnly,parent:c.parent,sectors:c.sectors,available:c.available,transformed};
}
export function assignSceneSectors(source,geometrySource,request){
  if(!request||typeof request!=='object'||Object.keys(request).some(k=>!['id','parent','sectors'].includes(k))||typeof request.id!=='string')throw new Error('Sektory: neplatná operace.');
  const c=context(source,geometrySource,request.id),lookup=new Map(c.available.map(name=>[key(name),name]));
  const resolve=name=>{if(typeof name!=='string'||!lookup.has(key(name)))throw new Error('Sektory: chybějící nebo nejednoznačný sektor.');return lookup.get(key(name));};
  let parent,transform,sectors;
  if(request.parent!==undefined){
    const next=resolve(request.parent);
    if(key(next)!==key(c.parent??'')){
      if(c.object.actorBound)throw new Error('Sektory: rodiče animovaného nebo fyzikálního aktéra zatím nelze měnit.');
      if(key(next)===key(c.object.name))throw new Error('Sektory: objekt nemůže být vlastním rodičem.');
      const world=sceneWorld(c.scene,c.geometry),original=world(c.object.name),target=['primary sector','backdrop sector'].includes(key(next))?new Matrix4():world(next);
      if(!Number.isFinite(target.determinant())||Math.abs(target.determinant())<1e-12)throw new Error('Sektory: rodič má nevratnou transformaci.');
      const local=target.clone().invert().multiply(original),p=new Vector3(),q=new Quaternion(),s=new Vector3();local.decompose(p,q,s);
      transform={position:p.toArray().map(Math.fround),rotation:[q.w,-q.x,-q.y,-q.z].map(Math.fround),scale:s.toArray().map(Math.fround)};
      const restored=target.clone().multiply(new Matrix4().compose(new Vector3(...transform.position),new Quaternion(-transform.rotation[1],-transform.rotation[2],-transform.rotation[3],transform.rotation[0]).normalize(),new Vector3(...transform.scale)));
      if(Object.values(transform).flat().some(v=>!Number.isFinite(v))||original.elements.some((v,i)=>Math.abs(v-restored.elements[i])>Math.max(1e-5,Math.abs(v)*1e-6)))throw new Error('Sektory: transformace vyžaduje zkosení nebo ztrácí přesnost; světovou polohu nelze zachovat.');
      parent=next;
    }
  }
  if(request.sectors!==undefined){
    if(c.sectors===null||!Array.isArray(request.sectors)||request.sectors.length>256)throw new Error('Sektory: seznam patří pouze světlu nebo zvuku.');
    const next=request.sectors.map(resolve);if(new Set(next.map(key)).size!==next.length)throw new Error('Sektory: duplicitní sektor.');
    if(JSON.stringify(next)!==JSON.stringify(c.sectors))sectors=next;
  }
  if(parent===undefined&&sectors===undefined)return Buffer.from(source);
  const prepared=c.geometryOnly?appendSceneGeometryOverride(source,c.object.name):source;
  const objectId=c.geometryOnly?inspectScene(prepared).objects.find(o=>key(o.name)===key(c.object.name)).id:c.object.id;
  const after=editSceneSectorBindings(prepared,objectId,{parent,transform,sectors});
  // Re-resolve the complete affected hierarchy to reject cycles/missing parents.
  const result=inspectScene(after);sceneWorld(result,c.geometry)(c.object.name);
  return after;
}
