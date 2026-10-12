import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFourDs, editFourDs } from '../src/core/fourds.js';
function u16(n) { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; }
function floats(values) { const b = Buffer.alloc(values.length * 4); values.forEach((v, i) => b.writeFloatLE(v, i * 4)); return b; }
function text(value) { return Buffer.concat([Buffer.from([value.length]), Buffer.from(value)]); }
function fixture() {
  const header = Buffer.alloc(14); header.write('4DS\0'); header.writeUInt16LE(29, 4); header.fill(0xbb, 6);
  const flags = Buffer.alloc(4); flags.writeUInt32LE(0x46808001); // Empty diffuse texture must not consume an alpha name.
  const material = Buffer.concat([flags, floats([.1, .2, .3, .4, .5, .6, 0, 0, 0, 1]), text(''), Buffer.alloc(18, 0xee)]);
  const mesh = Buffer.concat([Buffer.from([1, 0, 0x42, 0x43]), u16(0), floats([0, 0, 0, 1, 1, 1, 1, 0, 0, 0]), Buffer.from([7]), text('mesh'), text('opaque properties'), u16(0), Buffer.from([1]), floats([0]), u16(3), floats([0,0,0,0,1,0,0,0, 1,0,0,0,1,0,1,0, 0,1,0,0,1,0,0,1]), Buffer.from([1]), u16(1), u16(0), u16(1), u16(2), u16(1)]);
  return Buffer.concat([header, u16(1), material, u16(1), mesh, Buffer.from([0x63])]);
}
test('4DS geometry and variable names roundtrip without altering mesh payload or unknown bytes', () => {
  const source = fixture(), parsed = parseFourDs(source, true);
  assert.equal(parsed.meshes[0].lods[0].positions.length, 9); assert.deepEqual(parsed.meshes[0].lods[0].faces[0].indices, [0,1,2]);
  assert.deepEqual(editFourDs(source, parsed.entries.map(({id,value}) => ({id,value}))), source);
  const result = editFourDs(source, [{ id: 'meshes/0/name', value: 'longer mesh' }, { id: 'meshes/0/position', value: [10,20,30] }]);
  const checked = parseFourDs(result, true); assert.equal(checked.meshes[0].name, 'longer mesh'); assert.deepEqual(checked.meshes[0].position, [10,20,30]);
  assert.deepEqual(checked.meshes[0].lods, parsed.meshes[0].lods); assert.ok(result.includes(Buffer.alloc(18, 0xee))); assert.equal(result.at(-1), 0x63);
});
test('4DS refuses malformed geometry, incompatible versions, cycles and invalid values', () => {
  const source = fixture(); assert.throws(() => parseFourDs(source.subarray(0, -1)), /konec|mimo/);
  assert.throws(() => editFourDs(source, [{ id:'meshes/0/parent', value:1 }]), /hierarchie/);
  const cycle = Buffer.from(source), parent = parseFourDs(source).entries.find(e => e.id === 'meshes/0/parent');
  cycle.writeUInt16LE(1, parent.offset); assert.throws(() => parseFourDs(cycle, true), /hierarchie/);
  assert.throws(() => editFourDs(source, [{ id:'meshes/0/position', value:[Infinity,0,0] }]), /hodnota/);
  const old = Buffer.from(source); old.writeUInt16LE(27,4); assert.throws(() => parseFourDs(old), /verze 27/);
});
