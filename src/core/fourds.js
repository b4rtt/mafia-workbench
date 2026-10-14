import iconv from 'iconv-lite';
import { editableMaterialFlags } from '../shared/material-settings.js';
class Reader {
  constructor(source) { this.bytes = Buffer.from(source); this.pos = 0; this.entries = []; this.context = ''; }
  skip(n) { if (!Number.isSafeInteger(n) || n < 0 || this.pos + n > this.bytes.length) throw new Error(`4DS: data jsou mimo soubor (${this.pos}, ${n}).`); this.pos += n; }
  number(method, length) { const start = this.pos; this.skip(length); return this.bytes[method](start); }
  u8() { return this.number('readUInt8', 1); }
  u16() { return this.number('readUInt16LE', 2); }
  u32() { return this.number('readUInt32LE', 4); }
  field(id, label, kind, count = 1, allowInvalid = false) {
    const offset = this.pos;
    let value;
    if (kind === 'string8') { const size = this.u8(), start = this.pos; this.skip(size); value = iconv.decode(this.bytes.subarray(start, this.pos), 'windows-1250'); }
    else {
      const values = Array.from({ length: count }, () => kind === 'u8' ? this.u8() : kind === 'u16' ? this.u16() : kind === 'u32' ? this.u32() : this.number('readFloatLE', 4));
      if (!allowInvalid && values.some(n => !Number.isFinite(n))) throw new Error(`4DS: neplatná hodnota ${label}.`);
      value = count === 1 ? values[0] : values;
    }
    this.entries.push({ id, label, kind, value, offset, length: this.pos - offset, context: this.context, ...(id.includes('/sector/') ? { sectorField: true, ...(kind === 'u32' ? { min: 0, max: 4294967295 } : {}), ...(count === 2 ? { componentLabels: ['1', '2'] } : {}) } : {}) });
    return value;
  }
}
function object(reader, geometry) {
  const instance = reader.u16(), lods = [];
  if (instance) return { instance, lods };
  const count = reader.u8();
  for (let lod = 0; lod < count; lod++) {
    const distance = reader.number('readFloatLE', 4), vertices = reader.u16(), start = reader.pos;
    reader.skip(vertices * 32);
    const read = geometry && (geometry === 'all' || lod === 0);
    const positions = read ? Array.from({ length: vertices * 3 }, (_, i) => reader.bytes.readFloatLE(start + Math.floor(i / 3) * 32 + i % 3 * 4)) : [];
    const normals = read ? Array.from({ length: vertices * 3 }, (_, i) => reader.bytes.readFloatLE(start + Math.floor(i / 3) * 32 + 12 + i % 3 * 4)) : [];
    const uv = read ? Array.from({ length: vertices * 2 }, (_, i) => reader.bytes.readFloatLE(start + Math.floor(i / 2) * 32 + 24 + i % 2 * 4)) : [];
    if (positions.some(v => !Number.isFinite(v))) throw new Error('4DS: vrcholy obsahují neplatná čísla.');
    // Some shipped meshes have uninitialised, unused UVs/normals. Retain source bytes;
    // only the preview substitutes UV zeroes and recomputes invalid normals.
    const invalidNormals = normals.some(v => !Number.isFinite(v)), invalidUV = uv.some(v => !Number.isFinite(v));
    const raw = geometry === 'all' ? { ...(invalidNormals ? { rawNormals:[...normals] } : {}), ...(invalidUV ? { rawUV:[...uv] } : {}) } : {};
    if (invalidNormals) normals.fill(0);
    if (invalidUV) uv.forEach((v, i) => { if (!Number.isFinite(v)) uv[i] = 0; });
    const groups = reader.u8(), faces = [];
    for (let group = 0; group < groups; group++) {
      const count = reader.u16(), begin = reader.pos; reader.skip(count * 6); const material = reader.u16();
      if (read) {
        const indices = Array.from({ length: count * 3 }, (_, i) => reader.bytes.readUInt16LE(begin + i * 2));
        if (indices.some(index => index >= vertices)) throw new Error('4DS: trojúhelník odkazuje mimo vrcholy.');
        faces.push({ material, indices });
      }
    }
    lods.push({ distance, vertices, positions, normals, uv, faces, invalidNormals, invalidUV, ...(geometry === 'all' ? { vertexOffset:start, endOffset:reader.pos, ...raw } : {}) });
  }
  return { instance, lods };
}
function skin(reader, lods) {
  const result = [];
  for (const lod of lods) {
    const count = reader.u8(), rootVertices = reader.u32(); reader.skip(24);
    const bones = []; let vertices = rootVertices, valid = true;
    for (let bone = 0; bone < count; bone++) {
      const inverse = Array.from({ length: 16 }, () => reader.number('readFloatLE', 4));
      const rigid = reader.u32(), weighted = reader.u32(), parent = reader.u32(); reader.skip(24);
      reader.skip(weighted * 4);
      const weights = Array.from({ length: weighted }, (_, i) => reader.bytes.readFloatLE(reader.pos - weighted * 4 + i * 4));
      valid &&= parent <= count && weights.every(w => Number.isFinite(w) && w >= 0 && w <= 1);
      vertices += rigid + weighted;
      bones.push({ id: bone + 1, inverse, rigid, parent, weights });
    }
    result.push({ rootVertices, bones, valid: valid && vertices === lod.vertices });
  }
  return result;
}
function morph(reader) {
  const targets = reader.u8(); if (!targets) return;
  const channels = reader.u8(), lods = reader.u8();
  for (let lod = 0; lod < lods; lod++) for (let channel = 0; channel < channels; channel++) {
    const vertices = reader.u16(); if (!vertices) continue;
    reader.skip(vertices * targets * 24);
    const indices = reader.u8(); if (indices) reader.skip(vertices * 2);
  }
  reader.skip(40);
}
function triangleMesh(reader, sector = false) {
  if (sector) reader.skip(8);
  const vertices = reader.u32(), faces = reader.u32(); reader.skip(vertices * 12 + faces * 6);
  if (sector) { reader.skip(24); const portals = reader.u8(); for (let portal = 0; portal < portals; portal++) { const points = reader.u8(); reader.skip(28 + points * 12); } }
}
function sectorMesh(reader, base, geometry) {
  const flags = reader.field(`${base}/sector/flags`, 'Sektor · příznaky 1/2 (raw)', 'u32', 2);
  const geometryOffset = reader.pos;
  const vertices = reader.u32(), faces = reader.u32(), start = reader.pos;
  reader.skip(vertices * 12 + faces * 6);
  const positions = geometry ? Array.from({ length: vertices * 3 }, (_, i) => reader.bytes.readFloatLE(start + i * 4)) : [];
  const indices = geometry ? Array.from({ length: faces * 3 }, (_, i) => reader.bytes.readUInt16LE(start + vertices * 12 + i * 2)) : [];
  const boundsOffset = reader.pos, bounds = Array.from({ length: 6 }, () => reader.number('readFloatLE', 4));
  const portalsOffset = reader.pos;
  const count = reader.u8(), portals = [];
  for (let i = 0; i < count; i++) {
    const offset = reader.pos, points = reader.u8(), prefix = `${base}/sector/portals/${i}`;
    // Mafia v29 is flags, two raw float parameters, plane, vertices. The
    // RoadTrain template puts the plane first; original files contradict it.
    const flags = reader.field(`${prefix}/flags`, `Portál ${i + 1} · příznaky (raw)`, 'u32');
    const parameters = reader.field(`${prefix}/parameters`, `Portál ${i + 1} · parametry 1/2 (raw)`, 'float', 2, true);
    const planeOffset = reader.pos, plane = Array.from({ length: 4 }, () => reader.number('readFloatLE', 4));
    const start = reader.pos; reader.skip(points * 12);
    const positions = geometry ? Array.from({ length: points * 3 }, (_, j) => reader.bytes.readFloatLE(start + j * 4)) : [];
    portals.push({ flags, parameters, plane, points, positions, offset, planeOffset, vertexOffset: start, endOffset: reader.pos });
  }
  return { flags, vertices, faces, positions, indices, bounds, portals, geometryOffset, vertexOffset: start, boundsOffset, portalsOffset, endOffset: reader.pos };
}
export function parseFourDs(source, geometry = false) {
  const reader = new Reader(source);
  if (reader.bytes.length < 16 || reader.bytes.toString('ascii', 0, 4) !== '4DS\0') throw new Error('4DS: neplatná hlavička.');
  reader.skip(4); const version = reader.u16(); if (version !== 29) throw new Error(`4DS: verze ${version} zatím není podporovaná.`);
  reader.skip(8);
  const materialCount = reader.u16(), materials = [];
  for (let i = 0; i < materialCount; i++) {
    const start=reader.pos;
    reader.context = `Materiál ${i + 1}`; const base = `materials/${i}`, flags = reader.u32();
    const ambient = reader.field(`${base}/ambient`, 'Ambient RGB', 'float', 3), diffuse = reader.field(`${base}/diffuse`, 'Diffuse RGB', 'float', 3), emission = reader.field(`${base}/emission`, 'Emission RGB', 'float', 3), opacity = reader.field(`${base}/opacity`, 'Opacity', 'float');
    let reflection,environmentTexture;
    if (flags & 0x80000) { reflection=reader.field(`${base}/reflection`, 'Síla odrazu', 'float'); environmentTexture=reader.field(`${base}/environmentTexture`, 'Textura odrazu', 'string8'); }
    const texture = reader.field(`${base}/texture`, 'Diffuse textura', 'string8');
    let alphaTexture;
    if (texture && (flags & 0x40000000) && !(flags & 0x1000000)) alphaTexture = reader.field(`${base}/alphaTexture`, 'Alpha textura', 'string8');
    const animationOffset=reader.pos;if (flags & 0x4000000) reader.skip(18);
    materials.push({ flags, ambient, diffuse, emission, opacity, texture, alphaTexture, reflection, environmentTexture, layout:{start,length:reader.pos-start,animationOffset,animationLength:reader.pos-animationOffset} });
  }
  const meshCountOffset=reader.pos, meshCount = reader.u16(), framesOffset=reader.pos, meshes = [];
  for (let i = 0; i < meshCount; i++) {
    reader.context = `Objekt ${i + 1}`; const base = `meshes/${i}`, type = reader.u8();
    let visual, renderFlags, logicFlags;
    if (type === 1) { visual = reader.u8(); renderFlags = reader.u8(); logicFlags = reader.u8(); }
    const parent = reader.field(`${base}/parent`, 'Rodič (0 = kořen)', 'u16'), position = reader.field(`${base}/position`, 'Pozice XYZ', 'float', 3), scale = reader.field(`${base}/scale`, 'Měřítko XYZ', 'float', 3), rotation = reader.field(`${base}/rotation`, 'Rotace WXYZ', 'float', 4);
    const culling = reader.field(`${base}/culling`, 'Culling příznaky', 'u8');
    const name = reader.field(`${base}/name`, 'Název objektu', 'string8'), properties = reader.field(`${base}/properties`, 'Vlastnosti objektu', 'string8');
    const mesh = { id: i + 1, name, parent, position, scale, rotation, type, visual, renderFlags, logicFlags, culling, properties };
    if (type === 1) {
      if ([0, 1, 2, 3, 4, 5].includes(visual)) {
        const data = object(reader, geometry); Object.assign(mesh, data);
        if (visual === 2 || visual === 3) mesh.skin = skin(reader, data.lods);
        if ((visual === 3 || visual === 5) && !data.instance) morph(reader);
        // A billboard instance shares its vertex buffer, but still stores its
        // own axis/mode payload. Skipping it misaligns the next frame (airport).
        if (visual === 4) reader.skip(5);
      } else if (visual === 6) reader.skip(reader.u8() * 6);
      else if (visual === 7) reader.skip(4);
      else if (visual === 8) { reader.skip(120); triangleMesh(reader); }
      else if (visual === 9) reader.skip(5);
      else throw new Error(`4DS: nepodporovaný visual type ${visual}.`);
    } else if (type === 2) reader.skip(84);
    else if (type === 5) mesh.sector = sectorMesh(reader, base, geometry);
    else if (type === 6) reader.skip(24);
    else if (type === 7) { reader.skip(2); reader.skip(reader.u8() * 2); }
    else if (type === 10) { mesh.inverseBind = Array.from({ length: 16 }, () => reader.number('readFloatLE', 4)); mesh.joint = reader.u32() + 1; }
    else if (type === 12) triangleMesh(reader);
    else throw new Error(`4DS: nepodporovaný frame type ${type}.`);
    meshes.push(mesh);
  }
  if (reader.pos + 1 !== reader.bytes.length) throw new Error(`4DS: neočekávaný konec (${reader.bytes.length - reader.pos} nerozpoznaných bajtů).`);
  const animatedOffset=reader.pos, animated = reader.u8();
  // Validate before a renderer recursively evaluates world transforms.
  for (const mesh of meshes) {
    const visited = new Set([mesh.id]); let parent = mesh.parent;
    while (parent) {
      if (visited.has(parent) || !meshes[parent - 1]) throw new Error('4DS: neplatná hierarchie objektů.');
      visited.add(parent); parent = meshes[parent - 1].parent;
    }
  }
  return { version, materials, meshes, entries: reader.entries, animated, layout:{meshCountOffset,framesOffset,animatedOffset} };
}
export function editFourDs(source, changes) {
  const original = Buffer.from(source), parsed = parseFourDs(original);
  if (!Array.isArray(changes) || changes.length > 1024) throw new Error('4DS: neplatné úpravy.');
  const replacements = [], seen = new Set(),materialChanges=new Map();
  for (const { id, value } of changes) {
    const material=/^materials\/(\d+)\/(.+)$/.exec(id);
    if(material){
      const index=Number(material[1]),field=material[2];
      if(!parsed.materials[index]||id!==`materials/${index}/${field}`||seen.has(id)||field!=='settings'&&!parsed.entries.some(entry=>entry.id===id))throw new Error('4DS: neplatná vlastnost materiálu.');
      seen.add(id);if(!materialChanges.has(index))materialChanges.set(index,[]);materialChanges.get(index).push({field,value});continue;
    }
    const entry = parsed.entries.find(e => e.id === id);
    if (!entry || seen.has(id)) throw new Error('4DS: neplatná vlastnost.'); seen.add(id);
    const unchanged = entry.sectorField
      ? Array.isArray(entry.value) ? Array.isArray(value) && entry.value.length === value.length && entry.value.every((v, i) => Object.is(v, value[i])) : Object.is(entry.value, value)
      : JSON.stringify(value) === JSON.stringify(entry.value);
    if (unchanged) continue;
    let payload;
    if (entry.kind === 'string8') {
      if (typeof value !== 'string' || value.includes('\0')) throw new Error('4DS: neplatný řetězec.');
      const bytes = iconv.encode(value, 'windows-1250');
      if (bytes.length > 255 || iconv.decode(bytes, 'windows-1250') !== value) throw new Error('4DS: řetězec je příliš dlouhý nebo jej nelze kódovat.');
      payload = Buffer.concat([Buffer.from([bytes.length]), bytes]);
    } else {
      const values = Array.isArray(entry.value) ? value : [value];
      const count = Array.isArray(entry.value) ? entry.value.length : 1;
      if (!Array.isArray(values) || values.length !== count || values.some(v => typeof v !== 'number' || !Number.isFinite(v) || !Number.isFinite(Math.fround(v)))) throw new Error('4DS: neplatná číselná hodnota.');
      payload = Buffer.alloc(entry.length);
      values.forEach((v, i) => {
        if (entry.kind === 'u8' || entry.kind === 'u16' || entry.kind === 'u32') {
          const max = entry.kind === 'u8' ? 255 : entry.kind === 'u16' ? 65535 : 4294967295;
          if (!Number.isInteger(v) || v < 0 || v > max || (id.endsWith('/parent') && v > parsed.meshes.length)) throw new Error('4DS: neplatný index nebo příznaky.');
          if (entry.kind === 'u8') payload.writeUInt8(v);
          else if (entry.kind === 'u16') payload.writeUInt16LE(v);
          else payload.writeUInt32LE(v, i * 4);
        } else payload.writeFloatLE(v, i * 4);
      });
    }
    replacements.push({ ...entry, payload });
  }
  for(const [index,updates] of materialChanges){
    for(const {field,value} of updates){
      const fields=field==='settings'?value:{[field]:value};
      if(!fields||typeof fields!=='object'||Array.isArray(fields)||Object.keys(fields).some(key=>!['flags','ambient','diffuse','emission','opacity','texture','alphaTexture','reflection','environmentTexture'].includes(key)))throw new Error('4DS: neplatné nastavení materiálu.');
      for(const key of ['texture','alphaTexture','environmentTexture'])if(Object.hasOwn(fields,key)&&typeof fields[key]!=='string')throw new Error('4DS: neplatný název textury.');
      if(Object.hasOwn(fields,'reflection')&&(typeof fields.reflection!=='number'||!Number.isFinite(fields.reflection)||!Number.isFinite(Math.fround(fields.reflection))))throw new Error('4DS: neplatná síla odrazu.');
    }
    const material=parsed.materials[index],settings={...material,...updates.find(update=>update.field==='settings')?.value};
    for(const {field,value} of updates)if(field!=='settings')settings[field]=value;
    const payload=writeMaterial(original,material,settings,parsed.entries.filter(entry=>entry.id.startsWith(`materials/${index}/`)));
    if(!payload.equals(original.subarray(material.layout.start,material.layout.start+material.layout.length)))replacements.push({offset:material.layout.start,length:material.layout.length,payload});
  }
  replacements.sort((a, b) => b.offset - a.offset);
  let result = original;
  for (const replacement of replacements) result = Buffer.concat([result.subarray(0, replacement.offset), replacement.payload, result.subarray(replacement.offset + replacement.length)]);
  parseFourDs(result);
  return result;
}

function writeMaterial(source,original,value,entries){
  const flags=value.flags;
  if(!Number.isInteger(flags)||flags<0||flags>4294967295||((flags^original.flags)&~editableMaterialFlags)!==0)throw new Error('4DS: lze měnit pouze podporované příznaky materiálu; ostatní bity musí zůstat zachované.');
  const equal=(a,b)=>Array.isArray(a)&&Array.isArray(b)?a.length===b.length&&a.every((n,i)=>Object.is(n,b[i])):Object.is(a,b);
  const stored=field=>entries.find(entry=>entry.id.endsWith('/'+field));
  function number(field,count=1){
    const current=value[field],numbers=count===1?[current]:current;
    if(!Array.isArray(numbers)||numbers.length!==count||!Array.from(numbers).every(n=>typeof n==='number'&&Number.isFinite(n)&&Number.isFinite(Math.fround(n))))throw new Error('4DS: neplatná číselná hodnota materiálu.');
    if(field==='opacity'&&!equal(current,original[field])&&(current<0||current>1))throw new Error('4DS: krytí materiálu musí být 0–1.');
    const entry=stored(field);if(entry&&equal(current,original[field]))return source.subarray(entry.offset,entry.offset+entry.length);
    const bytes=Buffer.alloc(count*4);numbers.forEach((n,i)=>bytes.writeFloatLE(n,i*4));return bytes;
  }
  function text(field){
    const current=value[field]??'';
    if(typeof current!=='string'||current.includes('\0'))throw new Error('4DS: neplatný název textury.');
    const entry=stored(field);if(entry&&current===original[field])return source.subarray(entry.offset,entry.offset+entry.length);
    const bytes=iconv.encode(current,'windows-1250');if(bytes.length>255||iconv.decode(bytes,'windows-1250')!==current)throw new Error('4DS: název textury nelze kódovat nebo je příliš dlouhý.');
    return Buffer.concat([Buffer.from([bytes.length]),bytes]);
  }
  const header=Buffer.alloc(4);header.writeUInt32LE(flags);
  const parts=[header,number('ambient',3),number('diffuse',3),number('emission',3),number('opacity')];
  if(flags&0x80000)parts.push(number('reflection'),text('environmentTexture'));
  parts.push(text('texture'));
  if(value.texture&&(flags&0x40000000)&&!(flags&0x01000000))parts.push(text('alphaTexture'));
  else if(value.alphaTexture&&value.alphaTexture!==original.alphaTexture)throw new Error('4DS: alpha textura vyžaduje diffuse texturu a odpovídající režim masky.');
  parts.push(source.subarray(original.layout.animationOffset,original.layout.animationOffset+original.layout.animationLength));
  return Buffer.concat(parts);
}
