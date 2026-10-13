import { parseVehicleTable } from './vehicles.js';
import { vehicleFields } from '../shared/vehicle-parameters.js';

const fail=message=>{throw new Error(`Auta: ${message}`);};
export function inspectVehicleTable(source) {
  const bytes=Buffer.from(source),table=parseVehicleTable(bytes);
  const records=table.entries.map((record,index)=>{
    let cursor=record.offset+40;const levels=[];
    for(let level=0;level<record.levels;level++){
      const size=bytes.readUInt32LE(cursor);cursor+=4;
      const entries=size===0x1121?vehicleFields.map(field=>{
        const value=bytes.readFloatLE(cursor+field.offset);
        return {...field,id:`${index}/${level}/${field.key}`,kind:'float',offset:cursor+field.offset,value:Number.isFinite(value)?value:null,readOnly:!Number.isFinite(value)};
      }):[];
      levels.push({index:level,size,entries,warning:size!==0x1121?'Nepodporované rozložení této úrovně; data zůstávají zachovaná.':entries.some(entry=>entry.readOnly)?'Některé původní hodnoty nejsou konečná čísla; jsou pouze ke čtení.':null});cursor+=size;
    }
    return {index,name:record.name,levels};
  });
  return {records};
}

export function editVehicleTable(source,changes) {
  if(!Array.isArray(changes)||changes.length>10000)fail('neplatný seznam změn.');
  const before=Buffer.from(source),result=Buffer.from(before),table=inspectVehicleTable(before);
  const fields=new Map(table.records.flatMap(record=>record.levels.flatMap(level=>level.entries)).map(entry=>[entry.id,entry]));
  const seen=new Set(),changed=new Map();
  for(const change of changes){
    if(!change||typeof change.id!=='string'||!fields.has(change.id))fail('neznámý parametr vozidla.');
    if(seen.has(change.id))fail('opakovaná změna parametru.');seen.add(change.id);
    const field=fields.get(change.id),value=change.value;
    if(field.readOnly)fail('původní neplatný parametr je pouze ke čtení.');
    if(typeof value!=='number'||!Number.isFinite(value))fail('hodnota musí být konečné float32 číslo.');
    const rounded=Math.fround(value);
    if(!Number.isFinite(rounded)||value!==0&&rounded===0)fail('hodnota není reprezentovatelná jako float32.');
    if(Object.is(value,field.value))continue;
    if(rounded<field.min||field.max!==undefined&&rounded>field.max||field.positive&&rounded<=0||field.integer&&!Number.isInteger(value))fail(`neplatná hodnota: ${field.label}.`);
    result.writeFloatLE(value,field.offset);
    const level=change.id.split('/').slice(0,2).join('/'),keys=changed.get(level)??new Set();keys.add(field.key);changed.set(level,keys);
  }
  for(const [level,keys] of changed){
    const value=key=>result.readFloatLE(fields.get(`${level}/${key}`).offset);
    if(['redline','maxRPM','idleRPM','bandLowRPM','bandHighRPM'].some(key=>keys.has(key))){
      if(!(value('idleRPM')<=value('bandLowRPM')&&value('bandLowRPM')<=value('bandHighRPM')&&value('bandHighRPM')<value('redline')&&value('redline')<=value('maxRPM')))fail('otáčky musí splnit volnoběh ≤ začátek pásma ≤ konec pásma < červené pole ≤ maximum.');
    }
    if(['shiftLowRPM','shiftHighRPM','firstGearRPM','redline'].some(key=>keys.has(key))){
      if(!(value('shiftLowRPM')<=value('firstGearRPM')&&value('shiftHighRPM')<=value('firstGearRPM')&&value('firstGearRPM')<=value('redline')))fail('meze řazení nesmí překročit mez prvního převodu ani červené pole.');
    }
    if(keys.has('gears')||[...keys].some(key=>/^gear\d+Ratio$/.test(key))){
      const count=value('gears');if(!Number.isInteger(count)||count<1||count>10)fail('neplatný počet převodů.');
      for(let gear=1;gear<=count;gear++)if(!(value(`gear${gear}Ratio`)>0))fail('aktivní převod musí mít kladný poměr.');
    }
  }
  return result;
}
