import iconv from 'iconv-lite';

const key = name => name.normalize('NFC').toLowerCase();
const fail = reason => { throw new Error(`Auta: ${reason}`); };

// PC vehicle database v1. CARINIT level payloads remain opaque here.
export function parseVehicleTable(source) {
  const bytes=Buffer.from(source);let offset=8;
  if(bytes.length<8||bytes.readUInt32LE(0)!==1)fail('nepodporovaná verze vehicles.bin.');
  const count=bytes.readUInt32LE(4);if(count>10000)fail('neplatný počet automobilů.');
  const entries=[],names=new Set();
  for(let i=0;i<count;i++){
    if(offset+40>bytes.length)fail('useknutý záznam automobilu.');
    const length=bytes.readUInt32LE(offset),end=offset+4+length,rawName=bytes.subarray(offset+4,offset+36),zero=rawName.indexOf(0),levels=bytes.readUInt32LE(offset+36);
    if(length<36||end>bytes.length||zero<1||!levels||levels>256)fail('neplatný záznam automobilu.');
    const name=iconv.decode(rawName.subarray(0,zero),'windows-1250');
    if(!/^[a-zA-Z0-9_ -]+$/.test(name)||names.has(key(name)))fail('neplatný nebo nejednoznačný název automobilu.');
    names.add(key(name));let cursor=offset+40;
    for(let j=0;j<levels;j++){
      if(cursor+4>end)fail('useknutá úroveň fyziky.');
      const size=bytes.readUInt32LE(cursor);cursor+=4;
      if(!size||cursor+size>end)fail('neplatná délka úrovně fyziky.');cursor+=size;
    }
    if(cursor!==end)fail('nerozpoznaný konec záznamu automobilu.');
    entries.push({name,levels,offset,length:4+length});offset=end;
  }
  if(offset!==bytes.length)fail('nerozpoznaná koncová data vehicles.bin.');
  return {entries};
}

export function vehicleModelDefinition(table, path) {
  const match=/^models\/([^/\\]+)(\d{2})\.4ds$/i.exec(path);
  if(!match)return null;
  const entry=table.entries.find(entry=>key(entry.name)===key(match[1]));
  return entry?{path,table:entry.name,variant:Number(match[2]),levels:entry.levels}:null;
}

export function validateVehicleModel(model) {
  const names=new Map();for(const mesh of model.meshes){const name=key(mesh.name),list=names.get(name)??[];list.push(mesh);names.set(name,list);}
  for(const name of ['body','seat0','whl0','whr0','whl1','whr1'])if(names.get(name)?.length!==1)fail(`model nemá jednoznačnou část ${name.toUpperCase()}.`);
  if(!model.meshes.some(mesh=>/^bodycol/i.test(mesh.name)))fail('model nemá kolizní části BODYCOL.');
  if(model.meshes.some(mesh=>mesh.joint))fail('model s lidskou kostrou nelze použít jako auto.');
}
