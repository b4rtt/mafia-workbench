import iconv from 'iconv-lite';
import { humanFields } from '../shared/human-parameters.js';
import { inspectDoor, editDoor, createDoor } from './doors.js';
import { sceneSectors, validateNewLight } from '../shared/lights.js';
import { validateNewSound } from '../shared/sounds.js';
const containers = new Set([0x4c53, 0x4000, 0x4010, 0x4020, 0x4040, 0x4060, 0xae20, 0xae21, 0xae50]);
const names = new Map([[0x4c53, 'Scéna'], [0x4000, 'Objekty'], [0x4010, 'Objekt'], [0x4020, 'Rodič'], [0x4040, 'Světlo'], [0x4060, 'Zvuk'], [0xae20, 'Aktéři'], [0xae21, 'Aktér'], [0xae50, 'Skripty'], [0xae51, 'Skript']]);
const fields = new Map([
  [0x10, ['Název', 'string']], [0x20, ['Pozice', 'vec3']], [0x21, ['Směr', 'vec3']], [0x22, ['Rotace WXYZ', 'quat']], [0x2d, ['Měřítko', 'vec3']], [0x26, ['Barva RGB', 'vec3']], [0x2a, ['Jednotné měřítko', 'float']], [0x2b, ['Pivot', 'vec3']], [0x2c, ['Světová pozice', 'vec3']],
  [0x2012, ['Model', 'string']], [0x4011, ['Typ objektu', 'uint']], [0x4012, ['Podtyp objektu', 'uint']], [0x4014, ['Příznaky objektu', 'uint']],
  [0x4041, ['Typ světla', 'uint']], [0x4042, ['Síla světla', 'float']], [0x4043, ['Světelný kužel', 'vec2']], [0x4044, ['Dosah světla', 'vec2']], [0x4045, ['Režim světla', 'uint']], [0x4046, ['Sektor světla', 'string']], [0x4048, ['Síla odlesku', 'float']],
  [0x4061, ['Typ zvuku', 'uint']], [0x4062, ['Hlasitost', 'float']], [0x4063, ['Vnější hlasitost', 'float']], [0x4064, ['Zvukový kužel', 'vec2']], [0x4068, ['Dosah zvuku', 'vec4']], [0xb200, ['Sektor zvuku', 'string']],
  [0xae22, ['Typ aktéra', 'uint']], [0xae23, ['Název aktéra', 'string']], [0xae51, ['Skript', 'script']]
]);
function string(bytes) {
  const end = bytes.indexOf(0);
  if (end < 0) throw new Error('Scene: chybí ukončení řetězce.');
  return iconv.decode(bytes.subarray(0, end), 'windows-1250');
}
function encode(value) {
  if (typeof value !== 'string' || value.includes('\0') || value.length > 1000000) throw new Error('Scene: neplatný řetězec.');
  const bytes = iconv.encode(value, 'windows-1250');
  if (iconv.decode(bytes, 'windows-1250') !== value) throw new Error('Scene: text nelze zapsat v kódování Windows-1250.');
  return bytes;
}
function decodeField(kind, payload) {
  if (kind === 'string') return string(payload);
  if (kind === 'script') {
    if (payload.length < 9) throw new Error('Scene: useknutá hlavička skriptu.');
    const nameLength = payload.readUInt32LE(1), codeStart = 5 + nameLength;
    if (codeStart + 4 > payload.length) throw new Error('Scene: neplatná délka názvu skriptu.');
    const length = payload.readUInt32LE(codeStart);
    if (codeStart + 4 + length > payload.length) throw new Error('Scene: neplatná délka kódu skriptu.');
    return { name: iconv.decode(payload.subarray(5, codeStart), 'windows-1250'), code: iconv.decode(payload.subarray(codeStart + 4, codeStart + 4 + length), 'windows-1250') };
  }
  const count = { uint: 1, float: 1, vec2: 2, vec3: 3, vec4: 4, quat: 4 }[kind];
  if (payload.length < count * 4) throw new Error('Scene: useknutá číselná vlastnost.');
  const values = Array.from({ length: count }, (_, i) => kind === 'uint' ? payload.readUInt32LE(i * 4) : payload.readFloatLE(i * 4));
  if (values.some(v => !Number.isFinite(v))) throw new Error('Scene: neplatná číselná vlastnost.');
  return count === 1 ? values[0] : values;
}
function encodeField(kind, value, original) {
  if (kind === 'string') {
    const end = original.indexOf(0);
    return Buffer.concat([encode(value), Buffer.from([0]), original.subarray(end + 1)]);
  }
  if (kind === 'script') {
    if (!value || typeof value.name !== 'string' || typeof value.code !== 'string') throw new Error('Scene: neplatný skript.');
    const oldNameLength = original.readUInt32LE(1), oldCodeStart = 5 + oldNameLength;
    const tail = original.subarray(oldCodeStart + 4 + original.readUInt32LE(oldCodeStart));
    const name = encode(value.name), code = encode(value.code), header = Buffer.alloc(5), codeLength = Buffer.alloc(4);
    header[0] = original[0]; header.writeUInt32LE(name.length, 1); codeLength.writeUInt32LE(code.length);
    return Buffer.concat([header, name, codeLength, code, tail]);
  }
  const count = { uint: 1, float: 1, vec2: 2, vec3: 3, vec4: 4, quat: 4 }[kind], values = count === 1 ? [value] : value;
  if (!Array.isArray(values) || values.length !== count || values.some(v => typeof v !== 'number' || !Number.isFinite(v) || (kind === 'uint' ? !Number.isInteger(v) || v < 0 || v > 0xffffffff : !Number.isFinite(Math.fround(v))))) throw new Error('Scene: neplatná číselná hodnota.');
  const result = Buffer.from(original);
  values.forEach((v, i) => kind === 'uint' ? result.writeUInt32LE(v, i * 4) : result.writeFloatLE(v, i * 4));
  return result;
}
function tree(source) {
  const bytes = Buffer.from(source);
  if (bytes.length < 6 || bytes.readUInt16LE(0) !== 0x4c53) throw new Error('Scene: chybí kořen LS.');
  let count = 0;
  function parse(start, end, prefix = '', depth = 0) {
    if (depth > 64) throw new Error('Scene: příliš hluboká struktura.');
    const nodes = [];
    while (start < end) {
      if (++count > 1000000 || start + 6 > end) throw new Error('Scene: useknutá hlavička chunku.');
      const type = bytes.readUInt16LE(start), size = bytes.readUInt32LE(start + 2);
      if (size < 6 || start + size > end) throw new Error('Scene: chunk překračuje nadřazený blok.');
      const id = prefix + nodes.length, payload = bytes.subarray(start + 6, start + size);
      const node = { id, type, raw: bytes.subarray(start, start + size), payload };
      if (containers.has(type)) node.children = parse(start + 6, start + size, `${id}/`, depth + 1);
      nodes.push(node); start += size;
    }
    return nodes;
  }
  return parse(0, bytes.length);
}
function actorScriptLayout(kind, data) {
  if (!data) return null;
  let lengthOffset;
  if (kind === 5 && data.length >= 14 && data[0] === 1 && data.readUInt32LE(1) <= 1 && data[5] === 1 && data.readUInt32LE(6) === 0) {
    lengthOffset = 10;
  } else if (kind === 27 && data.length >= 83 && data[0] === 6 && data[73] === 1 && data[74] === 1 && data.readUInt32LE(75) === 0) {
    // C_human v6: 1 version byte, two dwords, 64 stats bytes. C_entity
    // then stores its version and C_program v1 with an empty first string.
    // The second source string is the script; preserve everything else.
    lengthOffset = 79;
  } else return null;
  const codeStart = lengthOffset + 4, length = data.readUInt32LE(lengthOffset);
  return length <= 1000000 && codeStart + length <= data.length ? { lengthOffset, codeStart, length } : null;
}
function humanParameterLayout(kind, data) {
  // mLib CScene2 character/player parameters; C_human v6 reads this exact
  // 73-byte prefix. Upper flag/voice bytes and the entity program stay opaque.
  if (![2,27].includes(kind) || !data || data.length < 73 || data[0] !== 6) return [];
  if (humanFields.some(field=>field.kind==='float'&&!Number.isFinite(data.readFloatLE(field.offset)))) return [];
  return humanFields;
}
export function inspectScene(source) {
  const roots = tree(source), entries = [], objects = [], actorScripts = [];
  let opaque = 0;
  function visit(nodes, parent = '') {
    const named = nodes.find(n => n.type === 0x10 || n.type === 0xae23);
    let context = parent;
    if (named) context += ` / ${string(named.payload)}`;
    for (const node of nodes) {
      if (node.type === 0xae21 && node.children) {
        const kind = node.children.find(n => n.type === 0xae22)?.payload;
        const data = node.children.find(n => n.type === 0xae24)?.payload;
        const name = node.children.find(n => n.type === 0xae23)?.payload;
        const actorKind = kind?.length >= 4 ? kind.readUInt32LE(0) : null;
        if(name&&actorKind===6)for(const field of inspectDoor(data)){
          const nodeId=node.children.find(n=>n.type===0xae24).id;
          entries.push({...field,id:`${nodeId}:door.${field.key}`,nodeId,doorParameter:true,actorKind,context:`${context} / ${string(name)}`.replace(/^ \/ /,'')});
        }
        if (name) for (const field of humanParameterLayout(actorKind, data)) {
          const nodeId=node.children.find(n=>n.type===0xae24).id;
          entries.push({id:`${nodeId}:${field.key}`,nodeId,label:field.label,kind:field.kind,value:field.kind==='byte'?data[field.offset]:data.readFloatLE(field.offset),humanParameter:true,humanMaximum:Boolean(field.maximum),actorKind,offset:field.offset,context:`${context} / ${string(name)}`.replace(/^ \/ /,''),bytes:field.kind==='byte'?1:4});
        }
        const layout = actorScriptLayout(actorKind, data);
        if (name && layout) {
          const value={name:string(name),code:iconv.decode(data.subarray(layout.codeStart,layout.codeStart+layout.length),'windows-1250')};
          actorScripts.push(value);
          entries.push({id:node.children.find(n=>n.type===0xae24).id,label:'Skript aktéra',kind:'script',value,actorScript:true,actorKind,context:`${context} / ${value.name}`.replace(/^ \/ /,''),bytes:data.length});
        }
      }
      if (node.type === 0x4010 && node.children) {
        const object = { id: node.id, fields: {} };
        for (const child of node.children) {
          const field = new Map([[0x10, 'name'], [0x20, 'position'], [0x22, 'rotation'], [0x2d, 'scale'], [0x2012, 'model'], [0x2c, 'worldPosition'], [0x4011, 'frameType']]).get(child.type);
          if (field) { object[field] = decodeField(fields.get(child.type)[1], child.payload); object.fields[field] = child.id; }
          if (child.type === 0x4020 && child.children) { const name = child.children.find(n => n.type === 0x10); if (name) object.parent = string(name.payload); }
        }
        if (object.name) objects.push(object);
      }
      if (node.type === 0x4060 && node.children) entries.push({id:`${node.id}:sound.loop`,nodeId:node.id,label:'Opakovat zvuk',kind:'boolean',value:node.children.some(child=>child.type===0x4066),soundParameter:true,context:`${context} / Zvuk`.replace(/^ \/ /,''),bytes:0});
      if (node.children) visit(node.children, `${context} / ${names.get(node.type)}`);
      else if (fields.has(node.type)) {
        const [label, storedKind] = fields.get(node.type), kind = node.type===0x4068 && node.payload.length===8 ? 'vec2' : storedKind;
        entries.push({ id: node.id, label, kind, value: decodeField(kind, node.payload), context: context.replace(/^ \/ /, ''), bytes: node.payload.length });
      } else opaque++;
    }
  }
  visit(roots);
  const actorNames = new Set(entries.filter(e => e.label === 'Název aktéra').map(e => e.value.normalize('NFC').toLowerCase()));
  for (const object of objects) object.actorBound = actorNames.has(object.name.normalize('NFC').toLowerCase());
  return { entries, opaque, objects, actorScripts };
}
export function editScene(source, id, value) {
  if (typeof id !== 'string') throw new Error('Scene: neplatná vlastnost.');
  const roots = tree(source), scene=inspectScene(source), actorScripts = new Map(scene.entries.filter(e=>e.actorScript).map(e=>[e.id,e]));
  const humanParameter=scene.entries.find(entry=>entry.id===id&&entry.humanParameter);
  const doorParameter=scene.entries.find(entry=>entry.id===id&&entry.doorParameter);
  const soundParameter=scene.entries.find(entry=>entry.id===id&&entry.soundParameter);
  let found = false;
  function write(node) {
    let payload;
    if(soundParameter&&node.id===soundParameter.nodeId){
      if(typeof value!=='boolean')throw new Error('Zvuk: opakování musí být zapnuté nebo vypnuté.');
      found=true;if(value===soundParameter.value)return node.raw;
      const children=node.children.filter(child=>child.type!==0x4066).map(child=>child.raw);
      if(value){const header=Buffer.alloc(6);header.writeUInt16LE(0x4066);header.writeUInt32LE(6,2);children.push(header);}
      payload=Buffer.concat(children);
    }else if (node.children) payload = Buffer.concat(node.children.map(write));
    else if(doorParameter&&node.id===doorParameter.nodeId){
      found=true;payload=editDoor(node.payload,doorParameter.key,value);
    }
    else if (humanParameter && node.id === humanParameter.nodeId) {
      const entry=humanParameter;
      if(typeof value!=='number'||!Number.isFinite(value)||(entry.kind==='byte'? !Number.isInteger(value)||value<0||value>255 : !Number.isFinite(Math.fround(value))))throw new Error('Scene: neplatná hodnota parametru postavy.');
      found=true;
      if(Object.is(value,entry.value))return node.raw;
      payload=Buffer.from(node.payload);
      if(entry.kind==='byte')payload[entry.offset]=value;else payload.writeFloatLE(value,entry.offset);
    }
    else if (node.id === id && actorScripts.has(id)) {
      const entry=actorScripts.get(id);
      if(!value || value.name!==entry.value.name || typeof value.code!=='string')throw new Error('Scene: změňte pouze kód skriptu aktéra; název patří jeho frame.');
      found=true;
      if(value.code===entry.value.code)return node.raw;
      const layout=actorScriptLayout(entry.actorKind,node.payload),code=encode(value.code),header=Buffer.from(node.payload.subarray(0,layout.codeStart));header.writeUInt32LE(code.length,layout.lengthOffset);
      payload=Buffer.concat([header,code,node.payload.subarray(layout.codeStart+layout.length)]);
    } else if (node.id === id && fields.has(node.type)) {
      found = true;
      const kind = node.type===0x4068 && node.payload.length===8 ? 'vec2' : fields.get(node.type)[1];
      if (JSON.stringify(decodeField(kind, node.payload)) === JSON.stringify(value)) return node.raw;
      payload = encodeField(kind, value, node.payload);
    } else return node.raw;
    if (payload.equals(node.payload)) return node.raw;
    const header = Buffer.from(node.raw.subarray(0, 6)); header.writeUInt32LE(payload.length + 6, 2);
    return Buffer.concat([header, payload]);
  }
  const result = Buffer.concat(roots.map(write));
  if (!found) throw new Error('Scene: vlastnost neexistuje nebo není podporovaná.');
  inspectScene(result);
  return result;
}

// Existing opaque actor data, scripts, geometry overrides and sibling chunks
// remain intact. New human actors use the verified C_human v6 layout.
export function changeSceneObject(source, operation, geometryNames = [], geometryFrames = []) {
  if (!operation || !['add-model', 'add-human', 'add-car', 'add-light', 'add-sound', 'attach-door', 'duplicate', 'delete'].includes(operation.kind)) throw new Error('Scene: neplatná operace s objektem.');
  const scene = inspectScene(source), roots = tree(source), all = [];
  function collect(nodes) { for (const node of nodes) { all.push(node); if (node.children) collect(node.children); } }
  collect(roots);
  const key = name => name.normalize('NFC').toLowerCase();
  const chunk = (type, payload) => { const header = Buffer.alloc(6); header.writeUInt16LE(type); header.writeUInt32LE(payload.length + 6, 2); return Buffer.concat([header, payload]); };
  const containers = all.filter(n => n.type === 0x4000);
  if (containers.length !== 1) throw new Error('Scene: scéna nemá jednoznačný seznam objektů.');
  const container = containers[0]; let added, removed, actorAdded, actorContainer;
  if (!['delete','attach-door'].includes(operation.kind)) {
    const name = operation.name;
    if (typeof name !== 'string' || name !== name.trim() || !/^[a-zA-Z0-9_#][a-zA-Z0-9_# -]{0,62}$/.test(name)) throw new Error('Název objektu: 1–63 znaků, písmena bez diakritiky, číslice, mezera, #, pomlčka nebo podtržítko.');
    const used = [...scene.objects.map(o => o.name), ...geometryNames, ...scene.entries.filter(e => e.label === 'Název aktéra').map(e => e.value), 'Primary sector', 'Backdrop sector'];
    if (used.some(value => key(value) === key(name))) throw new Error('Scene: název objektu již existuje ve scéně nebo geometrii.');
  }
  if(operation.kind==='add-light'){
    const {name,position,rotation}=operation, sectors=sceneSectors(scene.objects,geometryFrames), p=validateNewLight(operation.parameters,sectors);
    if(!Array.isArray(rotation)||rotation.length!==4||rotation.some(n=>typeof n!=='number'||!Number.isFinite(n))||Math.abs(Math.hypot(...rotation)-1)>.0001)throw new Error('Scene: rotace musí být jednotkový quaternion WXYZ.');
    const numeric=(type,kind,value,size)=>chunk(type,encodeField(kind,value,Buffer.alloc(size))), text=(type,value)=>chunk(type,Buffer.concat([encode(value),Buffer.from([0])]));
    added=chunk(0x4010,Buffer.concat([
      numeric(0x4011,'uint',2,4),text(0x10,name),numeric(0x20,'vec3',position,12),numeric(0x2c,'vec3',position,12),numeric(0x22,'quat',rotation,16),numeric(0x2d,'vec3',[1,1,1],12),
      chunk(0x4020,text(0x10,'Primary sector')),
      chunk(0x4040,Buffer.concat([numeric(0x4041,'uint',p.type,4),numeric(0x26,'vec3',p.color,12),numeric(0x4042,'float',p.power,4),numeric(0x4043,'vec2',p.cone,8),numeric(0x4044,'vec2',p.range,8),numeric(0x4045,'uint',p.mode,4),...p.sectors.map(name=>text(0x4046,name))]))
    ]));
  }else if(operation.kind==='add-sound'){
    const {name,position,rotation}=operation, p=validateNewSound(operation.parameters,sceneSectors(scene.objects,geometryFrames));
    if(!Array.isArray(position)||position.length!==3||!Array.from(position).every(n=>typeof n==='number'&&Number.isFinite(n)&&Number.isFinite(Math.fround(n))))throw new Error('Scene: neplatná číselná hodnota pozice zvuku.');
    if(!Array.isArray(rotation)||rotation.length!==4||!Array.from(rotation).every(n=>typeof n==='number'&&Number.isFinite(n))||Math.abs(Math.hypot(...rotation)-1)>.0001)throw new Error('Scene: rotace musí být jednotkový quaternion WXYZ.');
    const numeric=(type,kind,value,size)=>chunk(type,encodeField(kind,value,Buffer.alloc(size))), text=(type,value)=>chunk(type,Buffer.concat([encode(value),Buffer.from([0])]));
    added=chunk(0x4010,Buffer.concat([
      numeric(0x4011,'uint',4,4),text(0x10,name),numeric(0x20,'vec3',position,12),numeric(0x2c,'vec3',position,12),numeric(0x22,'quat',rotation,16),numeric(0x2d,'vec3',[1,1,1],12),
      chunk(0x4020,text(0x10,'Primary sector')),
      chunk(0x4060,Buffer.concat([text(0x10,p.file),numeric(0x4061,'uint',p.type,4),numeric(0x4062,'float',p.volume,4),numeric(0x4063,'float',p.outVolume,4),numeric(0x4064,'vec2',p.cone,8),numeric(0x4068,'vec4',p.range,16),...(p.loop?[chunk(0x4066,Buffer.alloc(0))]:[]),...p.sectors.map(name=>text(0xb200,name))]))
    ]));
  }else if(operation.kind==='attach-door'){
    const target=operation.target;
    if(typeof target!=='string'||!target||target.includes('\0')||encode(target).length>255)throw new Error('Dveře: neplatný odkaz na frame.');
    const objects=scene.objects.filter(object=>key(object.name)===key(target)),geometry=geometryFrames.filter(frame=>key(frame.name)===key(target));
    if(objects.length>1||geometry.length>1||!objects.length&&!geometry.length)throw new Error('Dveře: vybraný frame chybí nebo není jednoznačný.');
    if(scene.entries.some(e=>e.label==='Název aktéra'&&key(e.value)===key(target)))throw new Error('Dveře: frame už má navázaného aktéra.');
    if(geometry.length?geometry[0].type!==1||![0,1].includes(geometry[0].visual):objects[0].frameType!==9||!objects[0].model)throw new Error('Dveře: vyberte statický vizuální díl nebo model.');
    const actors=all.filter(node=>node.type===0xae20);
    if(actors.length>1||roots.length!==1)throw new Error('Scene: nejednoznačný seznam aktérů.');
    actorContainer=actors[0];const name=geometry[0]?.name??objects[0].name,type=Buffer.alloc(4);type.writeUInt32LE(6);
    actorAdded=chunk(0xae21,Buffer.concat([chunk(0xae23,Buffer.concat([encode(name),Buffer.from([0])])),chunk(0xae22,type),chunk(0xae24,createDoor(operation.parameters))]));
  }else if (['add-model','add-human','add-car'].includes(operation.kind)) {
    const { name, model, position, rotation, scale } = operation;
    if (typeof model !== 'string' || !/\.i3d$/i.test(model) || model.length > 255 || /[\x00-\x1f/\\:*?"<>|]/.test(model)) throw new Error('Scene: neplatná cesta modelu.');
    if (!Array.isArray(rotation) || rotation.length !== 4 || rotation.some(v => typeof v !== 'number' || !Number.isFinite(v)) || Math.abs(Math.hypot(...rotation) - 1) > .0001) throw new Error('Scene: rotace musí být jednotkový quaternion WXYZ.');
    if (!Array.isArray(scale) || scale.some(v => typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) < .000001)) throw new Error('Scene: měřítko nesmí být nulové.');
    const numeric = (type, kind, value, size) => chunk(type, encodeField(kind, value, Buffer.alloc(size)));
    added = chunk(0x4010, Buffer.concat([
      numeric(0x4011, 'uint', 9, 4), chunk(0x10, Buffer.concat([encode(name), Buffer.from([0])])),
      numeric(0x20, 'vec3', position, 12), numeric(0x2c, 'vec3', position, 12),
      numeric(0x22, 'quat', rotation, 16), numeric(0x2d, 'vec3', scale, 12),
      chunk(0x4020, chunk(0x10, Buffer.from('Primary sector\0'))), chunk(0x2012, Buffer.concat([encode(model), Buffer.from([0])]))
    ]));
    if(operation.kind==='add-car'&&(!Array.isArray(scale)||scale.length!==3||scale.some(n=>n!==1)))throw new Error('Scene: auto používá měřítko 1, aby odpovídalo fyzice.');
    if(['add-human','add-car'].includes(operation.kind)) {
      const actors=all.filter(node=>node.type===0xae20), sceneRoots=roots.filter(node=>node.type===0x4c53);
      if(actors.length>1||sceneRoots.length!==1)throw new Error('Scene: nejednoznačný seznam aktérů.');
      actorContainer=actors[0];
      if(operation.kind==='add-car'){
        const type=Buffer.alloc(4);type.writeUInt32LE(4);
        // A new vehicle uses Init(frame) + GameInit/model CARINIT tables.
        // AE24 is an optional saved state, not a mandatory initialiser.
        actorAdded=chunk(0xae21,Buffer.concat([chunk(0xae23,Buffer.concat([encode(name),Buffer.from([0])])),chunk(0xae22,type)]));
      }else{
      const parameters=operation.parameters;
      if(!parameters||typeof parameters!=='object'||Array.isArray(parameters)||Object.keys(parameters).some(key=>!humanFields.some(field=>field.key===key)))throw new Error('Scene: neplatné parametry nové postavy.');
      const data=Buffer.alloc(83);data[0]=6;data[73]=data[74]=1;
      for(const field of humanFields){
        const value=Object.hasOwn(parameters,field.key)?parameters[field.key]:field.default;
        if(typeof value!=='number'||!Number.isFinite(value)||(field.kind==='byte'?!Number.isInteger(value)||value<0||value>255:!Number.isFinite(Math.fround(value))))throw new Error('Scene: neplatný parametr nové postavy.');
        if(field.kind==='byte')data[field.offset]=value;else data.writeFloatLE(value,field.offset);
      }
      const code=encode(operation.code);data.writeUInt32LE(code.length,79);
      const type=Buffer.alloc(4);type.writeUInt32LE(27);
      // The mission loader binds AE23 first, creates the actor at AE22, then
      // loads AE24. It does not revisit a type encountered before the name.
      actorAdded=chunk(0xae21,Buffer.concat([chunk(0xae23,Buffer.concat([encode(name),Buffer.from([0])])),chunk(0xae22,type),chunk(0xae24,Buffer.concat([data,code]))]));
      }
    }
  } else {
    const object = scene.objects.find(o => o.id === operation.id);
    if (!object || ![2,4,6,9].includes(object.frameType) || object.actorBound || geometryNames.some(name => key(name) === key(object.name))) throw new Error('Scene: lze upravit pouze samostatný model, světlo, zvuk nebo pomocný bod bez navázaného aktéra a původní geometrie.');
    if (scene.objects.filter(o => key(o.name) === key(object.name)).length !== 1) throw new Error('Scene: název vybraného objektu není jednoznačný.');
    const node = container.children.find(n => n.id === object.id);
    if (!node) throw new Error('Scene: objekt není v hlavním seznamu.');
    if (operation.kind === 'duplicate') {
      // Rename a byte-preserving copy; its local transform and parent stay intact.
      const renamed = tree(editScene(source, object.fields.name, operation.name));
      function find(nodes) { for (const n of nodes) { if (n.id === object.id) return n; const found = n.children && find(n.children); if (found) return found; } }
      added = find(renamed).raw;
    } else {
      if (scene.objects.some(o => o.parent && key(o.parent) === key(object.name))) throw new Error('Scene: objekt má potomky. Nejprve upravte jejich rodiče.');
      if (scene.entries.some(e => e.kind === 'script' && e.value.code.toLowerCase().includes(object.name.toLowerCase()))) throw new Error('Scene: na objekt odkazuje skript. Nejprve upravte jeho odkaz.');
      removed = node;
    }
  }
  function write(node) {
    if (!node.children) return node.raw;
    const children = node.children.filter(child => child !== removed).map(write);
    if (node === container && added) children.push(added);
    if (actorAdded && node === actorContainer) children.push(actorAdded);
    if (actorAdded && !actorContainer && node.type === 0x4c53) children.push(chunk(0xae20,actorAdded));
    const payload = Buffer.concat(children);
    return payload.equals(node.payload) ? node.raw : chunk(node.type, payload);
  }
  const result = Buffer.concat(roots.map(write)); inspectScene(result); return result;
}
