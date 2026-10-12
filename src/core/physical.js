import {physicalFields} from '../shared/physical-parameters.js';

export function inspectPhysical(data) {
  if(!data||data.length<31||data[0]!==2)return [];
  const result=[];
  for(const field of physicalFields){
    let value;
    if(field.kind==='boolean'){if(data[field.offset]>1)return [];value=Boolean(data[field.offset]);}
    else if(field.kind==='float'){value=data.readFloatLE(field.offset);if(!Number.isFinite(value))return [];}
    else value=data.readInt32LE(field.offset);
    result.push({...field,value,bytes:field.kind==='boolean'?1:4});
  }
  return result;
}

export function editPhysical(source,key,value) {
  const field=inspectPhysical(source).find(field=>field.key===key);
  if(!field)throw new Error('Fyzikální předmět: nepodporovaný formát nebo vlastnost.');
  if(field.kind==='boolean' ? typeof value!=='boolean' : typeof value!=='number'||!Number.isFinite(value))throw new Error('Fyzikální předmět: neplatná hodnota.');
  if(Object.is(value,field.value))return Buffer.from(source);
  if(field.kind!=='boolean'&&(value<field.min||value>(field.max??Infinity)||(field.kind==='int'?!Number.isInteger(value):!Number.isFinite(Math.fround(value)))))throw new Error('Fyzikální předmět: hodnota je mimo podporovaný rozsah.');
  const bytes=Buffer.from(source);
  if(field.kind==='boolean')bytes[field.offset]=Number(value);
  else if(field.kind==='float')bytes.writeFloatLE(value,field.offset);
  else bytes.writeInt32LE(value,field.offset);
  return bytes;
}
