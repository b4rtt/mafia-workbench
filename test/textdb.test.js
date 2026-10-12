import test from 'node:test';
import assert from 'node:assert/strict';
import iconv from 'iconv-lite';
import { parseTextDb, editTextDb } from '../src/core/textdb.js';
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
