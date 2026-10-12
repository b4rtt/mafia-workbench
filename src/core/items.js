import iconv from 'iconv-lite';

const RECORD_SIZE = 188;
// PC item records, verified against ItemsDatabase::Item and shipped predmety.def.
// Do not infer flags or timing semantics from the older TS string-only parser.
const fields = [
  ['name', 'Interní název', 0, 'string', 32],
  ['flags', 'Příznaky', 32, 'uint32'],
  ['model', 'Model (.i3d)', 36, 'string', 32],
  ['reloadAnimation', 'ID animace nabíjení', 76, 'int32'],
  ['shootSound', 'ID zvuku výstřelu', 84, 'int32'],
  ['reloadSound', 'ID zvuku nabíjení', 88, 'int32'],
  ['itemType', 'Třída předmětu', 92, 'int32'],
  ['magazine', 'Kapacita zásobníku', 96, 'int32'],
  ['reserve', 'Kapacita zásoby munice', 100, 'int32'],
  ['range', 'Dostřel', 116, 'float'],
  ['damage', 'Poškození', 120, 'float'],
  ['recoil', 'Zpětný ráz', 132, 'float'],
  ['accuracy', 'Přesnost', 136, 'float'],
];

export function parseItems(source) {
  const bytes = Buffer.from(source);
  if (!bytes.length || bytes.length % RECORD_SIZE || bytes.length / RECORD_SIZE > 65536) throw new Error('Předměty: očekávám PC záznamy o 188 bajtech bez hlavičky.');
  const records = [];
  for (let index = 0; index < bytes.length / RECORD_SIZE; index++) {
    const values = {}, entries = [];
    for (const [key, label, relative, kind, length = 4] of fields) {
      const offset = index * RECORD_SIZE + relative;
      let value;
      if (kind === 'string') {
        const raw = bytes.subarray(offset, offset + length), zero = raw.indexOf(0);
        if (zero < 0) throw new Error(`Předměty: chybí ukončení ${label} v ID ${index}.`);
        value = iconv.decode(raw.subarray(0, zero), 'windows-1250');
      } else value = kind === 'float' ? bytes.readFloatLE(offset) : kind === 'uint32' ? bytes.readUInt32LE(offset) : bytes.readInt32LE(offset);
      if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(`Předměty: neplatné ${label} v ID ${index}.`);
      values[key] = value;
      entries.push({ id: `${index}/${key}`, key, label, kind, value, offset, length });
    }
    records.push({ index, ...values, entries });
  }
  return { recordSize: RECORD_SIZE, records };
}

export function editItems(source, changes) {
  const parsed = parseItems(source), result = Buffer.from(source);
  if (!Array.isArray(changes) || changes.length > 1024) throw new Error('Předměty: neplatné úpravy.');
  const entries = new Map(parsed.records.flatMap(record => record.entries.map(entry => [entry.id, entry]))), seen = new Set();
  for (const change of changes) {
    const entry = entries.get(change?.id), value = change?.value;
    if (!entry || seen.has(entry.id)) throw new Error('Předměty: neplatná nebo opakovaná vlastnost.');
    seen.add(entry.id);
    if (value === entry.value) continue;
    if (entry.kind === 'string') {
      if (typeof value !== 'string' || /[\x00-\x1f]/.test(value)) throw new Error('Předměty: neplatný text.');
      const encoded = iconv.encode(value, 'windows-1250');
      if (encoded.length >= entry.length || iconv.decode(encoded, 'windows-1250') !== value) throw new Error(`Předměty: text musí mít nejvýše ${entry.length - 1} bajtů ve Windows-1250.`);
      // Preserve all padding beyond the new terminator; engines stop at NUL.
      encoded.copy(result, entry.offset); result[entry.offset + encoded.length] = 0;
    } else {
      if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Předměty: očekávám konečné číslo.');
      if (entry.kind === 'float') {
        if (!Number.isFinite(Math.fround(value))) throw new Error('Předměty: hodnota je mimo rozsah float32.');
        result.writeFloatLE(value, entry.offset);
      } else {
        const min = entry.kind === 'uint32' ? 0 : -2147483648, max = entry.kind === 'uint32' ? 4294967295 : 2147483647;
        if (!Number.isInteger(value) || value < min || value > max || (['magazine', 'reserve'].includes(entry.key) && value < 0)) throw new Error('Předměty: celé číslo je mimo rozsah.');
        if (entry.kind === 'uint32') result.writeUInt32LE(value, entry.offset); else result.writeInt32LE(value, entry.offset);
      }
    }
  }
  parseItems(result);
  return result;
}
