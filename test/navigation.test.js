import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import * as THREE from 'three';
import { parseNavigation, editNavigation, changeNavigationConnection, navigationLinkType } from '../src/core/navigation.js';
import { NavigationViewport } from '../src/ui/navigation.js';
import { ModProject } from '../src/core/project.js';
import { hash, writeSafe } from '../src/core/files.js';

function fixture() {
  const bytes=Buffer.alloc(8+3*30+3*8,0xac);bytes.writeUInt32LE(0x1abcedf);bytes.writeUInt32LE(3,4);
  for(let index=0;index<3;index++) {let o=8+index*30;[index*10,2,index*20].forEach((n,i)=>bytes.writeFloatLE(n,o+i*4));bytes.writeUInt16LE(1,o+12);bytes.writeUInt16LE(99,o+14);bytes.writeUInt16LE(12,o+16);bytes[o+28]=bytes[o+29]=1;}
  for(let index=0;index<3;index++){let o=98+index*8;bytes.writeUInt16LE((index+1)%3,o);bytes.writeUInt16LE(2,o+2);bytes.writeUInt32LE(0x7fc00055,o+4);}
  return bytes;
}
test('navigation points use array indices despite repeated IDs and preserve opaque point/link bytes',()=>{
  const source=fixture(),before=Buffer.from(source),parsed=parseNavigation(source);assert.equal(parsed.points.length,3);assert.equal(parsed.linkCount,3);assert.equal(parsed.points[0].links[0].target,1);
  assert.ok(parsed.points.every(p=>p.id===99));assert.deepEqual(editNavigation(source,[]),source);
  const result=editNavigation(source,[{id:'points/0/position',value:[3,4,5]},{id:'points/1/areaSize',value:80},{id:'links/0/target',value:2},{id:'links/0/type',value:0x8400}]);
  const edited=parseNavigation(result);assert.deepEqual(edited.points[0].position,[3,4,5]);assert.equal(edited.points[1].areaSize,80);assert.equal(edited.points[0].links[0].target,2);assert.equal(edited.points[0].links[0].type,0x8400);
  for(let i=0;i<source.length;i++)if(!(i>=8&&i<20)&&!(i>=54&&i<56)&&!(i>=98&&i<102))assert.equal(result[i],source[i],`byte ${i}`);
  assert.deepEqual(source,before);
  assert.deepEqual(editNavigation(result,[{id:'points/0/position',value:[0,2,0]},{id:'points/1/areaSize',value:12},{id:'links/0/target',value:1},{id:'links/0/type',value:2}]),source);
  const unequal=Buffer.from(source);unequal[36]=0;assert.equal(parseNavigation(unequal).warnings.length,1);assert.deepEqual(editNavigation(unequal,[]),unequal);
  unequal[36]=5;assert.equal(parseNavigation(unequal).linkCount,3);assert.equal(parseNavigation(unequal).points[0].capacity,5);assert.deepEqual(editNavigation(unequal,[]),unequal);
  const truncated=Buffer.from(source);truncated[37]=0;assert.throws(()=>parseNavigation(truncated),/vazeb/);
});
function connectionFixture() {
  const source=fixture(),point=Buffer.alloc(30,0xbe);[30,2,60].forEach((value,i)=>point.writeFloatLE(value,i*4));point.writeUInt16LE(1,12);point.writeUInt16LE(99,14);point[28]=point[29]=0;
  const bytes=Buffer.concat([source.subarray(0,98),point,source.subarray(98)]);bytes.writeUInt32LE(4,4);return bytes;
}
test('new navigation pairs follow game categories, one-way flags and distance while retaining all unrelated bytes',()=>{
  for(const [a,b,kind] of [[0,0,null],[0,1,1],[1,2,2],[2,16,16],[4,8,4],[1,4,null],[5,5,null],[32,64,null],[0x4001,1,1]])assert.equal(navigationLinkType(a,b),kind);
  const source=connectionFixture(),snapshot=Buffer.from(source);
  for(const direction of ['both','forward','backward']) {
    const changed=changeNavigationConnection(source,{action:'connect',from:0,to:3,direction}),parsed=parseNavigation(changed);
    assert.equal(changed.length,source.length+16);assert.equal(parsed.linkCount,5);assert.ok(parsed.points.every(p=>p.id===99));
    const forward=parsed.points[0].links.at(-1),reverse=parsed.points[3].links[0];
    assert.equal(forward.target,3);assert.equal(reverse.target,0);assert.equal(forward.type,direction==='backward'?0x81:1);assert.equal(reverse.type,direction==='forward'?0x81:1);
    assert.equal(changed.readFloatLE(128+forward.index*8+4),Math.fround(Math.sqrt(4500)));assert.equal(changed.readFloatLE(128+reverse.index*8+4),Math.fround(Math.sqrt(4500)));
    for(let i=0;i<128;i++)if(![36,37,126,127].includes(i))assert.equal(changed[i],source[i],`header/node byte ${i}`);
    for(let index=0;index<3;index++)assert.deepEqual(changed.subarray(128+parsed.points[index].links[0].index*8,136+parsed.points[index].links[0].index*8),source.subarray(128+index*8,136+index*8));
    assert.deepEqual(changeNavigationConnection(changed,{action:'disconnect',from:3,to:0}),source);
  }
  assert.deepEqual(source,snapshot);
  const removed=changeNavigationConnection(source,{action:'disconnect',from:1,to:0});assert.equal(parseNavigation(removed).linkCount,2);assert.equal(parseNavigation(removed).points[0].links.length,0);assert.deepEqual(removed.subarray(128),source.subarray(136));
});
test('navigation connection changes reject invalid requests and unsafe category, duplicate, count or distance inputs',()=>{
  const source=connectionFixture();
  for(const request of [null,{}, {action:'toggle',from:0,to:3},{action:'connect',from:0,to:0},{action:'connect',from:0,to:4},{action:'connect',from:-1,to:3},{action:'connect',from:0.5,to:3},{action:'connect',from:0,to:'3'},{action:'connect',from:0,to:3,direction:'other'},{action:'connect',from:0,to:1},{action:'disconnect',from:0,to:3}])assert.throws(()=>changeNavigationConnection(source,request));
  const incompatible=Buffer.from(source);incompatible.writeUInt16LE(4,110);assert.throws(()=>changeNavigationConnection(incompatible,{action:'connect',from:0,to:3}),/kategorií/);
  const far=Buffer.from(source);far.writeFloatLE(-3e38,8);far.writeFloatLE(3e38,98);assert.throws(()=>changeNavigationConnection(far,{action:'connect',from:0,to:3}),/vzdálenost/);
  const full=Buffer.alloc(8+3*30+255*8);full.writeUInt32LE(0x1abcedf);full.writeUInt32LE(3,4);full[36]=full[37]=255;
  for(let index=0;index<3;index++)full.writeUInt16LE(1,8+index*30+12);
  for(let index=0;index<255;index++)full.writeUInt16LE(1,98+index*8);
  assert.throws(()=>changeNavigationConnection(full,{action:'connect',from:0,to:2}),/255/);
});
test('navigation refuses broken counts, invalid positions, dangling links and invalid edits',()=>{
  const source=fixture();assert.throws(()=>parseNavigation(source.subarray(0,-1)),/vazeb/);const magic=Buffer.from(source);magic[0]=0;assert.throws(()=>parseNavigation(magic),/hlavička/);
  const point=Buffer.from(source);point.writeFloatLE(Infinity,8);assert.throws(()=>parseNavigation(point),/pozice/);
  const link=Buffer.from(source);link.writeUInt16LE(99,98);assert.throws(()=>parseNavigation(link),/mimo/);
  const count=Buffer.from(source);count.writeUInt32LE(65537,4);assert.throws(()=>parseNavigation(count),/body/);
  for(const change of [{id:'points/3/id',value:1},{id:'points/0/target',value:1},{id:'links/0/position',value:[0,0,0]},{id:'links/3/type',value:1},{id:'links/0/target',value:99},{id:'points/0/type',value:1.1},{id:'points/0/id',value:-1},{id:'points/0/areaSize',value:65536},{id:'points/0/position',value:[0,NaN,0]},{id:'points/0/position',value:[0,1e50,0]}])assert.throws(()=>editNavigation(source,[change]));
  assert.throws(()=>editNavigation(source,[{id:'points/0/id',value:1},{id:'points/0/id',value:2}]),/opakovaná/);
  const empty=source.subarray(0,8);empty.writeUInt32LE(0,4);assert.equal(parseNavigation(empty).points.length,0);
});
test('instanced navigation preview fits actual point positions and moves only incident edges without mutating the source',()=>{
  const file=parseNavigation(fixture()),before=structuredClone(file),view=Object.create(NavigationViewport.prototype);
  Object.assign(view,{root:new THREE.Group(),frames:new Map(),materials:new Set(),textures:new Set(),camera:new THREE.PerspectiveCamera(),controls:{target:new THREE.Vector3(),update(){}},gizmo:{attach(o){this.object=o;}},onSelect(){}});view.root.scale.z=-1;view.loadNavigation(file);
  assert.ok(view.controls.target.distanceTo(new THREE.Vector3(10,2,-20))<1e-6);view.select('1');assert.equal(view.proxy.userData.frame.navigationIndex,1);
  view.updatePoint(1,[100,6,200]);assert.deepEqual(view.lines.geometry.getAttribute('position').array.slice(3,6),new Float32Array([100,6,200]));
  assert.deepEqual(view.lines.geometry.getAttribute('position').array.slice(6,9),new Float32Array([100,6,200]));assert.deepEqual(view.proxy.position.toArray(),[100,6,200]);
  view.root.updateMatrixWorld(true); const ray = new THREE.Raycaster(new THREE.Vector3(100,6,-190),new THREE.Vector3(0,0,-1));
  assert.equal(ray.intersectObject(view.markers)[0].instanceId,1);
  view.updateTarget(0,2);view.updatePoint(1,[101,7,201]);assert.deepEqual(view.lines.geometry.getAttribute('position').array.slice(3,6),new Float32Array(file.points[2].position));
  view.updateTarget(0,0);view.updatePoint(0,[1,2,3]);assert.deepEqual(view.lines.geometry.getAttribute('position').array.slice(0,6),new Float32Array([1,2,3,1,2,3]));
  assert.deepEqual(file,before);
});
test('navigation saves and exports in a project with stale-write protection and exact undo',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'mafia-nav-test-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const source=fixture(),asset={path:'missions/TEST/check.bin',original:'originals/a1/missions/TEST/check.bin',sha256:hash(source),archive:'a1.dta',size:source.length,variants:[{}]};
  await writeSafe(root,asset.original,source);await writeSafe(root,'workbench.json',JSON.stringify({format:'mafia-workbench',version:1,name:'Navigation',assets:[asset],history:[]}));
  const p=await ModProject.open(root),file=await p.inspect(asset.path);assert.equal(file.type,'navigation');await assert.rejects(p.saveNavigation(asset.path,[],'0'.repeat(64)),/změnil/);
  await p.saveNavigation(asset.path,[{id:'points/0/position',value:[10,20,30]},{id:'links/0/target',value:2}],file.sha256);
  const reopen=await ModProject.open(root);assert.deepEqual((await reopen.inspect(asset.path)).points[0].position,[10,20,30]);await reopen.export(path.join(root,'export'));assert.deepEqual(await fs.readFile(path.join(root,'export',asset.path)),await reopen.read(asset.path));
  assert.deepEqual(await fs.readFile(path.join(root,asset.original)),source);await reopen.undo();assert.deepEqual(await reopen.read(asset.path),source);
});
test('navigation topology saves as one protected history step, exports and undoes exactly',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'mafia-nav-pair-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const source=connectionFixture(),asset={path:'missions/TEST/check.bin',original:'originals/a1/missions/TEST/check.bin',sha256:hash(source),archive:'a1.dta',size:source.length,variants:[{}]};
  await writeSafe(root,asset.original,source);await writeSafe(root,'workbench.json',JSON.stringify({format:'mafia-workbench',version:1,name:'Connections',assets:[asset],history:[]}));
  const p=await ModProject.open(root),request={action:'connect',from:0,to:3,direction:'forward'};
  await assert.rejects(p.changeNavigationConnection(asset.path,request,'0'.repeat(64)),/změnil/);assert.equal(p.manifest.history.length,0);
  await assert.rejects(p.changeNavigationConnection('missions/TEST/road.bin',request,hash(source)),/check/);
  await p.changeNavigationConnection(asset.path,request,hash(source));assert.equal(p.manifest.history.length,1);
  const changed=changeNavigationConnection(source,request),reopen=await ModProject.open(root);assert.deepEqual(await reopen.read(asset.path),changed);
  await assert.rejects(reopen.changeNavigationConnection(asset.path,{action:'disconnect',from:0,to:3},hash(source)),/změnil/);
  await reopen.export(path.join(root,'export'));assert.deepEqual(await fs.readFile(path.join(root,'export',asset.path)),changed);
  await reopen.changeNavigationConnection(asset.path,{action:'disconnect',from:0,to:3},hash(changed));assert.deepEqual(await reopen.read(asset.path),source);
  await reopen.undo();assert.deepEqual(await reopen.read(asset.path),changed);await reopen.undo();assert.deepEqual(await reopen.read(asset.path),source);
  assert.deepEqual(await fs.readFile(path.join(root,asset.original)),source);assert.equal(reopen.manifest.history.length,0);
});
