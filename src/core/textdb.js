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

// The PC engine searches the on-disk sorted index directly. Keep its final
// boundary record last, and copy the entire old string heap (including gaps,
// aliases and unused bytes) while shifting every original offset by one record.
export function addTextDbEntry(source, filename, {id, text} = {}) {
  const bytes = Buffer.from(source), parsed = parseTextDb(bytes, filename), entries = parsed.entries;
  if (!Number.isSafeInteger(id) || id < 0 || id > 0xffffffff || typeof text !== 'string' || text.includes('\0') || text.length > 1000000) throw new Error('TextDB: neplatné ID nebo text nového záznamu.');
  if (!entries.length || entries.some((entry,index) => index && entry.id <= entries[index-1].id)) throw new Error('TextDB: vložení vyžaduje jednoznačný seřazený původní index.');
  if (entries.some(entry => entry.id === id)) throw new Error('TextDB: toto ID už existuje.');
  if (id >= entries.at(-1).id || entries.length >= 8191) throw new Error('TextDB: ID musí být pod posledním hraničním záznamem; vložení je omezené na 8 191 záznamů kvůli PC vyhledávání.');
  const encoded = iconv.encode(text, parsed.encoding);
  if (iconv.decode(encoded, parsed.encoding) !== text) throw new Error(`TextDB: text nelze zapsat v kódování ${parsed.encoding}.`);
  if (bytes.length + 9 + encoded.length > 256 * 1024 * 1024) throw new Error('TextDB: výsledný soubor je příliš velký.');
  const tableEnd = 8 + entries.length * 8, result = Buffer.alloc(bytes.length + 9 + encoded.length);
  bytes.copy(result,0,0,8);result.writeUInt32LE(entries.length+1,0);
  let at=8, inserted=false;
  const writeNew=()=>{result.writeUInt32LE(id,at);result.writeUInt32LE(bytes.length+8,at+4);at+=8;inserted=true;};
  for (const entry of entries) {
    if (!inserted && id < entry.id) writeNew();
    result.writeUInt32LE(entry.id,at);result.writeUInt32LE(bytes.readUInt32LE(12+entry.index*8)+8,at+4);at+=8;
  }
  bytes.copy(result,tableEnd+8,tableEnd);encoded.copy(result,bytes.length+8);
  parseTextDb(result,filename);return result;
}
