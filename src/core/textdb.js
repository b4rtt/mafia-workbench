import iconv from 'iconv-lite';

export function textEncoding(filename) {
  const language = /textdb_([a-z]{2})\.def$/i.exec(filename)?.[1]?.toLowerCase();
  if (language === 'cz' || language === 'pl') return 'windows-1250';
  if (language === 'ru') return 'windows-1251';
  return 'windows-1252';
}
export function parseTextDb(source, filename) {
  const bytes = Buffer.from(source);
  if (bytes.length < 8) throw new Error('TextDB: chybí hlavička.');
  const count = bytes.readUInt32LE(0), tableEnd = 8 + count * 8;
  if (count > 1000000 || tableEnd > bytes.length) throw new Error('TextDB: index je mimo soubor.');
  const encoding = textEncoding(filename), entries = [];
  for (let index = 0; index < count; index++) {
    const id = bytes.readUInt32LE(8 + index * 8), offset = bytes.readUInt32LE(12 + index * 8);
    if (offset < tableEnd || offset >= bytes.length) throw new Error(`TextDB: neplatný offset záznamu ${index}.`);
    const end = bytes.indexOf(0, offset);
    if (end < 0) throw new Error(`TextDB: chybí ukončení záznamu ${index}.`);
    entries.push({ index, id, text: iconv.decode(bytes.subarray(offset, end), encoding) });
  }
  return { entries, unknown: bytes.readUInt32LE(4), encoding };
}
export function editTextDb(source, filename, changes) {
  const bytes = Buffer.from(source), parsed = parseTextDb(bytes, filename);
  if (!Array.isArray(changes) || changes.length > parsed.entries.length) throw new Error('TextDB: neplatný seznam úprav.');
  let result = bytes;
  const seen = new Set();
  for (const { index, text } of changes) {
    if (!Number.isSafeInteger(index) || !parsed.entries[index] || seen.has(index) || typeof text !== 'string' || text.includes('\0') || text.length > 1000000) throw new Error('TextDB: neplatný záznam.');
    seen.add(index);
    if (text === parsed.entries[index].text) continue;
    const encoded = iconv.encode(text, parsed.encoding);
    if (iconv.decode(encoded, parsed.encoding) !== text) throw new Error(`TextDB: text nelze zapsat v kódování ${parsed.encoding}.`);
    const offset = result.length;
    if (offset + encoded.length + 1 > 256 * 1024 * 1024) throw new Error('TextDB: výsledný soubor je příliš velký.');
    result = Buffer.concat([result, encoded, Buffer.from([0])]);
    result.writeUInt32LE(offset, 12 + index * 8);
  }
  // Existing header, table order, unused bytes and shared strings stay intact.
  // Only modified offset words change; new strings are appended.
  parseTextDb(result, filename);
  return result;
}
