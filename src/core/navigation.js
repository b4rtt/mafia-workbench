const MAGIC = 0x01abcedf, POINT_SIZE = 30, LINK_SIZE = 8;
function navigationDistance(a,b) {
  const distance=Math.hypot(...a.map((value,i)=>value-b[i]));
  const result=distance*distance<Math.fround(1e-8)?0:Math.fround(distance);
  if(!Number.isFinite(result))throw new Error('Check: vzdálenost bodů překračuje rozsah hry.');
  return result;
}

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
    distance = navigationDistance(a.position,b.position);
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

export function changeNavigationPoint(source, request) {
  if(request?.action==='insert')return insertNavigationPoint(source,request);
  const parsed=parseNavigation(source),bytes=Buffer.from(source),{action,index,position,type=1}=request??{};
  if(!['add','delete'].includes(action))throw new Error('Check: neplatná operace s bodem.');
  if(parsed.points.some((point,i)=>i>0&&point.position[0]<parsed.points[i-1].position[0]))throw new Error('Check: body nejsou seřazené podle X. Nejprve je potřeba opravit síť i segmenty.');
  let insertion,point;
  if(action==='add'){
    if(parsed.points.length===65536)throw new Error('Check: síť už má maximálních 65 536 bodů.');
    if(!Array.isArray(position)||position.length!==3||position.some(n=>typeof n!=='number'||!Number.isFinite(n)||!Number.isFinite(Math.fround(n)))||!Number.isInteger(type)||type<0||type>65535)throw new Error('Check: neplatná pozice nebo kategorie nového bodu.');
    const xyz=position.map(Math.fround);insertion=parsed.points.findIndex(p=>p.position[0]>xyz[0]);if(insertion===-1)insertion=parsed.points.length;
    point=Buffer.alloc(POINT_SIZE);xyz.forEach((n,i)=>point.writeFloatLE(n,i*4));point.writeUInt16LE(type,12);point.writeUInt16LE(50,16); // PC web_node_ctor default radius; other descriptors and links start empty.
  }else if(!Number.isInteger(index)||index<0||index>=parsed.points.length)throw new Error('Check: neplatný bod k odstranění.');
  const mapping=parsed.points.map(p=>action==='delete'?(p.index===index?-1:p.index-(p.index>index?1:0)):p.index+(p.index>=insertion?1:0));
  const nodes=[],connections=[],start=8+parsed.points.length*POINT_SIZE;
  for(const original of parsed.points){
    if(action==='add'&&original.index===insertion)nodes.push(point);
    if(mapping[original.index]===-1)continue;
    const node=Buffer.from(bytes.subarray(8+original.index*POINT_SIZE,8+(original.index+1)*POINT_SIZE)),links=[];
    for(const link of original.links){if(mapping[link.target]===-1)continue;const data=Buffer.from(bytes.subarray(start+link.index*LINK_SIZE,start+(link.index+1)*LINK_SIZE));data.writeUInt16LE(mapping[link.target]);links.push(data);}
    if(links.length!==original.links.length)node[28]=node[29]=links.length;
    nodes.push(node);connections.push(...links);
  }
  if(action==='add'&&insertion===parsed.points.length)nodes.push(point);
  const header=Buffer.from(bytes.subarray(0,8));header.writeUInt32LE(nodes.length,4);
  const result=Buffer.concat([header,...nodes,...connections]);parseNavigation(result);
  return {data:result,mapping,index:action==='add'?insertion:Math.min(index,nodes.length-1),pointCount:nodes.length};
}

function insertNavigationPoint(source, {from,to,position}) {
  const parsed=parseNavigation(source),a=parsed.points[from],b=parsed.points[to];
  if(!Number.isInteger(from)||!Number.isInteger(to)||!a||!b||from===to)throw new Error('Check: vyberte dva různé existující body spojení.');
  const ab=a.links.filter(link=>link.target===to),ba=b.links.filter(link=>link.target===from);
  if(!ab.length&&!ba.length)throw new Error('Check: mezi těmito body není spojení.');
  if(ab.length>1||ba.length>1)throw new Error('Check: spojení má opakované vazby; nelze jednoznačně vložit bod.');
  if(navigationLinkType(a.type,b.type)===null)throw new Error('Check: hra nedovoluje spojení těchto kategorií bodů.');
  const added=changeNavigationPoint(source,{action:'add',position,type:a.type}),after=parseNavigation(added.data),bytes=Buffer.from(added.data),start=8+after.points.length*POINT_SIZE;
  const inserted=after.points[added.index],first=added.mapping[from],last=added.mapping[to],outgoing=[];
  if(!navigationDistance(a.position,inserted.position)||!navigationDistance(b.position,inserted.position))throw new Error('Check: nový bod musí mít jinou pozici než oba konce spojení.');
  // Split each stored direction independently: asymmetric paths, block flags
  // and all raw link types survive without inventing a missing reverse edge.
  for(const [endpoint,other] of [[first,last],[last,first]])for(const link of after.points[endpoint].links)if(link.target===other){
    const record=Buffer.from(bytes.subarray(start+link.index*LINK_SIZE,start+(link.index+1)*LINK_SIZE));
    record.writeUInt16LE(other);record.writeFloatLE(navigationDistance(inserted.position,after.points[other].position),4);outgoing.push(record);
  }
  const offset=8+added.index*POINT_SIZE;bytes[offset+28]=bytes[offset+29]=outgoing.length;
  const records=[];
  for(const point of after.points) {
    if(point.index===added.index)records.push(...outgoing);
    for(const link of point.links){
      let record=bytes.subarray(start+link.index*LINK_SIZE,start+(link.index+1)*LINK_SIZE);
      if(point.index===first&&link.target===last||point.index===last&&link.target===first){record=Buffer.from(record);record.writeUInt16LE(added.index);record.writeFloatLE(navigationDistance(point.position,inserted.position),4);}
      records.push(record);
    }
  }
  const result=Buffer.concat([bytes.subarray(0,start),...records]);parseNavigation(result);
  return {...added,data:result};
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

export function prepareNavigationEdits(source, changes) {
  const before=parseNavigation(source),data=editNavigation(source,changes),after=parseNavigation(data),moved=new Set(),pairs=new Set(),start=8+after.points.length*POINT_SIZE;
  const pair=(a,b)=>a<b?`${a}:${b}`:`${b}:${a}`;
  for(const point of after.points){
    const original=before.points[point.index];
    if(point.position.some((value,i)=>value!==original.position[i]))moved.add(point.index);
    for(let i=0;i<point.links.length;i++)if(point.links[i].target!==original.links[i].target)pairs.add(pair(point.index,point.links[i].target));
  }
  // Update both incoming and outgoing paths; untouched legacy distances remain byte-exact.
  for(const point of after.points)for(const link of point.links)if(moved.has(point.index)||moved.has(link.target)||pairs.has(pair(point.index,link.target)))data.writeFloatLE(navigationDistance(point.position,after.points[link.target].position),start+link.index*LINK_SIZE+4);
  const order=after.points.map(point=>point.index);
  if(moved.size)order.sort((a,b)=>after.points[a].position[0]-after.points[b].position[0]);
  const mapping=new Array(order.length);order.forEach((old,index)=>mapping[old]=index);
  if(mapping.every((index,old)=>index===old))return {data,mapping};
  const nodes=[],connections=[];
  for(const index of order){
    const point=after.points[index];nodes.push(data.subarray(8+index*POINT_SIZE,8+(index+1)*POINT_SIZE));
    for(const link of point.links){const record=Buffer.from(data.subarray(start+link.index*LINK_SIZE,start+(link.index+1)*LINK_SIZE));record.writeUInt16LE(mapping[link.target]);connections.push(record);}
  }
  const result=Buffer.concat([data.subarray(0,8),...nodes,...connections]);parseNavigation(result);return {data:result,mapping};
}
