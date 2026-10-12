import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFiveDs, editFiveDs } from '../src/core/fiveds.js';
function u16(value) { const b = Buffer.alloc(2); b.writeUInt16LE(value); return b; }
function floats(values) { const b = Buffer.alloc(values.length * 4); values.forEach((v, i) => b.writeFloatLE(v, i * 4)); return b; }
function fixture() {
  const header = Buffer.alloc(30); header.write('5DS\0'); header.writeUInt16LE(20, 4); header.fill(0xab, 6, 14); header.writeUInt16LE(1, 18); header.writeUInt16LE(3, 20); header.writeUInt32LE(12, 26);
  const flags = Buffer.alloc(4); flags.writeUInt32LE(22);
  const data = Buffer.concat([flags, u16(2), u16(0), u16(3), u16(0xee), floats([1,0,0,0, 0,0,1,0]), u16(1), u16(3), floats([1,2,3]), u16(1), u16(1), u16(400), u16(0xdd)]);
  header.writeUInt32LE(header.length + data.length - 18, 22);
  const result = Buffer.concat([header, data, Buffer.from('root\0opaque-tail')]); result.writeUInt32LE(result.length - 18, 14); return result;
}
test('5DS includes its last frame, edits keys and appends names while preserving opaque data', () => {
  const source = fixture(), parsed = parseFiveDs(source);
  assert.deepEqual(parsed.nodes[0].tracks.rotation.times, [0,3]); assert.equal(parsed.nodes[0].tracks.note.values[0], 400);
  assert.deepEqual(editFiveDs(source, parsed.entries.map(({id,value}) => ({id,value}))), source);
  const result = editFiveDs(source, [{id:'nodes/0/name',value:'nový uzel'}, {id:'nodes/0/position/0',value:[4,5,6]}]);
  const check = parseFiveDs(result); assert.equal(check.nodes[0].name, 'nový uzel'); assert.deepEqual(check.nodes[0].tracks.position.values[0], [4,5,6]);
  assert.ok(result.includes(Buffer.from('root\0opaque-tail'))); assert.deepEqual(result.subarray(6,14), source.subarray(6,14));
  assert.equal(result.readUInt32LE(14), result.length - 18);
});
test('5DS rejects invalid lengths, offsets and nonfinite key edits', () => {
  const source = fixture(); assert.throws(() => parseFiveDs(source.subarray(0,-1)), /délka/);
  const bad = Buffer.from(source); bad.writeUInt32LE(0,26); assert.throws(() => parseFiveDs(bad), /hlavičku/);
  assert.throws(() => editFiveDs(source, [{id:'nodes/0/position/0',value:[NaN,0,0]}]), /klíč/);
});
