import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import * as THREE from 'three';
import { parseTrack, editTrack } from '../src/core/track.js';
import { sampleTrack, TrackViewport } from '../src/ui/track.js';
import { ModProject } from '../src/core/project.js';
import { hash, writeSafe } from '../src/core/files.js';

function fixture(secondary = true) {
  const source = Buffer.alloc(44 + 3*12 + (secondary?3*12:0) + 5);
  source.writeUInt32LE(4,0); source.writeUInt32LE(40,28); source.writeUInt32LE(20,32); source.writeUInt32LE(3,36);
  [0,0,-0, 2,1,-4, 4,2,-8].forEach((v,i)=>source.writeFloatLE(v,40+i*4));
  source.writeUInt32LE(secondary?3:0,76);
  if (secondary) [0,0,1, 0,0,1, 1,0,0].forEach((v,i)=>source.writeFloatLE(v,80+i*4));
  source.fill(0xfa,source.length-5); return source;
}
test('TCK v4 changes selected vector components and preserves header, timing, -0 and opaque tail',()=>{
  const source=fixture(), before=Buffer.from(source), file=parseTrack(source);
  assert.equal(file.tailBytes,5); assert.equal(file.duration,40); assert.equal(file.step,20); assert.equal(file.secondary.length,3);
  assert.deepEqual(editTrack(source,[{id:'positions/0',value:[0,0,0]},{id:'secondary/2',value:[1,0,0]}]),source);
  const changed=editTrack(source,[{id:'positions/1',value:[7,1,-4]},{id:'secondary/2',value:[0,1,0]}]);
  for (let i=0;i<source.length;i++) if (!(i>=52&&i<56)&&!(i>=104&&i<112)) assert.equal(changed[i],source[i],`byte ${i}`);
  assert.deepEqual(parseTrack(changed).positions[1],[7,1,-4]); assert.deepEqual(source,before);
  assert.deepEqual(editTrack(changed,[{id:'positions/1',value:file.positions[1]},{id:'secondary/2',value:file.secondary[2]}]),source);
  assert.equal(parseTrack(fixture(false)).secondary.length,0);
});
test('TCK refuses unsupported headers, truncated arrays, mismatched timing and unsafe edits',()=>{
  const source=fixture();
  for (const [offset,value] of [[0,2],[32,0],[36,0],[36,1000001],[28,41],[76,2]]) { const bad=Buffer.from(source); bad.writeUInt32LE(value,offset); assert.throws(()=>parseTrack(bad)); }
  assert.throws(()=>parseTrack(source.subarray(0,78))); assert.throws(()=>parseTrack(source.subarray(0,110)));
  const nan=Buffer.from(source); nan.writeFloatLE(NaN,40); assert.throws(()=>parseTrack(nan),/vektor/);
  for (const change of [{id:'positions/3',value:[0,0,0]},{id:'positions/01',value:[0,0,0]},{id:'duration',value:1},{id:'positions/0',value:[1e50,0,0]},{id:'positions/0',value:['1',0,0]},{id:'positions/0',value:[NaN,0,0]}]) assert.throws(()=>editTrack(source,[change]));
  assert.throws(()=>editTrack(source,[{id:'positions/0',value:[1,0,0]},{id:'positions/0',value:[2,0,0]}]),/opakovaný/);
  assert.throws(()=>editTrack(fixture(false),[{id:'secondary/0',value:[1,0,0]}]));
});
test('trajectory preview clamps, interpolates, reflects Z and updates path without modifying source',()=>{
  const file=parseTrack(fixture()), before=structuredClone(file);
  assert.deepEqual(sampleTrack(file.positions,20,10),[1,.5,-2]); assert.deepEqual(sampleTrack(file.positions,20,-10),file.positions[0]); assert.deepEqual(sampleTrack(file.positions,20,100),file.positions[2]); assert.equal(sampleTrack([],20,0),null);
  const view=Object.create(TrackViewport.prototype); Object.assign(view,{root:new THREE.Group(),materials:new Set(),camera:new THREE.PerspectiveCamera(),controls:{target:new THREE.Vector3(),update(){}}}); view.root.scale.z=-1;
  view.loadTrack(file); view.seek(10); view.root.updateMatrixWorld(true); assert.deepEqual(view.marker.getWorldPosition(new THREE.Vector3()).toArray(),[1,.5,2]);
  view.updateKey(1,[6,1,-4]); assert.deepEqual(view.marker.position.toArray(),[3,.5,-2]); assert.deepEqual([...view.path.geometry.attributes.position.array].slice(3,6),[6,1,-4]); assert.deepEqual(file,before);
});
test('track project edit guards stale data, exports, reopens and undoes without changing originals',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'mafia-track-test-')); t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const source=fixture(), asset={path:'anims/Test.tck',original:'originals/a4/anims/Test.tck',sha256:hash(source),size:source.length,archive:'A4.dta',variants:[{}]};
  await writeSafe(root,asset.original,source); await writeSafe(root,'workbench.json',JSON.stringify({format:'mafia-workbench',version:1,name:'Track',assets:[asset],history:[]}));
  const project=await ModProject.open(root), file=await project.inspect(asset.path); assert.equal(file.type,'track');
  await assert.rejects(project.saveTrack(asset.path,[{id:'positions/1',value:[7,1,-4]}],'0'.repeat(64)),/změnil/);
  await project.saveTrack('ANIMS/test.TCK',[{id:'positions/1',value:[7,1,-4]}],file.sha256);
  const reopened=await ModProject.open(root); assert.deepEqual((await reopened.inspect(asset.path)).positions[1],[7,1,-4]);
  await assert.rejects(reopened.saveTrack(asset.path,[],file.sha256),/změnil/); await reopened.export(path.join(root,'export'));
  assert.deepEqual(await fs.readFile(path.join(root,'export',asset.path)),await reopened.read(asset.path)); await reopened.undo(); assert.deepEqual(await reopened.read(asset.path),source); assert.deepEqual(await fs.readFile(path.join(root,asset.original)),source);
  await fs.rm(path.join(root,'mods',asset.path)); const unsupported=Buffer.from(source); unsupported.writeUInt32LE(2,0); await fs.writeFile(path.join(root,asset.original),unsupported); asset.sha256=hash(unsupported);
  await writeSafe(root,'workbench.json',JSON.stringify({...project.manifest,assets:[asset],history:[]})); const bad=await ModProject.open(root); assert.equal((await bad.inspect(asset.path)).type,'binary'); assert.match((await bad.inspect(asset.path)).warning,/verze 4/);
});
