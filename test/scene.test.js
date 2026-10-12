import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectScene, editScene } from '../src/core/scene.js';
function chunk(type, payload) { const header = Buffer.alloc(6); header.writeUInt16LE(type); header.writeUInt32LE(payload.length + 6, 2); return Buffer.concat([header, payload]); }
function script(name, code) { const head = Buffer.alloc(5), length = Buffer.alloc(4); head[0] = 0x73; head.writeUInt32LE(name.length, 1); length.writeUInt32LE(code.length); return Buffer.concat([head, Buffer.from(name), length, Buffer.from(code), Buffer.from([0xde, 0xad])]); }
function fixture() {
  const position = Buffer.alloc(15, 0xee); position.writeFloatLE(1, 0); position.writeFloatLE(2, 4); position.writeFloatLE(3, 8);
  return chunk(0x4c53, Buffer.concat([chunk(0x4000, chunk(0x4010, Buffer.concat([chunk(0x10, Buffer.from('frame\0suffix')), chunk(0x20, position), chunk(0xffff, Buffer.from('unknown-data'))]))), chunk(0xae50, chunk(0xae51, script('Mission', 'wait 1000\n')))]));
}
test('scene property edits preserve opaque chunks and recalculate all ancestors', () => {
  const original = fixture(), scene = inspectScene(original);
  for (const entry of scene.entries) assert.deepEqual(editScene(original, entry.id, entry.value), original);
  const name = scene.entries.find(e => e.kind === 'string');
  const modified = editScene(original, name.id, 'longer-frame-name');
  assert.equal(inspectScene(modified).entries.find(e => e.id === name.id).value, 'longer-frame-name');
  assert.ok(modified.includes(Buffer.from('suffix'))); assert.ok(modified.includes(Buffer.from('unknown-data')));
  assert.equal(modified.readUInt32LE(2), modified.length);
  const pos = scene.entries.find(e => e.kind === 'vec3');
  const moved = editScene(original, pos.id, [10, 20, 30]);
  assert.deepEqual(inspectScene(moved).entries.find(e => e.id === pos.id).value, [10, 20, 30]);
  assert.ok(moved.includes(Buffer.from([0xee, 0xee, 0xee])));
});
test('script edits retain unknown prefix and suffix and roundtrip source', () => {
  const original = fixture(), entry = inspectScene(original).entries.find(e => e.kind === 'script');
  const value = { name: 'NewMission', code: 'wait 2500\n// český komentář' };
  const modified = editScene(original, entry.id, value);
  assert.deepEqual(inspectScene(modified).entries.find(e => e.id === entry.id).value, value);
  assert.ok(modified.includes(Buffer.from([0xde, 0xad])));
  assert.ok(modified.includes(Buffer.from([0x73, value.name.length, 0, 0, 0])));
});
test('malformed chunks, missing properties and invalid values fail explicitly', () => {
  const original = fixture(), position = inspectScene(original).entries.find(e => e.kind === 'vec3');
  assert.throws(() => inspectScene(original.subarray(0, original.length - 1)), /překračuje/);
  assert.throws(() => editScene(original, 'no-such-id', 1), /neexistuje/);
  assert.throws(() => editScene(original, position.id, [NaN, 0, 0]), /hodnota/);
});
