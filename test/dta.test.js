import test from 'node:test';
import assert from 'node:assert/strict';
import { DtaArchive, decompressLz, relativeAssetPath, xorBlock } from '../src/core/dta.js';
const keys = { k1: 0x01020304, k2: 0x11223344 };
function archive(name = 'tables/test.def', data = Buffer.from('hello')) {
  const filename = Buffer.from(name), contentOffset = 20 + 32 + filename.length;
  const tableOffset = contentOffset + 5 + data.length;
  const result = Buffer.alloc(tableOffset + 28);
  result.write('ISD0');
  const header = Buffer.alloc(16); header.writeUInt32LE(1); header.writeUInt32LE(tableOffset, 4); header.writeUInt32LE(28, 8);
  xorBlock(header, keys).copy(result, 4);
  const fh = Buffer.alloc(32); fh.writeUInt32LE(data.length, 16); fh.writeUInt32LE(1, 20); fh.writeUInt16LE(filename.length | 0x8000, 24);
  xorBlock(fh, keys).copy(result, 20); xorBlock(filename, keys).copy(result, 52);
  result.writeUInt32LE(1 + data.length, contentOffset); xorBlock(Buffer.concat([Buffer.from([0]), data]), keys).copy(result, contentOffset + 4);
  const table = Buffer.alloc(28); table.writeUInt32LE(20, 4); table.writeUInt32LE(contentOffset, 8); xorBlock(table, keys).copy(result, tableOffset);
  return result;
}
test('encrypted DTA metadata and payload decode exactly', () => {
  const dta = new DtaArchive(archive(), 'fixture.dta', keys);
  assert.equal(dta.entries[0].path, 'tables/test.def');
  assert.equal(dta.read(dta.entries[0]).toString(), 'hello');
});
test('LZ flags use big endian, overlapping backreferences and RLE', () => {
  assert.equal(decompressLz(Buffer.from([1, 0x10, 0, 65, 66, 67, 0, 0x30])).toString(), 'ABCABC');
  assert.equal(decompressLz(Buffer.from([1, 0x80, 0, 0, 0, 0, 65])).toString(), 'A'.repeat(16));
  assert.throws(() => decompressLz(Buffer.from([1, 0x80, 0, 0, 0x30])), /odkaz/);
  assert.throws(() => decompressLz(Buffer.from([1, 0x80, 0, 0])), /useknutý/);
  assert.throws(() => decompressLz(Buffer.from([1, 0x80, 0, 0, 0, 0, 65]), 8), /délku/);
});
test('malformed and unsafe archives fail before extraction', () => {
  assert.throws(() => new DtaArchive(archive('../outside'), 'fixture.dta', keys), /cesta/);
  assert.throws(() => new DtaArchive(archive().subarray(0, 40), 'fixture.dta', keys), /mimo/);
  const dta = new DtaArchive(archive(), 'fixture.dta', keys);
  dta.bytes.writeUInt32LE(0xffff, dta.entries[0].dataOffset);
  assert.throws(() => dta.read(dta.entries[0]), /mimo/);
  for (const path of ['/x', 'C:\\x', 'a/../x', 'a//b', 'a/./b', 'x\0', 'a/b.']) assert.throws(() => relativeAssetPath(path));
  assert.equal(relativeAssetPath('models\\auto.4ds'), 'models/auto.4ds');
});
