import iconv from 'iconv-lite';
const HEADER = 18;
export function parseFiveDs(source, layout = false) {
  const bytes = Buffer.from(source), entries = [], nodes = [];
  function bounds(offset, size) { if (!Number.isSafeInteger(offset) || offset < 0 || size < 0 || offset + size > bytes.length) throw new Error('5DS: data překračují soubor.'); }
  bounds(0, 22);
  if (bytes.toString('ascii', 0, 4) !== '5DS\0' || bytes.readUInt16LE(4) !== 20) throw new Error('5DS: nepodporovaná hlavička nebo verze.');
  if (bytes.readUInt32LE(14) !== bytes.length - HEADER) throw new Error('5DS: neplatná deklarovaná délka.');
  const count = bytes.readUInt16LE(18), frames = bytes.readUInt16LE(20), tableEnd = 22 + count * 8;
  bounds(22, count * 8);
  for (let i = 0; i < count; i++) {
    const nameOffset = bytes.readUInt32LE(22 + i * 8) + HEADER, dataOffset = bytes.readUInt32LE(26 + i * 8) + HEADER;
    if (nameOffset < tableEnd || dataOffset < tableEnd) throw new Error('5DS: offset zasahuje hlavičku.');
    bounds(nameOffset, 1); bounds(dataOffset, 4);
    const end = bytes.indexOf(0, nameOffset); if (end < 0) throw new Error('5DS: chybí konec názvu.');
    const name = iconv.decode(bytes.subarray(nameOffset, end), 'windows-1250'), flags = bytes.readUInt32LE(dataOffset);
    const node = { id: i, name, flags, tracks: {}, unknownFlags: (flags & ~0x1e) >>> 0 }; let cursor = dataOffset + 4;
    entries.push({ id: `nodes/${i}/name`, label: 'Název uzlu', kind: 'string', value: name, context: name, offset: nameOffset, length: end - nameOffset + 1, pointer: 22 + i * 8 });
    for (const [channel, bit, components] of [['rotation', 4, 4], ['position', 2, 3], ['scale', 8, 3], ['note', 16, 1]]) {
      if (!(flags & bit)) continue;
      const start=cursor;bounds(cursor, 2); const length = bytes.readUInt16LE(cursor); cursor += 2; bounds(cursor, length * 2);const timeOffset=cursor;
      const times = Array.from({ length }, (_, k) => bytes.readUInt16LE(cursor + k * 2)); cursor += length * 2;
      // The header stores the final frame number, not the number of samples (0..frames inclusive).
      if (times.some((time, k) => time > frames || (k && time < times[k - 1]))) throw new Error('5DS: neplatné pořadí snímků.');
      if (channel !== 'note' && length % 2 === 0) { bounds(cursor, 2); cursor += 2; }
      const stride = channel === 'note' ? 2 : components * 4; bounds(cursor, length * stride);const valueOffset=cursor;
      const values = [];
      for (let k = 0; k < length; k++) {
        const offset = cursor + k * stride, value = channel === 'note' ? bytes.readUInt16LE(offset) : Array.from({ length: components }, (_, c) => bytes.readFloatLE(offset + c * 4));
        if (Array.isArray(value) && value.some(v => !Number.isFinite(v))) throw new Error('5DS: neplatné číslo v klíči.');
        values.push(value); entries.push({ id: `nodes/${i}/${channel}/${k}`, label: `${channel} · snímek ${times[k]}`, kind: channel === 'note' ? 'uint' : 'vector', value, context: name, offset, length: stride });
      }
      cursor += length * stride;
      if (channel === 'note') { bounds(cursor, 2); cursor += 2; }
      node.tracks[channel] = { times, values, ...(layout?{layout:{start,end:cursor,timeOffset,valueOffset,stride}}:{}) };
    }
    if(layout)node.layout={start:dataOffset,end:cursor,pointer:26+i*8};nodes.push(node);
  }
  return { version: 20, frames, nodes, entries };
}
export function editFiveDs(source, changes) {
  const parsed = parseFiveDs(source); let result = Buffer.from(source); const seen = new Set();
  if (!Array.isArray(changes) || changes.length > 1024) throw new Error('5DS: neplatné úpravy.');
  for (const { id, value } of changes) {
    const entry = parsed.entries.find(e => e.id === id);
    if (!entry || seen.has(id)) throw new Error('5DS: neplatná vlastnost.'); seen.add(id);
    if (JSON.stringify(value) === JSON.stringify(entry.value)) continue;
    if (entry.kind === 'string') {
      if (typeof value !== 'string' || value.includes('\0') || value.length > 1024) throw new Error('5DS: neplatný název.');
      const encoded = iconv.encode(value, 'windows-1250'); if (iconv.decode(encoded, 'windows-1250') !== value) throw new Error('5DS: název nelze kódovat.');
      const offset = result.length; result = Buffer.concat([result, encoded, Buffer.from([0])]); result.writeUInt32LE(offset - HEADER, entry.pointer); result.writeUInt32LE(result.length - HEADER, 14);
    } else if (entry.kind === 'uint') {
      if (!Number.isInteger(value) || value < 0 || value > 65535) throw new Error('5DS: neplatná hodnota poznámky.'); result.writeUInt16LE(value, entry.offset);
    } else {
      if (!Array.isArray(value) || value.length !== entry.value.length || value.some(v => typeof v !== 'number' || !Number.isFinite(v) || !Number.isFinite(Math.fround(v)))) throw new Error('5DS: neplatný klíč.');
      value.forEach((v, i) => result.writeFloatLE(v, entry.offset + i * 4));
    }
  }
  parseFiveDs(result); return result;
}
