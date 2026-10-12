import iconv from 'iconv-lite';
// Cache city version 1: sized chunks, length-prefixed strings, part bounds and
// model transforms. Unknown chunks and trailing bytes remain opaque on writes.
function parse(source) {
  const bytes = Buffer.from(source), entries = [], parts = []; let chunks = 0;
  function chunk(start, limit, id) {
    if (++chunks > 100000 || start + 6 > limit) throw new Error('Cache: useknutá hlavička chunku.');
    const type = bytes.readUInt16LE(start), size = bytes.readUInt32LE(start + 2);
    if (size < 6 || start + size > limit) throw new Error('Cache: chunk překračuje soubor.');
    return { type, id, start, end: start + size, payload: start + 6, fields: [], children: [] };
  }
  function field(node, cursor, name, label, kind, context, count = 1) {
    const start = cursor; let value;
    if (kind === 'string') {
      if (cursor + 4 > node.end) throw new Error('Cache: useknutá délka řetězce.');
      const size = bytes.readUInt32LE(cursor); cursor += 4;
      if (size > node.end - cursor) throw new Error('Cache: řetězec překračuje chunk.');
      value = iconv.decode(bytes.subarray(cursor, cursor + size), 'windows-1250'); cursor += size;
    } else {
      if (cursor + count * 4 > node.end) throw new Error('Cache: useknutá číselná vlastnost.');
      value = Array.from({ length: count }, (_, i) => bytes.readFloatLE(cursor + i * 4));
      if (value.some(n => !Number.isFinite(n))) throw new Error('Cache: neplatná číselná vlastnost.');
      if (count === 1) value = value[0]; cursor += count * 4;
    }
    const entry = { id: `${node.id}/${name}`, label, kind, context, value, start, end: cursor, count };
    entries.push(entry); node.fields.push(entry); return { value, cursor, id: entry.id };
  }
  const root = chunk(0, bytes.length, 'city');
  if (root.type !== 500 || root.end !== bytes.length || root.end < 10 || bytes.readUInt32LE(6) !== 1) throw new Error('Cache: nepodporovaná hlavička nebo verze.');
  root.prefixEnd = 10;
  for (let cursor = 10, index = 0; cursor < root.end; index++) {
    const node = chunk(cursor, root.end, `parts/${index}`); root.children.push(node); cursor = node.end;
    if (node.type !== 1000) continue;
    const named = field(node, node.payload, 'name', 'Název části', 'string', 'Část města');
    const part = { id: node.id, name: named.value, objects: [], fields: { name: named.id } }; let offset = named.cursor;
    for (const [name, label, count] of [['spherePosition','Střed oblasti XZ',2],['sphereRadius','Poloměr oblasti',1],['leftBottom','Levý dolní roh XZ',2],['leftSide','Levá strana XZ',2],['rightBottom','Pravý dolní roh XZ',2],['rightSide','Pravá strana XZ',2],['leftTop','Levý horní roh XZ',2],['bottomSide','Dolní strana XZ',2],['rightTop','Pravý horní roh XZ',2],['topSide','Horní strana XZ',2]]) {
      const result = field(node, offset, name, label, count === 1 ? 'float' : 'vec2', part.name, count); offset = result.cursor; part[name] = result.value; part.fields[name] = result.id;
    }
    node.prefixEnd = offset;
    for (let frameIndex = 0; offset < node.end; frameIndex++) {
      const frame = chunk(offset, node.end, `${node.id}/frames/${frameIndex}`); node.children.push(frame); offset = frame.end;
      if (frame.type !== 2000) continue;
      const model = field(frame, frame.payload, 'model', 'Model', 'string', part.name); let at = model.cursor;
      const object = { id: frame.id, name: `${part.name} / ${frameIndex + 1} · ${model.value}`, model: model.value, parent: 'Primary sector', fields: { model: model.id } };
      for (const [name, label, count] of [['position','Pozice XYZ',3],['rotation','Rotace WXYZ',4],['scale','Měřítko XYZ',3]]) {
        const result = field(frame, at, name, label, count === 4 ? 'quat' : 'vec3', object.name, count); at = result.cursor; object[name] = result.value; object.fields[name] = result.id;
      }
      if (at + 4 > frame.end) throw new Error('Cache: useknuté příznaky modelu.'); at += 4; // Preserve undocumented flags.
      const secondary = field(frame, at, 'secondaryScale', 'Druhá uložená hodnota měřítka XYZ', 'vec3', object.name, 3); object.secondaryScale = secondary.value;
      part.objects.push(object);
    }
    parts.push(part);
  }
  return { bytes, root, version: 1, parts, entries };
}
export function inspectCache(source) {
  const { version, parts, entries } = parse(source);
  return { version, parts, entries: entries.map(({ start, end, count, ...entry }) => entry) };
}
export function editCache(source, changes) {
  if (!Array.isArray(changes) || changes.length > 1024) throw new Error('Cache: neplatné úpravy.');
  const parsed = parse(source), replacements = new Map(), known = new Map(parsed.entries.map(e => [e.id, e]));
  for (const { id, value } of changes) {
    const entry = known.get(id);
    if (!entry || replacements.has(id)) throw new Error('Cache: neplatná vlastnost.');
    let replacement;
    if (entry.kind === 'string') {
      if (typeof value !== 'string' || value.includes('\0') || value.length > 4096) throw new Error('Cache: neplatný řetězec.');
      const text = iconv.encode(value, 'windows-1250'); if (iconv.decode(text, 'windows-1250') !== value) throw new Error('Cache: text nelze zapsat v kódování Windows-1250.');
      replacement = Buffer.alloc(4 + text.length); replacement.writeUInt32LE(text.length); text.copy(replacement, 4);
    } else {
      const numbers = entry.count === 1 ? [value] : value;
      if (!Array.isArray(numbers) || numbers.length !== entry.count || numbers.some(n => typeof n !== 'number' || !Number.isFinite(n) || !Number.isFinite(Math.fround(n)))) throw new Error('Cache: neplatná číselná hodnota.');
      replacement = Buffer.alloc(entry.count * 4); numbers.forEach((n,i) => replacement.writeFloatLE(n,i*4));
    }
    replacements.set(id, JSON.stringify(value) === JSON.stringify(entry.value) ? null : replacement);
  }
  function rebuild(node) {
    const edits = node.fields.filter(e => replacements.get(e.id)).map(e => ({ start: e.start, end: e.end, data: replacements.get(e.id) }));
    for (const child of node.children) edits.push({ start: child.start, end: child.end, data: rebuild(child) });
    const blocks = []; let at = node.payload;
    for (const edit of edits.sort((a,b) => a.start - b.start)) { blocks.push(parsed.bytes.subarray(at, edit.start), edit.data); at = edit.end; }
    blocks.push(parsed.bytes.subarray(at, node.end)); const payload = Buffer.concat(blocks), header = Buffer.alloc(6);
    header.writeUInt16LE(node.type); header.writeUInt32LE(payload.length + 6, 2); return Buffer.concat([header, payload]);
  }
  const result = rebuild(parsed.root); parse(result); return result;
}
