import iconv from 'iconv-lite';

const fail = message => { throw new Error(`Doprava a chodci: ${message}`); };
const same = (a,b) => Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(key => Array.isArray(a[key]) ? a[key].length===b[key]?.length && a[key].every((value,i)=>Object.is(value,b[key][i])) : Object.is(a[key],b[key]));
function layout(kind,source) {
  if(!source || ![12,18].includes(kind))return null;
  const cars=kind===12,header=cars?24:33,countOffset=cars?20:29;
  if(source.length<header || source.readUInt32LE(0)!==(cars?5:1))return null;
  const count=source.readUInt32LE(countOffset);
  if(count>10000 || source.length!==header+count*(cars?32:21))return null;
  const models=[];
  for(let i=0;i<count;i++){
    const start=header+i*(cars?32:17),name=source.subarray(start,start+(cars?20:17)),zero=name.indexOf(0);
    if(zero<1)return null;
    const model=iconv.decode(name.subarray(0,zero),'windows-1250');
    if(cars){const weight=source.readFloatLE(start+20);if(!Number.isFinite(weight))return null;models.push({sourceIndex:i,model,weight,colors:source.readUInt32LE(start+24),flags:Array.from(source.subarray(start+28,start+32))});}
    else models.push({sourceIndex:i,model,capacity:source.readUInt32LE(header+count*17+i*4)});
  }
  return {cars,header,countOffset,value:{budget:source.readUInt32LE(cars?16:25),models}};
}
export function inspectPopulation(kind,source) { return layout(kind,source)?.value ?? null; }
export function editPopulation(kind,source,value) {
  const info=layout(kind,source);if(!info)fail('nepodporovaný formát generátoru.');
  if(!value || typeof value!=='object' || Object.keys(value).length!==2 || !Object.hasOwn(value,'budget') || !Array.isArray(value.models) || value.models.length>10000)fail('neplatné nastavení.');
  const {cars,header,countOffset}=info,original=info.value;
  if(!Number.isInteger(value.budget) || value.budget<0 || value.budget>0xffffffff)fail('neplatná hustota.');
  if(value.budget!==original.budget && value.budget>100)fail('hustota musí být 0–100.');
  const used=new Set(),records=[],counts=[];
  for(const row of value.models){
    const keys=cars?['sourceIndex','model','weight','colors','flags']:['sourceIndex','model','capacity'];
    if(!row || typeof row!=='object' || Object.keys(row).length!==keys.length || keys.some(key=>!Object.hasOwn(row,key)))fail('neplatná položka modelu.');
    if(row.sourceIndex!==null && (!Number.isInteger(row.sourceIndex)||row.sourceIndex<0||row.sourceIndex>=original.models.length||used.has(row.sourceIndex)))fail('neplatný nebo duplicitní původní záznam.');
    if(row.sourceIndex!==null)used.add(row.sourceIndex);
    const before=row.sourceIndex===null?null:original.models[row.sourceIndex],unchanged=before&&same(row,before);
    if(typeof row.model!=='string' || !row.model || /[\/\\\0]/.test(row.model))fail('model musí být název bez cesty.');
    const name=iconv.encode(row.model,'windows-1250'),nameSize=cars?20:17;
    if(name.length>=nameSize || iconv.decode(name,'windows-1250')!==row.model)fail(`název modelu má nejvýše ${nameSize-1} bajtů Windows-1250.`);
    if(cars){
      if(typeof row.weight!=='number'||!Number.isFinite(row.weight)||!Number.isFinite(Math.fround(row.weight))||(!unchanged&&row.weight<0))fail('váha musí být konečné nezáporné číslo.');
      if(!Number.isInteger(row.colors)||row.colors<0||row.colors>0xffffffff||(!Object.is(row.colors,before?.colors)&&(row.colors<1||row.colors>10)))fail('limit barev musí být 1–10.');
      if(!Array.isArray(row.flags)||row.flags.length!==4||row.flags.some(v=>!Number.isInteger(v)||v<0||v>255))fail('příznaky musí být čtyři bajty 0–255.');
    }else if(!Number.isInteger(row.capacity)||row.capacity<0||row.capacity>0xffffffff||(!Object.is(row.capacity,before?.capacity)&&row.capacity>1000))fail('kapacita modelu musí být 0–1000.');
    const oldStart=before?header+row.sourceIndex*(cars?32:17):0,record=before?Buffer.from(source.subarray(oldStart,oldStart+nameSize+(cars?12:0))):Buffer.alloc(nameSize+(cars?12:0));
    if(row.model!==before?.model){record.fill(0,0,nameSize);name.copy(record);}
    if(cars){if(value.budget===0)record.writeFloatLE(0,20);else if(!Object.is(row.weight,before?.weight))record.writeFloatLE(row.weight,20);if(row.colors!==before?.colors)record.writeUInt32LE(row.colors,24);row.flags.forEach((v,i)=>record[28+i]=v);}
    else{const count=Buffer.alloc(4);count.writeUInt32LE(value.budget===0?0:row.capacity);counts.push(count);}
    records.push(record);
  }
  if(!cars && value.models.reduce((total,row)=>total+row.capacity,0)>10000 && !value.models.every((row,i)=>same(row,original.models[i]??{})))fail('součet kapacit je nejvýše 10 000.');
  const prefix=Buffer.from(source.subarray(0,header));prefix.writeUInt32LE(value.budget,cars?16:25);prefix.writeUInt32LE(value.models.length,countOffset);
  // Preserve a literal no-op, including legacy zero budgets with nonzero slots.
  if(value.budget===original.budget && value.models.length===original.models.length && value.models.every((row,i)=>same(row,original.models[i])))return Buffer.from(source);
  return Buffer.concat([prefix,...records,...counts]);
}
