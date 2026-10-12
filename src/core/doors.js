import iconv from 'iconv-lite';
import { doorFields as fields } from '../shared/door-parameters.js';

// C_door saved configuration v8; version and two auxiliary flags stay opaque.
export function inspectDoor(data) {
  if(!data||data.length<70||data.readUInt32LE(0)!==8)return [];
  const result=[];
  for(const field of fields){let value;
    if(field.kind==='boolean'){if(data[field.offset]>1)return [];value=Boolean(data[field.offset]);}
    else if(field.kind==='float'){value=data.readFloatLE(field.offset);if(!Number.isFinite(value))return [];value*=field.factor;}
    else {const raw=data.subarray(field.offset,field.offset+16),end=raw.indexOf(0);if(end<0)return [];value=iconv.decode(raw.subarray(0,end),'windows-1250');}
    result.push({...field,value,bytes:field.kind==='boolean'?1:field.kind==='float'?4:16});
  }
  return result;
}
export function editDoor(source,key,value) {
  const field=inspectDoor(source).find(field=>field.key===key);
  if(!field)throw new Error('Dveře: nepodporovaný formát nebo vlastnost.');
  const bytes=Buffer.from(source);
  if(field.kind==='boolean'){
    if(typeof value!=='boolean')throw new Error('Dveře: příznak musí být ano nebo ne.');
    bytes[field.offset]=Number(value);
  }else if(field.kind==='float'){
    if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>(field.max??Infinity)||!Number.isFinite(Math.fround(value/field.factor)))throw new Error('Dveře: neplatný úhel nebo rychlost.');
    bytes.writeFloatLE(value/field.factor,field.offset);
  }else{
    if(typeof value!=='string'||/[\x00-\x1f]/.test(value))throw new Error('Dveře: neplatný název zvuku.');
    const encoded=iconv.encode(value,'windows-1250');
    if(encoded.length>15||iconv.decode(encoded,'windows-1250')!==value)throw new Error('Dveře: název zvuku musí mít nejvýše 15 bajtů Windows-1250.');
    encoded.copy(bytes,field.offset);bytes[field.offset+encoded.length]=0;
  }
  return Object.is(value,field.value)?Buffer.from(source):bytes;
}
export function createDoor(parameters = {}) {
  if(!parameters||typeof parameters!=='object'||Array.isArray(parameters)||Object.keys(parameters).some(key=>!fields.some(field=>field.key===key)))throw new Error('Dveře: neplatné parametry nového aktéra.');
  let data=Buffer.alloc(70);data.writeUInt32LE(8);
  for(const field of fields)data=editDoor(data,field.key,Object.hasOwn(parameters,field.key)?parameters[field.key]:field.default);
  return data;
}
