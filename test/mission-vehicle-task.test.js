import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { missionTaskScript, missionTaskVehicles } from '../src/shared/mission-task.js';
import { ModProject } from '../src/core/project.js';
import { changeSceneObject, inspectScene, editScene } from '../src/core/scene.js';
import { hash, writeSafe } from '../src/core/files.js';
import { addTextDbEntry } from '../src/core/textdb.js';

const task={objectiveId:10,interactionId:20,nextObjectiveId:30,completeId:40,targetName:'Destination',vehicle:{name:'Delivery',driverOnly:true}};

// Evaluate one polling pass with the engine commands' documented semantics,
// including actor identity, seat index, distance and failure priority.
function outcome(options,{owner=null,seat=-1,distance=0,health=100,elapsed=0}={}){
  const lines=missionTaskScript(options).split('\n'),labels=new Map(lines.flatMap((line,i)=>/^label (\d+)$/.test(line)?[[line.slice(6),i]]:[])),actors=[],flt=Array(12).fill(0);
  for(const line of lines.slice(0,labels.get('10'))){const m=/^findactor (\d+), "(.*)"$/.exec(line);if(m)actors[+m[1]]=m[2];}
  let pc=labels.get('10')+1;
  for(let step=0;step<100;step++){
    const line=lines[pc++];
    if(line==='label 20')return 'success';if(line==='label 30')return 'failure';if(line==='wait 100')return 'pending';
    let m=/^setnullactor (\d+)$/.exec(line);if(m)actors[+m[1]]=null;
    m=/^human_getowner (\d+), (\d+)$/.exec(line);if(m){assert.equal(actors[+m[1]],'Tommy');actors[+m[2]]=owner;}
    m=/^compareactors (\d+), (\d+), (\d+)$/.exec(line);if(m)flt[+m[3]]=Number(actors[+m[1]]===actors[+m[2]]);
    m=/^human_getseatidx (\d+), (\d+)$/.exec(line);if(m){assert.equal(actors[+m[1]],'Tommy');flt[+m[2]]=seat;}
    m=/^human_getproperty (\d+), (\d+), Energy$/.exec(line);if(m)flt[+m[2]]=health;
    if(line==='getgametime 9')flt[9]=elapsed;
    if(line==='vect_magnitude 0, 6')flt[6]=distance;
    m=/^if flt\[(\d+)\] ([=<>]) ([\d.e+-]+), (-?\d+), (-?\d+)$/.exec(line);
    if(m){const v=flt[+m[1]],n=+m[3],jump=(m[2]==='='?v===n:m[2]==='<'?v<n:v>n)?m[4]:m[5];if(jump!=='-1')pc=labels.get(jump);}
  }
  throw Error('Polling did not reach an outcome');
}

test('delivery requires the chosen car, seat and arrival, and failure still takes priority',()=>{
  for(const state of [{},{owner:'Other',seat:0},{owner:'Delivery',seat:1},{owner:'Delivery',seat:0,distance:3},{owner:'Delivery',seat:0,distance:50}])assert.equal(outcome(task,state),'pending');
  assert.equal(outcome(task,{owner:'Delivery',seat:0,distance:2.9}),'success');
  const passenger={...task,vehicle:{name:'Delivery',driverOnly:false}};
  for(const seat of [0,1,2,3])assert.equal(outcome(passenger,{owner:'Delivery',seat}),'success');
  assert.equal(outcome(passenger,{owner:'Other',seat:1}),'pending');
  const protectedTask={...task,failure:{humanName:'Guard',timeoutSeconds:10,textId:50},flow:{onComplete:'Next',onFailure:'Fail'},checkpointId:5050};
  assert.equal(outcome(protectedTask,{owner:'Delivery',seat:0,health:0}),'failure');
  assert.equal(outcome(protectedTask,{owner:'Other',seat:1,elapsed:10001}),'failure');
  assert.equal(outcome(protectedTask,{owner:'Delivery',seat:0,elapsed:10000}),'success');
  const code=missionTaskScript(protectedTask);
  assert.match(code,/dim_flt 12\ndim_act 6/);assert.match(code,/findactor 0, "Guard"\nfindactor 1, "Tommy"\nfindactor 2, "Delivery"\ngetgametime 8\nautosavegamefull/);
  assert.match(code,/findactor 4, "Next"/);assert.match(code,/findactor 5, "Fail"/);assert.match(code,/setnullactor 3\nhuman_getowner 1, 3\ncompareactors 2, 3, 10/);
  assert.match(code,/findframe 1, "Delivery"/);assert.doesNotMatch(code,/human_setproperty|human_force_settocar|car_set/);
  const {vehicle,...walking}=task;assert.equal(missionTaskScript(walking),missionTaskScript({...walking,vehicle:null}));
  for(const vehicle of [false,[],{}, {name:'Delivery',driverOnly:1},{name:'Destination',driverOnly:true},{name:'Tommy',driverOnly:true},{name:'X"\nend',driverOnly:false}])assert.throws(()=>missionTaskScript({...task,vehicle}),/Úkol/);
});

test('vehicle selection excludes static models, missing frames and ambiguous actor bindings',()=>{
  const scene={actors:[{name:'Delivery',kind:4},{name:'Static',kind:5}],objects:[{name:'Delivery',frameType:9,model:'Car.i3d'},{name:'Static',frameType:9,model:'Car.i3d'}]};
  assert.deepEqual(missionTaskVehicles(scene).map(a=>a.name),['Delivery']);
  for(const extra of [{actors:[...scene.actors,{name:'DELIVERY',kind:4}]},{objects:[]},{objects:[...scene.objects,scene.objects[0]]},{geometry:{meshes:[{name:'delivery'}]}},{objects:[{name:'Delivery',frameType:6}]}])assert.deepEqual(missionTaskVehicles({...scene,...extra}),[]);
});

const chunk=(type,data)=>{const h=Buffer.alloc(6);h.writeUInt16LE(type);h.writeUInt32LE(data.length+6,2);return Buffer.concat([h,data]);};
test('delivery transaction validates live actor types, preserves car/NPC data and exports and undoes exactly',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'mafia-delivery-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  await writeSafe(root,'workbench.json',JSON.stringify({format:'mafia-workbench',version:2,name:'Delivery',assets:[],history:[]}));
  const p=await ModProject.open(root),name='missions/Test/scene2.bin',geometryPath='missions/Test/scene.4ds',textPath='tables/textdb_cz.def',geometry=Buffer.alloc(19);geometry.write('4DS\0');geometry.writeUInt16LE(29,4);geometry[18]=1;
  let scene=chunk(0x4c53,Buffer.concat([chunk(0x4000,Buffer.alloc(0)),chunk(0xbabe,Buffer.from('opaque'))]));
  scene=changeSceneObject(scene,{kind:'add-human',name:'Tommy',model:'Tommy.i3d',position:[0,0,0],rotation:[1,0,0,0],scale:[1,1,1],parameters:{},code:'wait 123\nend'});
  const type=inspectScene(scene).entries.find(e=>e.label==='Typ aktéra');scene=editScene(scene,type.id,2);
  for(const [kind,object]of [['add-car','Delivery'],['add-model','Static']])scene=changeSceneObject(scene,{kind,name:object,model:'Car.i3d',position:[0,0,0],rotation:[1,0,0,0],scale:[1,1,1]});
  scene=changeSceneObject(scene,{kind:'add-detector',name:'Destination',position:[8,0,0],mask:0,code:'wait 456\nend'});
  let text=Buffer.alloc(17);text.writeUInt32LE(1);text.writeUInt32LE(99999999,8);text.writeUInt32LE(16,12);for(const id of [10,20,30,40])text=addTextDbEntry(text,textPath,{id,text:'Text '+id});
  await p.createFiles([{path:name,data:scene},{path:geometryPath,data:geometry},{path:textPath,data:text}]);const history=p.manifest.history.length;
  const request={kind:'add-detector',name:'Quest',position:[0,0,0],mask:128,code:'untrusted',task:{...task,vehicle:{name:'dELIVERY',driverOnly:true},textDb:textPath,textHash:hash(text)}};
  for(const car of ['Missing','Static','Destination'])await assert.rejects(()=>p.changeSceneObject(name,{...request,task:{...request.task,vehicle:{name:car,driverOnly:true}}},hash(scene)),/Úkol/);
  const wrongPlayer=editScene(scene,inspectScene(scene).entries.find(e=>e.label==='Typ aktéra').id,27);await p.change(name,wrongPlayer,'NPC is not the player');await assert.rejects(()=>p.changeSceneObject(name,request,hash(wrongPlayer)),/Player/);await p.undo();
  assert.equal(p.manifest.history.length,history);await p.changeSceneObject(name,request,hash(scene));const after=await p.read(name),parsed=inspectScene(after);
  assert.equal(parsed.actorScripts.find(a=>a.name==='Quest').code,missionTaskScript(task));
  assert.deepEqual(parsed.entries.filter(e=>e.actorParameter).map(e=>e.value),inspectScene(scene).entries.filter(e=>e.actorParameter).map(e=>e.value));assert(after.includes(Buffer.from('opaque')));
  const reopened=await ModProject.open(root);await reopened.export(path.join(root,'export'));assert.deepEqual(await fs.readFile(path.join(root,'export',name)),after);await reopened.undo();assert.deepEqual(await reopened.read(name),scene);assert.equal(reopened.manifest.history.length,history);
  const batch=reopened.changeBatch;reopened.changeBatch=async function(files,...args){await this.change(geometryPath,Buffer.concat([geometry,Buffer.from([1])]),'Concurrent geometry');return batch.call(this,files,...args);};
  await assert.rejects(()=>reopened.changeSceneObject(name,request,hash(scene)),/změnil/);assert.deepEqual(await reopened.read(name),scene);reopened.changeBatch=batch;await reopened.undo();assert.deepEqual(await reopened.read(geometryPath),geometry);assert.deepEqual(await reopened.read(textPath),text);
});
