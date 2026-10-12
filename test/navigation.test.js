import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import * as THREE from 'three';
import { parseNavigation, editNavigation } from '../src/core/navigation.js';
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
  const unequal=Buffer.from(source);unequal[37]=0;assert.equal(parseNavigation(unequal).warnings.length,1);assert.deepEqual(editNavigation(unequal,[]),unequal);
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
