import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import * as THREE from 'three';
import {parseRoads,editRoads,prepareRoadEdits} from '../src/core/roads.js';
import {roadGraph,roadEntries,roadReference} from '../src/shared/roads.js';
import {NavigationViewport} from '../src/ui/navigation.js';
import {ModProject} from '../src/core/project.js';
import {hash,writeSafe} from '../src/core/files.js';

function fixture() {
  const bytes=Buffer.alloc(12+2*236+3*24,0xac);bytes.writeUInt32LE(2);bytes.writeUInt32LE(2,4);bytes.writeUInt32LE(3,480);
  for(let i=0;i<2;i++) {
    const at=8+i*236;[i*40,2,i*20].forEach((v,j)=>bytes.writeFloatLE(v,at+j*4));bytes[at+12]=1;bytes.writeFloatLE(12,at+16);
    for(let slot=0;slot<4;slot++){
      bytes.writeUInt16LE(i===0&&slot<2?32768+slot:65535,at+20+slot*2);
      const offset=at+28+slot*52;bytes.writeUInt16LE(i===0&&slot===0?1:65535,offset);bytes.writeUInt32LE(0xdeadbeef,offset+14);
      // Inactive direction floats have opaque NaN payloads, not editable floats.
      bytes.writeUInt32LE(0x7fc00055,offset+4);
      for(let lane=0;lane<4;lane++)bytes[offset+22+lane*8]=3;
    }
  }
  for(let i=0;i<3;i++){
    const at=484+i*24;[10+i*10,2,i*10].forEach((v,j)=>bytes.writeFloatLE(v,at+j*4));bytes.writeFloatLE(5,at+12);
    bytes.writeUInt16LE(i===0?0:i===1?32768:65535,at+16);bytes.writeUInt16LE(i===0?32769:i===1?1:65535,at+18);
    bytes.writeUInt16LE(0,at+20);bytes.writeUInt16LE(1,at+22);
  }
  return bytes;
}
function junction(){
  const bytes=Buffer.alloc(12+4*236+6*24,0xa7);bytes.writeUInt32LE(2);bytes.writeUInt32LE(4,4);bytes.writeUInt32LE(6,952);
  const positions=[[0,0,0],[10,0,0],[0,0,10],[-10,0,0]],nodePositions=[[-7,0,0],[-3,0,0],[0,0,3],[0,0,7],[3,0,0],[7,0,0]],links=[[32772,32770,32769,65535],[32773,65535,65535,65535],[32771,65535,65535,65535],[32768,65535,65535,65535]],targets=[[1,2,3,65535],[0,65535,65535,65535],[0,65535,65535,65535],[0,65535,65535,65535]],edges=[[32769,3],[0,32768],[0,32771],[32770,2],[0,32773],[32772,1]];
  for(let i=0;i<4;i++){const at=8+i*236;positions[i].forEach((n,j)=>bytes.writeFloatLE(n,at+j*4));bytes.writeFloatLE(10,at+16);for(let s=0;s<4;s++){bytes.writeUInt16LE(links[i][s],at+20+s*2);const slot=at+28+s*52;bytes.writeUInt16LE(targets[i][s],slot);bytes.writeFloatLE(10,slot+4);bytes.writeFloatLE(i===0?[Math.PI,Math.PI/2,Math.PI/2,0][s]:Math.PI*2,slot+8);bytes.writeUInt32LE(i*100+s,slot+14);for(let l=0;l<4;l++){bytes[slot+22+l*8]=1+s;bytes.writeUInt32LE(0x7fc00055+l,slot+24+l*8);}}}
  for(let i=0;i<6;i++){const at=956+i*24;nodePositions[i].forEach((n,j)=>bytes.writeFloatLE(n,at+j*4));bytes.writeFloatLE(10,at+12);bytes.writeUInt16LE(edges[i][0],at+16);bytes.writeUInt16LE(edges[i][1],at+18);bytes.writeUInt16LE(0,at+20);bytes.writeUInt16LE(i<2?3:i<4?2:1,at+22);}
  return bytes;
}
test('PC road v2 decodes aligned speed and tagged references and preserves all opaque bytes',()=>{
  const source=fixture(),before=Buffer.from(source),file=parseRoads(source);
  assert.equal(file.crossings.length,2);assert.equal(file.nodes.length,3);assert.deepEqual(file.crossings[0].position,[0,2,0]);assert.equal(file.crossings[0].speed,12);assert.equal(file.nodes[0].next,32769);
  assert.equal(file.crossings[0].directions[0].priority,0xdeadbeef);assert.equal(file.crossings[0].directions[0].lanes[0].type,3);assert.deepEqual(file.warnings,[]);assert.deepEqual(editRoads(source,[]),source);
  const changes=[{id:'crossings/0/speed',value:9},{id:'crossings/0/semaphore',value:0},{id:'crossings/0/directions/0/priority',value:4},{id:'crossings/0/directions/0/lanes/0/type',value:0},{id:'nodes/1/speed',value:7}];
  const changed=editRoads(source,changes),allowed=new Set([20,24,25,26,27,50,51,52,53,58,520,521,522,523]);
  for(let i=0;i<source.length;i++)if(!allowed.has(i))assert.equal(changed[i],source[i],`byte ${i}`);
  assert.equal(parseRoads(changed).nodes[1].speed,7);
  assert.deepEqual(editRoads(changed,changes.map((change,i)=>({...change,value:[12,1,0xdeadbeef,3,5][i]}))),source);assert.deepEqual(source,before);
});
test('roads reject truncated counts, dangling tagged references and invalid edits while retaining unsorted order',()=>{
  const source=fixture();assert.throws(()=>parseRoads(source.subarray(0,-1)),/délka/);
  for(const [offset,value] of [[0,1],[4,0xffffffff],[480,32768]]){const bytes=Buffer.from(source);bytes.writeUInt32LE(value,offset);assert.throws(()=>parseRoads(bytes));}
  for(const offset of [28,36,500,504]){const bytes=Buffer.from(source);bytes.writeUInt16LE(32771,offset);assert.throws(()=>parseRoads(bytes),/mimo/);}
  for(const offset of [8,24,484,496]){const bytes=Buffer.from(source);bytes.writeFloatLE(NaN,offset);assert.throws(()=>parseRoads(bytes));}
  const unsorted=Buffer.from(source);unsorted.writeFloatLE(-1,508);assert.equal(parseRoads(unsorted).warnings.length,1);assert.deepEqual(editRoads(unsorted,[]),unsorted);
  for(const change of [{id:'nodes/3/speed',value:1},{id:'nodes/0/semaphore',value:1},{id:'nodes/0/position',value:[1,2]},{id:'crossings/0/directions/4/priority',value:1},{id:'crossings/0/directions/0/target',value:1},{id:'crossings/00/speed',value:1},{id:'nodes/0/speed',value:-1},{id:'nodes/0/speed',value:NaN},{id:'nodes/0/speed',value:1e50},{id:'crossings/0/semaphore',value:256},{id:'crossings/0/directions/0/priority',value:0x100000000},{id:'crossings/0/directions/0/lanes/0/type',value:1.2}])assert.throws(()=>editRoads(source,[change]));
  assert.throws(()=>editRoads(source,[{id:'nodes/0/speed',value:1},{id:'nodes/0/speed',value:2}]),/opakovaná/);
  const empty=Buffer.alloc(12);empty.writeUInt32LE(2);assert.deepEqual(parseRoads(empty),{crossings:[],nodes:[],warnings:[]});
});
test('road graph resolves both tagged tables and inspectors retain writable field identity',()=>{
  const file=parseRoads(fixture()),before=structuredClone(file),graph=roadGraph(file);
  assert.equal(graph.editable,true);assert.equal(graph.points.length,5);assert.equal(graph.linkCount,6);
  assert.deepEqual(graph.points[0].links.map(link=>link.target),[2,3]);assert.deepEqual(graph.points[2].links.map(link=>link.target),[0,3]);assert.deepEqual(graph.points[3].links.map(link=>link.target),[2,1]);
  assert.deepEqual(graph.points[2].position,file.nodes[0].position);assert.equal(graph.points[2].section,'nodes');assert.equal(graph.points[2].recordIndex,0);
  assert.deepEqual([roadReference(65535),roadReference(0),roadReference(32770)],['Bez vazby','Křižovatka 0','Bod 2']);
  assert.equal(roadEntries(file,'crossings',0).length,23);assert.deepEqual(roadEntries(file,'nodes',1).map(e=>e.id),['nodes/1/position','nodes/1/speed']);
  const changes=roadEntries(file,'crossings',0).concat(roadEntries(file,'nodes',0)).map(({id,value})=>({id,value}));assert.deepEqual(editRoads(fixture(),changes),fixture());assert.deepEqual(file,before);
});
test('road points enable translation, cursor selection and optional framing without losing restored camera details',()=>{
  const graph=roadGraph(parseRoads(fixture())),view=Object.create(NavigationViewport.prototype);let attached,selected;
  Object.assign(view,{root:new THREE.Group(),frames:new Map(),materials:new Set(),textures:new Set(),camera:new THREE.PerspectiveCamera(),controls:{target:new THREE.Vector3(),update(){}},gizmo:{attach(object){attached=object;},detach(){}},onSelect(frame){selected=frame;}});view.root.scale.z=-1;view.loadNavigation(graph);view.focusOnSelect=true;
  const snapshot={position:[20,2,-9.9],target:[20,2,-10],near:.001,far:20000};view.restoreCamera(snapshot);view.select('3',true,false);assert.deepEqual(view.captureCamera(),snapshot);
  assert.equal(attached,view.proxy);assert.equal(selected.editable,true);assert.equal(selected.navigationIndex,3);assert.deepEqual(view.proxy.position.toArray(),[20,2,10]);assert.equal(view.markers.count,5);
  view.root.updateMatrixWorld(true);const ray=new THREE.Raycaster(new THREE.Vector3(20,2,0),new THREE.Vector3(0,0,-1));assert.equal(ray.intersectObject(view.markers)[0].instanceId,3);view.select('2');assert.deepEqual(view.controls.target.toArray(),[10,2,0]);
});
test('road parameters save, reopen and export with stale-write protection and exact undo',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'mafia-road-test-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const source=fixture(),asset={path:'missions/TEST/road.bin',original:'originals/a1/missions/TEST/road.bin',sha256:hash(source),archive:'a1.dta',size:source.length,variants:[{}]};
  await writeSafe(root,asset.original,source);await writeSafe(root,'workbench.json',JSON.stringify({format:'mafia-workbench',version:1,name:'Roads',assets:[asset],history:[]}));
  const project=await ModProject.open(root),file=await project.inspect(asset.path);assert.equal(file.type,'roads');await assert.rejects(project.saveRoads(asset.path,[],hash(Buffer.from('stale'))),/změnil/);
  await project.saveRoads(asset.path,[{id:'nodes/0/speed',value:3},{id:'crossings/0/directions/0/lanes/0/type',value:0}],file.sha256);
  const reopen=await ModProject.open(root);assert.equal((await reopen.inspect(asset.path)).nodes[0].speed,3);await reopen.export(path.join(root,'export'));assert.deepEqual(await fs.readFile(path.join(root,'export',asset.path)),await reopen.read(asset.path));
  assert.deepEqual(await fs.readFile(path.join(root,asset.original)),source);await reopen.undo();assert.deepEqual(await reopen.read(asset.path),source);
  await assert.rejects(reopen.saveRoads('missions/TEST/check.bin',[],file.sha256),/road/);
});

test('moving a road node reorders whole records, repairs both tables and keeps selection identity and opaque bytes',()=>{
  const source=fixture(),before=Buffer.from(source),prepared=prepareRoadEdits(source,[{id:'nodes/1/position',value:[45,3,10]},{id:'nodes/1/speed',value:9}]),file=parseRoads(prepared.data);
  assert.deepEqual(prepared.mapping,[0,1,2,4,3]);assert.deepEqual(file.nodes[2].position,[45,3,10]);assert.equal(file.nodes[2].speed,9);assert.equal(file.nodes[0].next,32770);assert.equal(file.nodes[2].previous,32768);assert.equal(file.nodes[2].next,1);assert.equal(file.crossings[0].links[1],32770);
  assert.deepEqual(file.nodes[1],{...parseRoads(source).nodes[2],index:1});assert.deepEqual(file.warnings,[]);assert.deepEqual(source,before);
  // Restore record order and references independently before comparing bytes.
  const normalized=Buffer.from(prepared.data);normalized.set(source.subarray(508,556),508);normalized.set(source.subarray(500,504),500);normalized.set(source.subarray(30,32),30);normalized.set(source.subarray(40,44),40);normalized.set(source.subarray(44,48),44);
  assert.deepEqual(normalized,source);
});

test('crossing turn reordering carries every lane and priority with its original road, updates both travel lengths and retains inactive payloads',()=>{
  const source=junction(),prepared=prepareRoadEdits(source,[{id:'nodes/2/position',value:[-3,0,-3]},{id:'nodes/3/position',value:[-7,0,-7]}]),file=parseRoads(prepared.data);
  assert.deepEqual(prepared.mapping,[0,1,2,3,4,6,7,5,8,9]);assert.deepEqual(file.crossings[0].directions.map(row=>row.target),[1,3,2,65535]);assert.deepEqual(file.crossings[0].directions.map(row=>row.priority),[0,2,1,3]);assert.deepEqual(file.crossings[0].links,[32772,32770,32771,65535]);
  const length=Math.sqrt(18)+Math.sqrt(32)+Math.sqrt(338);assert.ok(Math.abs(prepared.data.readFloatLE(8+28+2*52+4)-length)<1e-5);assert.ok(Math.abs(prepared.data.readFloatLE(8+2*236+28+4)-length)<1e-5);
  const angles=[0,1,2].map(slot=>prepared.data.readFloatLE(8+28+slot*52+8));assert.ok(Math.abs(angles.reduce((a,b)=>a+b,0)-Math.PI*2)<1e-6);assert.ok(Math.abs(angles[1]-Math.PI)<1e-6);assert.ok(Math.abs(angles[2]-Math.PI/4)<1e-6);
  for(const [newSlot,oldSlot]of [[0,0],[1,2],[2,1],[3,3]]){const next=prepared.data.subarray(8+28+newSlot*52,8+28+(newSlot+1)*52),old=source.subarray(8+28+oldSlot*52,8+28+(oldSlot+1)*52);assert.deepEqual(next.subarray(12),old.subarray(12));assert.deepEqual(next.subarray(2,4),old.subarray(2,4));}
  assert.deepEqual(prepared.data.subarray(8+28+3*52,8+28+4*52),source.subarray(8+28+3*52,8+28+4*52));
  assert.equal(file.nodes[prepared.mapping[6]-4].next,32769);assert.equal(file.nodes[prepared.mapping[7]-4].previous,32771);
});

test('vertical moves update 3D length without touching turn metadata; no-ops and signed zero preserve unmodified data',()=>{
  const source=junction(),prepared=prepareRoadEdits(source,[{id:'crossings/0/position',value:[0,2,0]}]);assert.deepEqual(prepared.mapping,[0,1,2,3,4,5,6,7,8,9]);
  for(let crossing=0;crossing<4;crossing++)for(let slot=0;slot<4;slot++){const at=8+crossing*236+28+slot*52;assert.deepEqual(prepared.data.subarray(at+8,at+52),source.subarray(at+8,at+52));}
  assert.ok(Math.abs(prepared.data.readFloatLE(40)-(Math.sqrt(13)+7))<1e-5);
  const signed=editRoads(source,[{id:'crossings/0/position',value:[-0,0,0]}]);const expected=Buffer.from(source);expected.writeFloatLE(-0,8);assert.deepEqual(signed,expected);assert.deepEqual(editRoads(signed,[{id:'crossings/0/position',value:[-0,0,0]}]),signed);
});

test('single-node and direct crossing paths resolve tagged tangents and update reciprocal lengths without consuming orphan nodes',()=>{
  const single=junction();single.writeUInt16LE(2,956+2*24+18);single.writeUInt16LE(32770,8+2*236+20);
  const change={id:'nodes/2/position',value:[2,0,3]},prepared=prepareRoadEdits(single,[change]),file=parseRoads(prepared.data),cross=file.crossings[0],slot=cross.directions.findIndex(direction=>direction.target===2),expected=Math.sqrt(13)+Math.sqrt(53);
  assert.ok(Math.abs(prepared.data.readFloatLE(8+28+slot*52+4)-expected)<1e-5);assert.ok(Math.abs(prepared.data.readFloatLE(8+2*236+28+4)-expected)<1e-5);assert.equal(file.nodes.length,6);
  const direct=junction();direct.writeUInt16LE(1,28);direct.writeUInt16LE(0,8+236+20);const edited=editRoads(direct,[{id:'crossings/1/position',value:[11,0,1]}]),parsed=parseRoads(edited);
  assert.equal(parsed.crossings[0].links[0],1);assert.equal(parsed.crossings[1].links[0],0);assert.ok(Math.abs(edited.readFloatLE(40)-Math.sqrt(122))<1e-5);assert.ok(Math.abs(edited.readFloatLE(8+236+28+4)-Math.sqrt(122))<1e-5);
  assert.deepEqual(edited.subarray(956),direct.subarray(956));
});

test('unsafe route geometry rejects cycles, dead ends, inconsistent targets, invalid vectors and overflow without rewriting topology',()=>{
  const source=fixture();for(const value of [[1,2],[1,Infinity,3],[1e40,2,3],Array(3),['1',2,3]])assert.throws(()=>editRoads(source,[{id:'nodes/0/position',value}]),/pozice/);
  const dead=Buffer.from(source);dead.writeUInt16LE(65535,526);assert.throws(()=>editRoads(dead,[{id:'nodes/0/position',value:[11,2,0]}]),/nekončí/);assert.deepEqual(editRoads(dead,[]),dead);
  const cycle=Buffer.from(source);cycle.writeUInt16LE(32770,526);cycle.writeUInt16LE(32769,548);cycle.writeUInt16LE(32768,550);assert.throws(()=>editRoads(cycle,[{id:'nodes/0/position',value:[11,2,0]}]),/cyklická/);
  const target=Buffer.from(source);target.writeUInt16LE(0,36);assert.throws(()=>editRoads(target,[{id:'nodes/0/position',value:[11,2,0]}]),/cíl/);
  assert.throws(()=>editRoads(source,[{id:'nodes/0/position',value:[1e38,1e38,1e38]}]),/float32/);
  const flat=fixture();assert.throws(()=>editRoads(flat,[{id:'nodes/1/position',value:[10,3,0]}]),/směr/);
});

test('geometry saves publish one road file, return the index mapping, reopen/export and undo the original exact bytes',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'mafia-road-move-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const source=junction(),name='missions/TEST/road.bin';await writeSafe(root,'workbench.json',JSON.stringify({format:'mafia-workbench',version:1,name:'Road movement',assets:[],history:[]}));const project=await ModProject.open(root);await project.createFiles([{path:name,data:source},{path:'missions/TEST/scene2.bin',data:Buffer.from('unchanged scene')}]);const history=project.manifest.history.length;
  const changes=[{id:'nodes/2/position',value:[-3,0,-3]},{id:'nodes/3/position',value:[-7,0,-7]}],expected=prepareRoadEdits(source,changes);assert.deepEqual(await project.saveRoads(name,changes,hash(source)),expected.mapping);assert.deepEqual(await project.read(name),expected.data);assert.equal(project.manifest.history.at(-1).path,name);await assert.rejects(project.saveRoads(name,changes,hash(source)),/změnil/);
  const reopened=await ModProject.open(root),destination=path.join(root,'export');assert.deepEqual(await reopened.read(name),expected.data);await reopened.export(destination);assert.deepEqual(await fs.readFile(path.join(destination,name)),expected.data);assert.equal((await reopened.read('missions/TEST/scene2.bin')).toString(),'unchanged scene');await reopened.undo();assert.deepEqual(await reopened.read(name),source);assert.equal(reopened.manifest.history.length,history);
});
