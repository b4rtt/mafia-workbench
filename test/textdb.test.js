import test from 'node:test';
import assert from 'node:assert/strict';
import iconv from 'iconv-lite';
import { parseTextDb, editTextDb, addTextDbEntry } from '../src/core/textdb.js';
function fixture() {
  const bytes = Buffer.alloc(80, 0xe1);
  bytes.writeUInt32LE(3, 0); bytes.writeUInt32LE(0xdeadbeef, 4);
  for (let i = 0; i < 3; i++) { bytes.writeUInt32LE(100 + i, 8 + 8 * i); bytes.writeUInt32LE(i === 2 ? 55 : 40, 12 + 8 * i); }
  iconv.encode('Příliš', 'windows-1250').copy(bytes, 40); bytes[46] = 0;
  bytes.write('Other', 55); bytes[60] = 0;
  return bytes;
}
test('Czech text roundtrip preserves header, unknown bytes and shared strings', () => {
  const original = fixture();
  const parsed = parseTextDb(original, 'textdb_cz.def');
  assert.equal(parsed.entries[0].text, 'Příliš');
  assert.deepEqual(editTextDb(original, 'textdb_cz.def', parsed.entries), original);
  const modified = editTextDb(original, 'textdb_cz.def', [{ index: 0, text: 'Žluťoučký kůň' }]);
  const roundtrip = parseTextDb(modified, 'textdb_cz.def');
  assert.equal(roundtrip.entries[0].text, 'Žluťoučký kůň');
  assert.equal(roundtrip.entries[1].text, 'Příliš');
  assert.equal(roundtrip.unknown, 0xdeadbeef);
  for (let i = 0; i < original.length; i++) if (i < 12 || i >= 16) assert.equal(modified[i], original[i], `unknown byte ${i}`);
  assert.deepEqual(original, fixture());
});
test('TextDB rejects bad offsets, unterminated strings and unrepresentable text', () => {
  const bad = fixture(); bad.writeUInt32LE(7, 12);
  assert.throws(() => parseTextDb(bad, 'textdb_cz.def'), /offset/);
  const unterminated = fixture(); unterminated.fill(1, 40);
  assert.throws(() => parseTextDb(unterminated, 'textdb_cz.def'), /ukončení/);
  assert.throws(() => editTextDb(fixture(), 'textdb_cz.def', [{ index: 0, text: '🙂' }]), /kódování/);
  assert.throws(() => editTextDb(fixture(), 'textdb_cz.def', [{ index: 4, text: 'x' }]), /záznam/);
  assert.throws(() => editTextDb(fixture(), 'textdb_cz.def', [{ index: 0, text: 'x\0y' }]), /záznam/);
});
test('new TextDB IDs preserve sorted lookup, shared strings, header and the entire original heap', () => {
  const before=fixture(),added=addTextDbEntry(before,'textdb_cz.def',{id:99,text:'Vlastní úkol: přivez auto.'}),parsed=parseTextDb(added,'textdb_cz.def');
  assert.deepEqual(parsed.entries.map(e=>e.id),[99,100,101,102]);assert.equal(parsed.entries[0].text,'Vlastní úkol: přivez auto.');assert.equal(parsed.unknown,0xdeadbeef);
  assert.deepEqual(added.subarray(40,88),before.subarray(32));assert.equal(added.readUInt32LE(20),48);assert.equal(added.readUInt32LE(28),48);assert.equal(added.readUInt32LE(36),63);
  for(let index=0;index<3;index++)assert.equal(parsed.entries[index+1].text,parseTextDb(before,'textdb_cz.def').entries[index].text);
  assert.deepEqual(before,fixture());const zero=addTextDbEntry(before,'textdb_en.def',{id:0,text:''});assert.equal(parseTextDb(zero,'textdb_en.def').entries[0].text,'');
});
test('TextDB insertion rejects collisions, unsafe engine boundaries and invalid encodings without normalizing the source',()=>{
  const before=fixture();for(const entry of [{id:100,text:'x'},{id:102,text:'x'},{id:0xffffffff,text:'x'},{id:-1,text:'x'},{id:1.5,text:'x'},{id:NaN,text:'x'},{id:99,text:'🙂'},{id:99,text:'x\0y'}])assert.throws(()=>addTextDbEntry(before,'textdb_cz.def',entry));
  const unsorted=fixture();unsorted.writeUInt32LE(80,16);assert.throws(()=>addTextDbEntry(unsorted,'textdb_cz.def',{id:99,text:'x'}),/seřazený/);
  const many=Buffer.alloc(8+8191*8+1);many.writeUInt32LE(8191,0);for(let i=0;i<8191;i++){many.writeUInt32LE(i*2,8+i*8);many.writeUInt32LE(many.length-1,12+i*8);}assert.throws(()=>addTextDbEntry(many,'textdb_en.def',{id:1,text:'x'}),/8 191/);
  assert.deepEqual(before,fixture());
});
