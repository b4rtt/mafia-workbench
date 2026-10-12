import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectCache, editCache } from '../src/core/cache.js';
const chunk = (type, payload) => { const h = Buffer.alloc(6); h.writeUInt16LE(type); h.writeUInt32LE(payload.length + 6,2); return Buffer.concat([h,payload]); };
const u32 = n => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const text = value => { const b = Buffer.from(value); return Buffer.concat([u32(b.length),b]); };
const floats = numbers => { const b = Buffer.alloc(numbers.length*4); numbers.forEach((n,i)=>b.writeFloatLE(n,i*4)); return b; };
function fixture() {
  const opaque = chunk(9999, Buffer.from([0xde,0xad,0xbe,0xef]));
  const frame = chunk(2000, Buffer.concat([text('lamp.i3d'),floats([1,2,3,1,0,0,0,1,1,1]),u32(0xffffffff),floats([2,2,2]),Buffer.from([0xfa,0xce])]));
  const part = chunk(1000, Buffer.concat([text('base'),floats(Array.from({length:19},(_,i)=>i)), frame, opaque]));
  return Buffer.concat([chunk(500, Buffer.concat([u32(1),part,opaque]))]);
}
test('cache edits resize ancestors and preserve opaque chunks, flags and secondary transforms', () => {
  const source = fixture(), original = inspectCache(source), object = original.parts[0].objects[0];
  assert.deepEqual(object.position,[1,2,3]); assert.equal(object.model,'lamp.i3d'); assert.deepEqual(object.secondaryScale,[2,2,2]);
  assert.deepEqual(editCache(source,[]),source);
  const changes = [{ id:object.fields.position,value:[4,5,6] },{ id:object.fields.model,value:'longer-lamp.i3d' }];
  const changed = editCache(source,changes), after = inspectCache(changed).parts[0].objects[0];
  assert.deepEqual(after.position,[4,5,6]); assert.equal(after.model,'longer-lamp.i3d'); assert.deepEqual(after.secondaryScale,[2,2,2]);
  assert.equal(changed.readUInt32LE(2),changed.length);
  assert.ok(changed.includes(Buffer.from([0xde,0xad,0xbe,0xef]))); assert.ok(changed.includes(Buffer.from([0xfa,0xce])));
  assert.deepEqual(editCache(changed,[{id:after.fields.position,value:[1,2,3]},{id:after.fields.model,value:'lamp.i3d'}]),source);
});
test('cache refuses invalid bounds, unknown versions and nonfinite edits', () => {
  const source = fixture(), object = inspectCache(source).parts[0].objects[0];
  assert.throws(()=>inspectCache(source.subarray(0,-1)),/chunk/);
  const version=Buffer.from(source);version.writeUInt32LE(2,6);assert.throws(()=>inspectCache(version),/verze/);
  assert.throws(()=>editCache(source,[{id:object.fields.position,value:[1,Infinity,3]}]),/číselná/);
  assert.throws(()=>editCache(source,[{id:object.fields.model,value:'😀'}]),/kódování/);
  assert.throws(()=>editCache(source,[{id:'unknown',value:0}]),/vlastnost/);
  assert.throws(()=>editCache(source,[{id:object.fields.model,value:'a'},{id:object.fields.model,value:'b'}]),/vlastnost/);
});
