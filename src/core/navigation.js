const MAGIC = 0x01abcedf, POINT_SIZE = 30, LINK_SIZE = 8;

export function parseNavigation(source) {
  const bytes = Buffer.from(source);
  if (bytes.length < 8 || bytes.readUInt32LE(0) !== MAGIC) throw new Error('Check: neplatná hlavička.');
  const count = bytes.readUInt32LE(4);
  if (count > 65536 || 8 + count * POINT_SIZE > bytes.length) throw new Error('Check: body překračují soubor.');
  const points = [], warnings = []; let links = 0;
  for (let index = 0; index < count; index++) {
    const offset = 8 + index * POINT_SIZE, position = [0,4,8].map(n => bytes.readFloatLE(offset + n));
    if (position.some(n => !Number.isFinite(n))) throw new Error('Check: neplatná pozice bodu.');
    const enterLinks = bytes[offset + 28], exitLinks = bytes[offset + 29];
    if (enterLinks !== exitLinks) warnings.push(`Bod ${index}: rozdílné počty vstupních a výstupních vazeb.`);
    points.push({ index, position, type: bytes.readUInt16LE(offset + 12), id: bytes.readUInt16LE(offset + 14), areaSize: bytes.readUInt16LE(offset + 16), enterLinks, exitLinks, links: [] });
    links += enterLinks;
  }
  const start = 8 + count * POINT_SIZE;
  if (start + links * LINK_SIZE !== bytes.length) throw new Error('Check: délka vazeb neodpovídá hlavičce.');
  let index = 0;
  for (const point of points) for (let i = 0; i < point.enterLinks; i++, index++) {
    const offset = start + index * LINK_SIZE, target = bytes.readUInt16LE(offset);
    if (target >= count) throw new Error('Check: vazba odkazuje mimo body.');
    // +4 is an undocumented float; retain its exact bytes, including NaN payloads.
    point.links.push({ index, target, type: bytes.readUInt16LE(offset + 2) });
  }
  return { points, linkCount: links, warnings };
}

export function editNavigation(source, changes) {
  const parsed = parseNavigation(source), result = Buffer.from(source), seen = new Set();
  if (!Array.isArray(changes) || changes.length > 1024) throw new Error('Check: neplatné úpravy.');
  for (const change of changes) {
    const match = /^(points|links)\/(0|[1-9]\d*)\/(position|type|id|areaSize|target)$/.exec(change?.id ?? '');
    if (!match || seen.has(change.id)) throw new Error('Check: neplatná nebo opakovaná vlastnost.');
    seen.add(change.id); const [, section, number, field] = match, index = Number(number), value = change.value;
    let offset;
    if (section === 'points') {
      if (index >= parsed.points.length || !['position','type','id','areaSize'].includes(field)) throw new Error('Check: neplatná vlastnost bodu.');
      offset = 8 + index * POINT_SIZE + {position:0,type:12,id:14,areaSize:16}[field];
    } else {
      if (index >= parsed.linkCount || !['target','type'].includes(field)) throw new Error('Check: neplatná vlastnost vazby.');
      offset = 8 + parsed.points.length * POINT_SIZE + index * LINK_SIZE + (field === 'type' ? 2 : 0);
    }
    if (field === 'position') {
      if (!Array.isArray(value) || value.length !== 3 || value.some(n => typeof n !== 'number' || !Number.isFinite(n) || !Number.isFinite(Math.fround(n)))) throw new Error('Check: očekávám konečnou pozici XYZ.');
      value.forEach((n,i) => { if (n !== result.readFloatLE(offset + i * 4)) result.writeFloatLE(n,offset + i * 4); });
    } else {
      if (!Number.isInteger(value) || value < 0 || value > 65535 || (field === 'target' && value >= parsed.points.length)) throw new Error('Check: index nebo příznaky jsou mimo rozsah.');
      result.writeUInt16LE(value,offset);
    }
  }
  parseNavigation(result); return result;
}
