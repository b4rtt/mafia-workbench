import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import iconv from 'iconv-lite';
import { inspectDifference, editDifference } from '../src/core/difference.js';
import { ModProject } from '../src/core/project.js';
import { hash, writeSafe } from '../src/core/files.js';
import { assetCategory } from '../src/shared/categories.js';
const uint = value => { const b=Buffer.alloc(4); b.writeUInt32LE(value); return b; };
const text = value => { const b=iconv.encode(value,'windows-1250'); return Buffer.concat([uint(b.length),b]); };
const chunk = (type,payload) => { const h=Buffer.alloc(6); h.writeUInt16LE(type); h.writeUInt32LE(payload.length+6,2); return Buffer.concat([h,payload]); };
function fixture() {
  const transform=Buffer.alloc(44); transform.writeUInt32LE(9); [1,-0,3,1,1,1,1,0,0,0].forEach((v,i)=>transform.writeFloatLE(v,4+i*4));
  const object=chunk(100,Buffer.concat([transform,text('Bedna'),text('Parent'),text('bedna02.i3d'),Buffer.from([0xfa,0x00])]));
  const actor=chunk(200,Buffer.concat([uint(2),Buffer.from([0xff,0xca,0x7f])]));
  const binding=chunk(400,Buffer.concat([text('Door'),uint(33),Buffer.from([0xf0])]));
  const scripts=chunk(500,Buffer.concat([Buffer.from([1]),text('Začátek'),text('wait 100\r\n'),Buffer.from([7]),text('Konec'),text('end\r\n')]));
  return chunk(1234,Buffer.concat([object,actor,binding,scripts,chunk(300,Buffer.from([0xde,0xad,0xbe,0xef]))]));
}
test('CHG reads engine frame and binding order and preserves every byte on no-op',()=>{
  const bytes=fixture(), before=Buffer.from(bytes), file=inspectDifference(bytes);
  assert.equal(file.blocks,5); assert.equal(file.objects[0].resource,'bedna02.i3d'); assert.deepEqual(file.bindings,[{index:2,name:'Door',kind:33}]);
  assert.equal(file.actors[0].kind,2); assert.equal(file.opaqueBytes,10); assert.equal(file.entries.length,5);
  assert.deepEqual(editDifference(bytes,file.entries.map(e=>({id:e.id,value:e.value}))),bytes);
  const changed=editDifference(bytes,[{id:'0/position',value:[5,0,3]}]);
  assert.deepEqual([...bytes.keys()].filter(i=>bytes[i]!==changed[i]),[18,19]); // X=1 -> 5; original negative zero stays untouched.
  assert.deepEqual(editDifference(changed,[{id:'0/position',value:file.objects[0].position}]),bytes); assert.deepEqual(bytes,before);
});
test('CHG script resizing updates both sizes while preserving siblings, prefixes and opaque data',()=>{
  const bytes=fixture(), file=inspectDifference(bytes), script=file.entries.find(e=>e.id==='3/script/0');
  const value={name:'Úvodní skript',code:'wait 250\r\nend\r\n'}, changed=editDifference(bytes,[{id:script.id,value}]), next=inspectDifference(changed);
  assert.deepEqual(next.entries.find(e=>e.id===script.id).value,value); assert.deepEqual(next.objects,file.objects); assert.deepEqual(next.bindings,file.bindings);
  assert.deepEqual(next.entries.find(e=>e.id==='3/script/1'),file.entries.find(e=>e.id==='3/script/1'));
  assert.equal(changed.readUInt32LE(2),changed.length); assert.deepEqual(editDifference(changed,[{id:script.id,value:script.value}]),bytes);
});
test('CHG rejects malformed sizes, truncated text, unsafe values and unsupported edits',()=>{
  const bytes=fixture();
  for(const offset of [0,2,8]){const bad=Buffer.from(bytes);bad[offset]=0;assert.throws(()=>inspectDifference(bad));}
  const truncated=bytes.subarray(0,bytes.length-1);assert.throws(()=>inspectDifference(truncated));
  const bad=Buffer.from(bytes);bad.writeUInt32LE(0xffffffff,56);assert.throws(()=>inspectDifference(bad));
  for(const changes of [[{id:'0/name',value:'Rename'}],[{id:'0/position',value:[1e40,0,0]}],[{id:'0/position',value:['1',0,0]}],[{id:'0/rotation',value:[0,0,0,0]}],[{id:'3/script/0',value:{name:'Bad',code:'🙂'}}],[{id:'0/scale',value:[1,1,1]},{id:'0/scale',value:[2,2,2]}]]) assert.throws(()=>editDifference(bytes,changes));
});
test('CHG project saves, reopens, exports and undoes with stale guards and preserved originals',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'mafia-chg-test-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const bytes=fixture(),asset={path:'diff/Test.chg',original:'originals/a4/diff/Test.chg',sha256:hash(bytes),size:bytes.length,archive:'A4.dta',variants:[{}]};
  await writeSafe(root,asset.original,bytes);await writeSafe(root,'workbench.json',JSON.stringify({format:'mafia-workbench',version:1,name:'Difference',assets:[asset],history:[]}));
  const project=await ModProject.open(root), file=await project.inspect(asset.path); assert.equal(file.type,'difference');assert.equal(assetCategory('DIFF/Test.CHG'),'cutscenes');assert.equal(assetCategory('records/Test.REP'),'cutscenes');
  const changes=[{id:'3/script/0',value:{name:'Začátek',code:'wait 999\r\n'}}];await assert.rejects(project.saveDifference(asset.path,changes,'0'.repeat(64)),/změnil/);
  await project.saveDifference(asset.path,changes,file.sha256);const reopened=await ModProject.open(root);assert.equal((await reopened.inspect(asset.path)).entries.find(e=>e.id==='3/script/0').value.code,changes[0].value.code);
  await assert.rejects(reopened.saveDifference(asset.path,[],file.sha256),/změnil/);await reopened.export(path.join(root,'export'));assert.deepEqual(await fs.readFile(path.join(root,'export',asset.path)),await reopened.read(asset.path));
  await reopened.undo();assert.deepEqual(await reopened.read(asset.path),bytes);assert.deepEqual(await fs.readFile(path.join(root,asset.original)),bytes);
});
