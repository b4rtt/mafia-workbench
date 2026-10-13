import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pickupScript, parsePickupScript } from '../src/shared/pickups.js';
import { inspectScene, editScene, changeSceneObject } from '../src/core/scene.js';
import { createDetector } from '../src/core/detectors.js';
import { ModProject } from '../src/core/project.js';
import { hash, writeSafe } from '../src/core/files.js';
const chunk=(type,data)=>{const header=Buffer.alloc(6);header.writeUInt16LE(type);header.writeUInt32LE(data.length+6,2);return Buffer.concat([header,data]);};
const opaque=chunk(0xbabe,Buffer.from('untouched'));
const scene=chunk(0x4c53,Buffer.concat([chunk(0x4000,Buffer.alloc(0)),opaque]));
const operation={kind:'add-pickup',name:'WB_GUN',model:'Gun.i3d',position:[4,5,6],rotation:[1,0,0,0],scale:[1,1,1],itemId:9,clip:7,reserve:14};

test('pickups create frame 9 and an ordered detector actor, keep opaque data and validate native item limits',()=>{
  const added=changeSceneObject(scene,operation),parsed=inspectScene(added),object=parsed.objects[0];
  assert.equal(object.frameType,9);assert.equal(object.actorBound,true);assert.deepEqual(object.position,operation.position);assert.equal(object.parent,'Primary sector');
  assert.equal(object.model,'Gun.i3d');assert.equal(object.pickup.itemId,9);assert.equal(object.pickup.clip,7);assert.equal(object.pickup.reserve,14);
  assert.equal(parsed.entries.find(entry=>entry.detectorParameter).value,0);
  assert.deepEqual(parsed.actorScripts,[{name:'WB_GUN',code:pickupScript('WB_GUN',9,7,14)}]);assert.ok(added.includes(opaque));
  assert.ok(added.includes(createDetector(pickupScript('WB_GUN',9,7,14),0)));
  for(const itemId of [0,-1,65536,NaN,'9',1.5])assert.throws(()=>changeSceneObject(scene,{...operation,itemId}),/ID/);
  for(const value of [-1,2147483648,Infinity,.2,'1'])for(const field of ['clip','reserve'])assert.throws(()=>changeSceneObject(scene,{...operation,[field]:value}),/náboj/);
  assert.ok(changeSceneObject(scene,{...operation,itemId:65535,clip:2147483647,reserve:0}));
  assert.throws(()=>changeSceneObject(scene,operation,['wb_gun']),/existuje/);
});

test('pickup transform, rename, configure, duplicate and delete keep model/script identity coherent',()=>{
  const added=changeSceneObject(scene,operation),object=inspectScene(added).objects[0];
  const moved=editScene(added,object.fields.position,[20,1,30]);assert.deepEqual(inspectScene(moved).objects[0].position,[20,1,30]);
  const renamed=editScene(moved,object.fields.name,'RENAMED'),renamedObject=inspectScene(renamed).objects[0];
  assert.equal(renamedObject.pickup.name,'RENAMED');assert.deepEqual(inspectScene(renamed).actorScripts,[{name:'RENAMED',code:pickupScript('RENAMED',9,7,14)}]);
  const configured=changeSceneObject(renamed,{kind:'configure-pickup',id:renamedObject.id,model:'Key.i3d',itemId:16,clip:0,reserve:0});
  const item=inspectScene(configured).objects[0];assert.equal(item.model,'Key.i3d');assert.equal(item.pickup.itemId,16);assert.deepEqual(item.position,[20,1,30]);
  const copied=changeSceneObject(configured,{kind:'duplicate',id:item.id,name:'COPY'}),copy=inspectScene(copied).objects.find(object=>object.name==='COPY');
  assert.equal(copy.pickup.itemId,16);assert.deepEqual(copy.position,item.position);assert.equal(inspectScene(copied).actorScripts.length,2);
  const deleted=changeSceneObject(copied,{kind:'delete',id:copy.id});assert.deepEqual(deleted,configured);
  const emptied=changeSceneObject(deleted,{kind:'delete',id:item.id});assert.deepEqual(inspectScene(emptied).objects,[]);assert.deepEqual(inspectScene(emptied).actorScripts,[]);assert.ok(emptied.includes(opaque));
  assert.deepEqual(editScene(added,object.fields.name,'WB_GUN'),added);
});

test('custom programs, masks and external references cannot be mistaken for disposable pickup actors',()=>{
  const added=changeSceneObject(scene,operation),object=inspectScene(added).objects[0],scriptId=object.pickup.scriptId;
  const custom=editScene(added,scriptId,{name:object.name,code:pickupScript(object.name,9,7,14)+'wait 1'});
  assert.equal(inspectScene(custom).objects[0].pickup,undefined);
  for(const kind of ['delete','duplicate','configure-pickup'])assert.throws(()=>changeSceneObject(custom,{...operation,kind,id:object.id,name:'COPY'}),/předmět|samostatný/);
  const mask=inspectScene(added).entries.find(entry=>entry.detectorParameter),masked=editScene(added,mask.id,1);assert.equal(inspectScene(masked).objects[0].pickup,undefined);
  const modelOnly=changeSceneObject(scene,{...operation,kind:'add-model'}),type=Buffer.alloc(4);type.writeUInt32LE(5);
  const actorName=Buffer.from('WB_GUN\0'),data=createDetector(pickupScript('WB_GUN',9,7,14),0);
  for(const [nameBytes,typeBytes,dataBytes,extra] of [[actorName,Buffer.concat([type,Buffer.from([0xab])]),data,Buffer.alloc(0)],[Buffer.concat([actorName,Buffer.from([0xab])]),type,data,Buffer.alloc(0)],[actorName,type,Buffer.concat([data,Buffer.from([0xab])]),Buffer.alloc(0)],[actorName,type,data,opaque]]){
    const actor=chunk(0xae21,Buffer.concat([chunk(0xae23,nameBytes),chunk(0xae22,typeBytes),chunk(0xae24,dataBytes),extra])),unknown=chunk(0x4c53,Buffer.concat([modelOnly.subarray(6),chunk(0xae20,actor)]));
    assert.equal(inspectScene(unknown).objects[0].pickup,undefined);assert.throws(()=>changeSceneObject(unknown,{kind:'delete',id:object.id}),/aktéra/);
  }
  const reference=changeSceneObject(added,{kind:'add-detector',name:'WATCH',position:[0,0,0],mask:0,code:'findframe 0, "WB_GUN"\r\nend'});
  assert.throws(()=>changeSceneObject(reference,{kind:'delete',id:object.id}),/odkazuje skript/);
  assert.throws(()=>editScene(reference,object.fields.name,'RENAMED'),/odkazuje/);
  const referencedCopy=changeSceneObject(reference,{kind:'duplicate',id:object.id,name:'UNREFERENCED_COPY'});
  assert.deepEqual(inspectScene(referencedCopy).actorScripts.slice(0,2),inspectScene(reference).actorScripts);assert.equal(inspectScene(referencedCopy).objects.find(object=>object.name==='UNREFERENCED_COPY').pickup.itemId,9);
  assert.equal(parsePickupScript('OTHER',pickupScript('WB_GUN',9,7,14)),null);
  assert.equal(parsePickupScript('WB_GUN',pickupScript('WB_GUN',9,7,14).replace('0, 9','0, 09')),null);
});

async function setup(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'mafia-pickups-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  await writeSafe(root,'workbench.json',JSON.stringify({format:'mafia-workbench',version:1,name:'Pickups',assets:[],history:[]}));
  const project=await ModProject.open(root),empty=Buffer.alloc(19);empty.write('4DS\0');empty.writeUInt16LE(29,4);empty[18]=1;
  const u16=value=>{const bytes=Buffer.alloc(2);bytes.writeUInt16LE(value);return bytes;},floats=values=>{const bytes=Buffer.alloc(values.length*4);values.forEach((value,i)=>bytes.writeFloatLE(value,i*4));return bytes;};
  const model=Buffer.concat([empty.subarray(0,14),u16(0),u16(1),Buffer.from([1,0,0,0]),u16(0),floats([0,0,0,1,1,1,1,0,0,0]),Buffer.from([1,3]),Buffer.from('gun'),Buffer.from([0]),u16(0),Buffer.from([1]),floats([0]),u16(3),floats([0,0,0,0,1,0,0,0,1,0,0,0,1,0,1,0,0,1,0,0,1,0,0,1]),Buffer.from([1]),u16(1),u16(0),u16(1),u16(2),u16(0),Buffer.from([1])]);
  const table=Buffer.alloc(188*4);table.write('Gun',188);table.write('GUN.I3D',188+36);table.writeInt32LE(7,188+96);table.writeInt32LE(14,188+100);
  table.write('Missing',376);table.write('missing.i3d',376+36);table.write('Bad path',564);table.write('../Gun.i3d',564+36);
  const name='missions/Test/scene2.bin';await project.createFiles([{path:name,data:scene},{path:'missions/Test/scene.4ds',data:empty},{path:'models/Gun.4ds',data:model},{path:'tables/predmety.def',data:table}]);
  const catalog=await project.pickupItems(),item=catalog.items[0];
  const request={...operation,itemId:1,itemTableHash:catalog.sha256,itemModelHash:item.modelHash};delete request.model;
  return {root,project,name,request,table,model,catalog};
}

test('catalog resolves table models case-insensitively; creation, settings, export and undo publish complete scenes',async t=>{
  const {root,project,name,request,catalog,table,model}=await setup(t);assert.equal(catalog.items.length,1);assert.equal(catalog.rejected,2);assert.equal(catalog.items[0].model,'models/Gun.4ds');
  const history=project.manifest.history.length;await project.changeSceneObject(name,request,hash(scene));const added=await project.read(name),object=inspectScene(added).objects[0];
  assert.deepEqual(project.manifest.history.at(-1).files.map(file=>file.path),[name]);assert.equal(object.model,'Gun.i3d');
  await project.changeSceneObject(name,{...request,kind:'configure-pickup',id:object.id,clip:0,reserve:3},hash(added));const configured=await project.read(name);
  const reopened=await ModProject.open(root);assert.deepEqual(await reopened.read(name),configured);assert.equal(inspectScene(configured).objects[0].pickup.reserve,3);
  const destination=path.join(root,'export');await reopened.export(destination);assert.deepEqual(await fs.readFile(path.join(destination,name)),configured);
  assert.deepEqual(await reopened.read('tables/predmety.def'),table);assert.deepEqual(await reopened.read('models/Gun.4ds'),model);
  await reopened.undo();assert.deepEqual(await reopened.read(name),added);await reopened.undo();assert.deepEqual(await reopened.read(name),scene);assert.equal(reopened.manifest.history.length,history);
});

test('stale catalogs, missing items and failed publication never leave a partial pickup',async t=>{
  const {project,name,request,table}=await setup(t),history=project.manifest.history.length;
  for(const invalid of [{itemTableHash:'stale'},{itemModelHash:'stale'},{itemId:0},{itemId:2},{clip:-1},{itemId:4}])await assert.rejects(project.changeSceneObject(name,{...request,...invalid},hash(scene)));
  assert.deepEqual(await project.read(name),scene);assert.equal(project.manifest.history.length,history);
  const batch=project.changeBatch;project.changeBatch=async function(files,...rest){const bytes=Buffer.from(table);bytes.write('changed',188);await this.change('tables/predmety.def',bytes,'Concurrent edit');return batch.call(this,files,...rest);};
  await assert.rejects(project.changeSceneObject(name,request,hash(scene)),/změnil/);assert.deepEqual(await project.read(name),scene);project.changeBatch=batch;await project.undo();
  const save=project.saveManifest;project.saveManifest=async()=>{throw new Error('simulated publication failure');};
  await assert.rejects(project.changeSceneObject(name,request,hash(scene)),/simulated/);project.saveManifest=save;assert.deepEqual(await project.read(name),scene);assert.equal(project.manifest.history.length,history);
});

test('pickup renames reject ambiguous geometry names before publishing the scene',async t=>{
  const {project,name,request,model}=await setup(t);await project.change('missions/Test/scene.4ds',model);
  await project.changeSceneObject(name,request,hash(scene));const added=await project.read(name),object=inspectScene(added).objects[0],history=project.manifest.history.length;
  await assert.rejects(project.saveScene(name,[{id:object.fields.name,value:'GUN'}],hash(added)),/geometrii/);
  assert.deepEqual(await project.read(name),added);assert.equal(project.manifest.history.length,history);
  assert.throws(()=>editScene(added,object.fields.name,'Primary sector'),/existuje/);
});
