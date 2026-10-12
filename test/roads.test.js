import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import * as THREE from 'three';
import {parseRoads,editRoads} from '../src/core/roads.js';
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
  for(const change of [{id:'nodes/3/speed',value:1},{id:'nodes/0/semaphore',value:1},{id:'nodes/0/position',value:[1,2,3]},{id:'crossings/0/directions/4/priority',value:1},{id:'crossings/0/directions/0/target',value:1},{id:'crossings/00/speed',value:1},{id:'nodes/0/speed',value:-1},{id:'nodes/0/speed',value:NaN},{id:'nodes/0/speed',value:1e50},{id:'crossings/0/semaphore',value:256},{id:'crossings/0/directions/0/priority',value:0x100000000},{id:'crossings/0/directions/0/lanes/0/type',value:1.2}])assert.throws(()=>editRoads(source,[change]));
  assert.throws(()=>editRoads(source,[{id:'nodes/0/speed',value:1},{id:'nodes/0/speed',value:2}]),/opakovaná/);
  const empty=Buffer.alloc(12);empty.writeUInt32LE(2);assert.deepEqual(parseRoads(empty),{crossings:[],nodes:[],warnings:[]});
});
test('road graph resolves both tagged tables and inspectors retain writable field identity',()=>{
  const file=parseRoads(fixture()),before=structuredClone(file),graph=roadGraph(file);
  assert.equal(graph.editable,false);assert.equal(graph.points.length,5);assert.equal(graph.linkCount,6);
  assert.deepEqual(graph.points[0].links.map(link=>link.target),[2,3]);assert.deepEqual(graph.points[2].links.map(link=>link.target),[0,3]);assert.deepEqual(graph.points[3].links.map(link=>link.target),[2,1]);
  assert.deepEqual(graph.points[2].position,file.nodes[0].position);assert.equal(graph.points[2].section,'nodes');assert.equal(graph.points[2].recordIndex,0);
  assert.deepEqual([roadReference(65535),roadReference(0),roadReference(32770)],['Bez vazby','Křižovatka 0','Bod 2']);
  assert.equal(roadEntries(file,'crossings',0).length,22);assert.deepEqual(roadEntries(file,'nodes',1).map(e=>e.id),['nodes/1/speed']);
  const changes=roadEntries(file,'crossings',0).concat(roadEntries(file,'nodes',0)).map(({id,value})=>({id,value}));assert.deepEqual(editRoads(fixture(),changes),fixture());assert.deepEqual(file,before);
});
test('road points select and frame in the shared instanced viewport without enabling a transform gizmo',()=>{
  const graph=roadGraph(parseRoads(fixture())),view=Object.create(NavigationViewport.prototype);let detached=0,selected;
  Object.assign(view,{root:new THREE.Group(),frames:new Map(),materials:new Set(),textures:new Set(),camera:new THREE.PerspectiveCamera(),controls:{target:new THREE.Vector3(),update(){}},gizmo:{attach(){throw new Error('read-only transform');},detach(){detached++;}},onSelect(frame){selected=frame;}});view.root.scale.z=-1;view.loadNavigation(graph);view.select('3');
  assert.equal(detached,1);assert.equal(selected.editable,false);assert.equal(selected.navigationIndex,3);assert.deepEqual(view.proxy.position.toArray(),[20,2,10]);assert.equal(view.markers.count,5);
  view.root.updateMatrixWorld(true);const ray=new THREE.Raycaster(new THREE.Vector3(20,2,0),new THREE.Vector3(0,0,-1));assert.equal(ray.intersectObject(view.markers)[0].instanceId,3);
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
