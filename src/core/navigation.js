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
    // The PC loader reads +29, then replaces the capacity (+28) and pointer (+24).
    const capacity = bytes[offset + 28], connectionCount = bytes[offset + 29];
    if (capacity < connectionCount) warnings.push(`Bod ${index}: uložená kapacita je menší než počet vazeb; hra kapacitu znovu vytvoří.`);
    points.push({ index, position, type: bytes.readUInt16LE(offset + 12), id: bytes.readUInt16LE(offset + 14), areaSize: bytes.readUInt16LE(offset + 16), capacity, connectionCount, links: [] });
    links += connectionCount;
  }
  const start = 8 + count * POINT_SIZE;
  if (start + links * LINK_SIZE !== bytes.length) throw new Error('Check: délka vazeb neodpovídá hlavičce.');
  let index = 0;
  for (const point of points) for (let i = 0; i < point.connectionCount; i++, index++) {
    const offset = start + index * LINK_SIZE, target = bytes.readUInt16LE(offset);
    if (target >= count) throw new Error('Check: vazba odkazuje mimo body.');
    // +4 is traversal distance. Existing bytes, including legacy NaNs, stay intact.
    point.links.push({ index, target, type: bytes.readUInt16LE(offset + 2) });
  }
  return { points, linkCount: links, warnings };
}

export function navigationLinkType(a, b) {
  const categories = a | b;
  if (!(categories & 0x13) && !(categories & 0x0c) || (categories & 0x13) && (categories & 0x0c)) return null;
  return categories & 0x0c ? 4 : categories & 0x10 ? 0x10 : categories & 2 ? 2 : 1;
}

export function changeNavigationConnection(source, request) {
  const parsed = parseNavigation(source), { action, from, to, direction = 'both' } = request ?? {};
  if (!['connect','disconnect'].includes(action) || !Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0 || from >= parsed.points.length || to >= parsed.points.length || from === to) throw new Error('Check: vyberte dva různé existující body.');
  if (!['both','forward','backward'].includes(direction)) throw new Error('Check: neplatný směr spojení.');
  const a = parsed.points[from], b = parsed.points[to], ab = a.links.filter(link => link.target === to), ba = b.links.filter(link => link.target === from);
  let kind, distance;
  if (action === 'connect') {
    if (ab.length || ba.length) throw new Error('Check: body už mají spojení. Nejprve je odpojte.');
    kind = navigationLinkType(a.type,b.type);
    if (kind === null) throw new Error('Check: hra nedovoluje spojení těchto kategorií bodů.');
    if (a.links.length === 255 || b.links.length === 255) throw new Error('Check: bod už má maximálních 255 vazeb.');
    distance = Math.fround(Math.hypot(...a.position.map((value,i) => value - b.position[i])));
    if (!Number.isFinite(distance)) throw new Error('Check: vzdálenost bodů překračuje rozsah hry.');
  } else if (!ab.length && !ba.length) throw new Error('Check: mezi těmito body není spojení.');
  const bytes = Buffer.from(source), start = 8 + parsed.points.length * POINT_SIZE, records = [];
  for (const point of parsed.points) {
    const endpoint = point.index === from || point.index === to, target = point.index === from ? to : from;
    if (!endpoint) {
      if (point.links.length) records.push(bytes.subarray(start + point.links[0].index * LINK_SIZE,start + (point.links.at(-1).index + 1) * LINK_SIZE));
      continue;
    }
    const links = point.links.filter(link => !(action === 'disconnect' && endpoint && link.target === target)).map(link => bytes.subarray(start + link.index * LINK_SIZE,start + (link.index + 1) * LINK_SIZE));
    if (endpoint && action === 'connect') {
      const link = Buffer.alloc(LINK_SIZE), blocked = direction === 'forward' && point.index === to || direction === 'backward' && point.index === from;
      link.writeUInt16LE(target); link.writeUInt16LE(kind | (blocked ? 0x80 : 0),2); link.writeFloatLE(distance,4); links.push(link);
    }
    records.push(...links);
    if (links.length !== point.links.length) {
      const offset = 8 + point.index * POINT_SIZE;
      bytes[offset + 28] = bytes[offset + 29] = links.length;
    }
  }
  const result = Buffer.concat([bytes.subarray(0,start), ...records]);
  parseNavigation(result); return result;
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
