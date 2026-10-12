import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {inspectDoor,editDoor} from '../src/core/doors.js';
import {inspectScene,editScene} from '../src/core/scene.js';
import {groupSceneProperties} from '../src/shared/scene-properties.js';
import {ModProject} from '../src/core/project.js';
import {hash,writeSafe} from '../src/core/files.js';

function data(){const b=Buffer.alloc(77,0xcd);b.writeUInt32LE(8);b[4]=0x93;b[5]=1;b[6]=b[11]=b[12]=0;b.writeFloatLE(Math.PI/2,7);b.writeFloatLE(Math.PI/2000,13);b.writeFloatLE(Math.PI/1000,17);b.write('open.wav\0',21);b.write('close.wav\0',37);b.write('locked.wav\0',53);b[69]=0x71;return b;}
const chunk=(type,payload)=>{const h=Buffer.alloc(6);h.writeUInt16LE(type);h.writeUInt32LE(payload.length+6,2);return Buffer.concat([h,payload]);};
function scene(payload,kind=6){const type=Buffer.alloc(4);type.writeUInt32LE(kind);return chunk(0x4c53,Buffer.concat([chunk(0x4000,chunk(0x4010,chunk(0x10,Buffer.from('Leaf\0')))),chunk(0xae20,chunk(0xae21,Buffer.concat([chunk(0xae23,Buffer.from('Leaf\0')),chunk(0xae22,type),chunk(0xae24,payload)]))),chunk(0xface,Buffer.from('opaque'))]));}
test('door v8 fields use degrees and degrees per second, with exact no-op and byte-local writes',()=>{
  const original=data(),entries=inspectDoor(original);assert.equal(entries.length,10);assert.ok(Math.abs(entries.find(e=>e.key==='angle').value-90)<.00001);assert.ok(Math.abs(entries.find(e=>e.key==='openSpeed').value-90)<.00001);
  const values={bothDirections:false,reverse:true,angle:120,opened:true,locked:true,openSpeed:45,closeSpeed:60,openSound:'x.wav',closeSound:'',lockedSound:'jiné.wav'};
  for(const entry of entries){assert.deepEqual(editDoor(original,entry.key,entry.value),original);const after=editDoor(original,entry.key,values[entry.key]);assert.notDeepEqual(after,original);
    assert.deepEqual(after.subarray(0,entry.offset),original.subarray(0,entry.offset));assert.deepEqual(after.subarray(entry.offset+entry.bytes),original.subarray(entry.offset+entry.bytes));
    const actual=inspectDoor(after).find(e=>e.key===entry.key).value;if(entry.kind==='float')assert.ok(Math.abs(actual-values[entry.key])<.0001);else assert.equal(actual,values[entry.key]);
    if(entry.kind==='string'){const end=entry.offset+Buffer.byteLength(values[entry.key],'latin1')+1;assert.deepEqual(after.subarray(end,entry.offset+16),original.subarray(end,entry.offset+16));}
  }
  assert.equal(editDoor(original,'angle',180).readFloatLE(7),Math.fround(Math.PI));assert.equal(editDoor(original,'openSpeed',180).readFloatLE(13),Math.fround(Math.PI/1000));
});
test('door parser leaves unsupported or malformed data opaque and rejects invalid writes',()=>{
  const original=data();for(const n of [0,3,69])assert.deepEqual(inspectDoor(original.subarray(0,n)),[]);
  for(const version of [5,7,9,0x1000008]){const b=Buffer.from(original);b.writeUInt32LE(version);assert.deepEqual(inspectDoor(b),[]);assert.throws(()=>editDoor(b,'locked',true));}
  for(const offset of [5,6,11,12]){const b=Buffer.from(original);b[offset]=2;assert.deepEqual(inspectDoor(b),[]);}
  for(const offset of [7,13,17]){const b=Buffer.from(original);b.writeFloatLE(NaN,offset);assert.deepEqual(inspectDoor(b),[]);}
  for(const offset of [21,37,53]){const b=Buffer.from(original);b.fill(65,offset,offset+16);assert.deepEqual(inspectDoor(b),[]);}
  for(const [key,value] of [['missing',true],['locked',1],['angle',361],['angle',-1],['angle','90'],['openSpeed',Infinity],['openSpeed',1e100],['openSound','1234567890123456'],['openSound','\0'],['openSound','🙂']])assert.throws(()=>editDoor(original,key,value),/Dveře/);
  assert.equal(inspectScene(scene(original,4)).entries.filter(e=>e.doorParameter).length,0);
});
test('scene binds door properties to the frame, preserves actor and chunks, and supports project export and undo',async t=>{
  const payload=data(),original=scene(payload),parsed=inspectScene(original),door=parsed.entries.filter(e=>e.doorParameter);assert.equal(door.length,10);const group=groupSceneProperties(parsed).find(g=>g.name==='Leaf');assert.equal(group.entries.filter(e=>e.entry.doorParameter).length,10);
  const locked=door.find(e=>e.key==='locked'),start=original.indexOf(payload),after=editScene(original,locked.id,true);const expected=Buffer.from(original);expected[start+12]=1;assert.deepEqual(after,expected);assert.deepEqual(editScene(after,locked.id,false),original);
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'mafia-door-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));await writeSafe(root,'workbench.json',JSON.stringify({format:'mafia-workbench',version:1,name:'Doors',assets:[],history:[]}));const p=await ModProject.open(root),name='missions/DOOR/scene2.bin';await p.createFiles([{path:name,data:original}]);await p.saveScene(name,[{id:locked.id,value:true}],hash(original));assert.deepEqual(await p.read(name),expected);
  const reopened=await ModProject.open(root),dest=path.join(root,'export');await reopened.export(dest);assert.deepEqual(await fs.readFile(path.join(dest,name)),expected);await reopened.undo();assert.deepEqual(await reopened.read(name),original);
});
