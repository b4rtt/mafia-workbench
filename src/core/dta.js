import { DTA_MAP, WAV_DELTAS } from './dta-constants.js';

const MAX_FILE_SIZE = 256 * 1024 * 1024;
export function xorBlock(source, keys) {
  const out = Buffer.from(source);
  const key = Buffer.alloc(8);
  key.writeUInt32LE(keys.k2 >>> 0, 0);
  key.writeUInt32LE(keys.k1 >>> 0, 4);
  for (let i = 0; i < out.length; i++) out[i] ^= key[i % 8];
  return out;
}
function checkRange(buffer, start, size, label) {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(size) || start < 0 || size < 0 || start + size > buffer.length) {
    throw new Error(`DTA: ${label} je mimo archiv.`);
  }
}
export function relativeAssetPath(value) {
  if (typeof value !== 'string') throw new Error('Neplatná cesta souboru.');
  const name = value.replaceAll('\\', '/');
  const parts = name.split('/');
  if (!name || name.length > 1024 || /^[\/]/.test(name) || /[\x00-\x1f\x7f:]/.test(name) || parts.some(p => !p || p === '.' || p === '..' || /[. ]$/.test(p))) {
    throw new Error(`Nebezpečná nebo nejednoznačná cesta: ${JSON.stringify(value)}`);
  }
  return parts.join('/');
}
export function decompressLz(block, maxOutput = 32768) {
  if (block.length < 3 || block[0] !== 1) throw new Error('DTA: neplatný LZ blok.');
  const out = Buffer.alloc(maxOutput);
  let source = 3, target = 0, flags = block.readUInt16BE(1), bits = 16;
  const need = n => { if (source + n > block.length) throw new Error('DTA: useknutý LZ blok.'); };
  const room = n => { if (target + n > maxOutput) throw new Error('DTA: LZ blok překračuje očekávanou délku.'); };
  while (source < block.length) {
    if (!bits) { need(2); flags = block.readUInt16BE(source); source += 2; bits = 16; if (source === block.length) throw new Error('DTA: prázdná LZ skupina.'); }
    if (!(flags & 0x8000)) { room(1); out[target++] = block[source++]; }
    else {
      need(2);
      const distance = (block[source] << 4) | (block[source + 1] >> 4);
      if (!distance) {
        need(4);
        const count = (block[source + 1] << 8) + block[source + 2] + 16;
        room(count); out.fill(block[source + 3], target, target + count); target += count; source += 4;
      } else {
        const count = (block[source + 1] & 15) + 3;
        if (distance > target) throw new Error('DTA: LZ odkaz před začátek bloku.');
        room(count);
        for (let i = 0; i < count; i++) { out[target] = out[target - distance]; target++; }
        source += 2;
      }
    }
    flags = (flags << 1) & 0xffff; bits--;
  }
  return out.subarray(0, target);
}
function decodeSound(block, header, first) {
  if (![8, 12, 16, 20, 24, 28, 32].includes(block[0])) throw new Error(`DTA: nepodporovaný zvukový blok ${block[0]}.`);
  const channels = header.readUInt16LE(22), align = header.readUInt16LE(32);
  if (channels !== 1 && channels !== 2) throw new Error('DTA: nepodporovaný počet zvukových kanálů.');
  let cursor = first ? 45 : 1;
  const prefix = first ? header : Buffer.alloc(0);
  if (cursor === block.length) return prefix;
  if (align / channels !== 2) {
    const payload = block.subarray(cursor);
    const data = payload[0] === 0 ? payload.subarray(1) : decompressLz(payload, 32768 - prefix.length);
    return Buffer.concat([prefix, data]);
  }
  if (cursor + channels * 2 > block.length || (block.length - cursor - channels * 2) % channels) throw new Error('DTA: useknutý DPCM blok.');
  const result = Buffer.alloc(prefix.length + channels * 2 + (block.length - cursor - channels * 2) * 2);
  if (result.length > 32768) throw new Error('DTA: zvukový blok je příliš velký.');
  prefix.copy(result);
  let target = prefix.length;
  const samples = [];
  for (let c = 0; c < channels; c++) { samples[c] = block.readUInt16LE(cursor); cursor += 2; result.writeUInt16LE(samples[c], target); target += 2; }
  const base = (block[0] - 8) / 4 * 128;
  while (cursor < block.length) {
    for (let c = 0; c < channels; c++) {
      const code = block[cursor++];
      samples[c] = (samples[c] + ((code & 128) ? -1 : 1) * WAV_DELTAS[base + (code & 127)]) & 0xffff;
      result.writeUInt16LE(samples[c], target); target += 2;
    }
  }
  return result;
}

export class DtaArchive {
  constructor(bytes, filename, explicitKeys) {
    this.bytes = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.keys = explicitKeys ?? DTA_MAP.get(filename.toUpperCase());
    if (!this.keys) throw new Error(`DTA: neznámé klíče pro ${filename}.`);
    const buffer = this.bytes;
    if (buffer.length < 20 || buffer.toString('ascii', 0, 4) !== 'ISD0') throw new Error('DTA: chybí hlavička ISD0.');
    const header = xorBlock(buffer.subarray(4, 20), this.keys);
    const count = header.readUInt32LE(0), offset = header.readUInt32LE(4), tableSize = header.readUInt32LE(8);
    if (count > 100000 || tableSize < count * 28 || offset < 20) throw new Error('DTA: chybná tabulka nebo klíče.');
    checkRange(buffer, offset, tableSize, 'tabulka souborů');
    const table = xorBlock(buffer.subarray(offset, offset + tableSize), this.keys);
    this.entries = [];
    const seen = new Set();
    for (let i = 0; i < count; i++) {
      const headerOffset = table.readUInt32LE(i * 28 + 4), dataOffset = table.readUInt32LE(i * 28 + 8);
      checkRange(buffer, headerOffset, 32, 'hlavička souboru');
      const fileHeader = xorBlock(buffer.subarray(headerOffset, headerOffset + 32), this.keys);
      const size = fileHeader.readUInt32LE(16), blocks = fileHeader.readUInt32LE(20), nameFlags = fileHeader.readUInt16LE(24);
      const nameLength = nameFlags & 0x7fff;
      if (!nameLength || nameLength > 255 || size > MAX_FILE_SIZE || blocks > Math.ceil(size / 32768) + 1 || (size && !blocks)) throw new Error(`DTA: neplatné údaje souboru ${i}.`);
      checkRange(buffer, headerOffset + 32, nameLength, 'název souboru');
      const rawName = xorBlock(buffer.subarray(headerOffset + 32, headerOffset + 32 + nameLength), this.keys);
      const path = relativeAssetPath(rawName.toString('latin1').replace(/\0$/, ''));
      const canonical = path.normalize('NFC').toLowerCase();
      if (seen.has(canonical)) throw new Error(`DTA: duplicitní cesta ${path}.`);
      seen.add(canonical);
      checkRange(buffer, dataOffset, blocks ? 4 : 0, 'obsah souboru');
      this.entries.push({ path, size, blocks, dataOffset, encrypted: Boolean(nameFlags & 0x8000) });
    }
  }
  read(entry) {
    if (!this.entries.includes(entry)) throw new Error('DTA: soubor nepatří do archivu.');
    let cursor = entry.dataOffset, total = 0, soundHeader;
    const chunks = [];
    for (let index = 0; index < entry.blocks; index++) {
      checkRange(this.bytes, cursor, 4, 'velikost bloku');
      const length = this.bytes.readUInt32LE(cursor) & 0xffff;
      cursor += 4;
      if (!length) throw new Error(`DTA: prázdný blok v ${entry.path}.`);
      checkRange(this.bytes, cursor, length, 'blok souboru');
      let block = this.bytes.subarray(cursor, cursor + length);
      cursor += length;
      if (entry.encrypted) block = xorBlock(block, this.keys);
      let output;
      if (block[0] === 1) output = decompressLz(block);
      else if (block[0] >= 8) {
        if (!index) {
          if (block.length < 45) throw new Error('DTA: chybí WAV hlavička.');
          soundHeader = entry.encrypted ? Buffer.from(block.subarray(1, 45)) : xorBlock(block.subarray(1, 45), this.keys);
          if (soundHeader.toString('ascii', 0, 4) !== 'RIFF' || soundHeader.toString('ascii', 8, 12) !== 'WAVE' || soundHeader.toString('ascii', 36, 40) !== 'data') throw new Error('DTA: neplatná WAV hlavička.');
        }
        if (!soundHeader) throw new Error('DTA: zvukový blok bez hlavičky.');
        output = decodeSound(block, soundHeader, index === 0);
      } else output = block.subarray(1);
      if (output.length > 32768 || total + output.length > entry.size) throw new Error(`DTA: obsah ${entry.path} má větší než deklarovanou délku.`);
      chunks.push(output); total += output.length;
    }
    if (total !== entry.size) throw new Error(`DTA: ${entry.path}: očekáváno ${entry.size}, rozbaleno ${total} bajtů.`);
    return Buffer.concat(chunks, total);
  }
}
