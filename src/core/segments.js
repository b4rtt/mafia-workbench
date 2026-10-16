const OWN_SIZE = new Map([[0,0],[1,40],[2,52],[4,16],[8,0]]);
const SPECIAL_SIZE = new Map([[1,56],[2,56],[4,24],[8,44]]);

export function parseSegments(source, pointCount) {
  if(!Number.isInteger(pointCount)||pointCount<0||pointCount>65536)throw new Error('Segments: neplatný počet navigačních bodů.');
  const bytes=Buffer.from(source);
  if(bytes.length<20)throw new Error('Segments: neplatná hlavička.');
  const magic=bytes.subarray(0,16).toString('ascii').split('\0')[0].toUpperCase();
  if(magic==='AISEG-V1.0-JIPO')return {active:false,records:[]}; // Rejected by the PC loader; preserve as opaque data.
  if(magic!=='AISEG-V1.1-JIPO')throw new Error('Segments: nepodporovaná verze.');
  const count=bytes.readUInt32LE(16),records=[];let offset=20;
  if(count>100000)throw new Error('Segments: příliš mnoho záznamů.');
  for(let index=0;index<count;index++){
    const start=offset;if(offset+24>bytes.length)throw new Error('Segments: neúplný záznam.');
    const packed=bytes.readUInt32LE(offset),own=packed&15,specialCount=packed>>>28,nodeCount=bytes.readUInt32LE(offset+20);
    if(!OWN_SIZE.has(own)||specialCount>6||nodeCount>65536||offset+24+nodeCount*4>bytes.length)throw new Error('Segments: neplatné typy nebo délka záznamu.');
    const nodes=[];
    for(let i=0;i<nodeCount;i++){const node=bytes.readUInt32LE(offset+24+i*4);if(node>=pointCount||(i&&node<nodes[i-1]))throw new Error('Segments: neplatné nebo neseřazené odkazy na body.');nodes.push(node);}
    offset+=24+nodeCount*4;const payload=offset;offset+=OWN_SIZE.get(own);const specials=[];
    for(let i=0;i<specialCount;i++){const type=(packed>>>(4*(i+1)))&15;if(!SPECIAL_SIZE.has(type))throw new Error('Segments: neznámý typ doplňkové geometrie.');specials.push({index:i,type,start:offset,end:offset+SPECIAL_SIZE.get(type)});offset+=SPECIAL_SIZE.get(type);}
    if(offset>bytes.length)throw new Error('Segments: geometrie překračuje soubor.');
    records.push({index,start,payload,end:offset,nodes,own,specials});
  }
  if(offset!==bytes.length)throw new Error('Segments: neočekávaná data za záznamy.');
  return {active:true,records};
}

export function remapSegments(source, mapping, pointCount) {
  if(!Array.isArray(mapping)||mapping.length>65536)throw new Error('Segments: neplatné přemapování bodů.');
  const parsed=parseSegments(source,mapping.length),bytes=Buffer.from(source);
  if(!parsed.active)return bytes;
  const used=new Set();
  for(const index of mapping){if(!Number.isInteger(index)||index< -1||index>=pointCount||(index>=0&&used.has(index)))throw new Error('Segments: neplatné přemapování bodů.');if(index>=0)used.add(index);}
  const parts=[bytes.subarray(0,20)];
  for(const record of parsed.records){
    const nodes=record.nodes.map(index=>mapping[index]).filter(index=>index!==-1).sort((a,b)=>a-b),header=Buffer.from(bytes.subarray(record.start,record.start+24)),indices=Buffer.alloc(nodes.length*4);
    header.writeUInt32LE(nodes.length,20);nodes.forEach((node,i)=>indices.writeUInt32LE(node,i*4));parts.push(header,indices,bytes.subarray(record.payload,record.end));
  }
  const result=Buffer.concat(parts);parseSegments(result,pointCount);return result;
}

// Only the byte-proven PC cover-corner fields are editable. Other own/special
// payloads stay opaque, including the three unread dwords of each cover corner.
const cornerFields={position:[0,3],dirA:[12,2],dirB:[20,2],dirC:[28,2],radius:[36,1],tolerance:[40,1]};
function corner(bytes,start){
  return Object.fromEntries(Object.entries(cornerFields).map(([key,[offset,count]])=>[key,count===1?bytes.readFloatLE(start+offset):Array.from({length:count},(_,i)=>bytes.readFloatLE(start+offset+i*4))]));
}
export function inspectSegments(source,pointCount){
  const bytes=Buffer.from(source),parsed=parseSegments(bytes,pointCount);
  return {active:parsed.active,records:parsed.records.map(record=>({index:record.index,own:record.own,nodes:record.nodes,specials:record.specials.map(special=>({index:special.index,type:special.type,...(special.type===2?corner(bytes,special.start):{})}))}))};
}
export function emptySegments(){const bytes=Buffer.alloc(20);bytes.write('AISEG-V1.1-JIPO');return bytes;}
function nodeList(nodes,pointCount){
  if(!Array.isArray(nodes)||nodes.length>pointCount||nodes.some(n=>!Number.isInteger(n)||n<0||n>=pointCount)||new Set(nodes).size!==nodes.length)throw new Error('Segments: vyberte platné neopakované pořadové indexy navigačních bodů.');
  return [...nodes].sort((a,b)=>a-b);
}
function writeCorner(source,values){
  if(!values||typeof values!=='object'||Array.isArray(values)||Object.keys(values).some(key=>!Object.hasOwn(cornerFields,key)))throw new Error('Segments: neplatné vlastnosti krycího rohu.');
  const result=Buffer.from(source);
  for(const [key,value] of Object.entries(values)){
    const [offset,count]=cornerFields[key],numbers=count===1?[value]:value;
    if(!Array.isArray(numbers)||numbers.length!==count||numbers.some(n=>typeof n!=='number'||!Number.isFinite(n)||!Number.isFinite(Math.fround(n))))throw new Error('Segments: vlastnost musí obsahovat konečná čísla float32.');
    if(key==='radius'&&Math.fround(value)<=0||key==='tolerance'&&(value<0||value>Math.fround(Math.PI))||key.startsWith('dir')&&Math.hypot(...numbers)<1e-6)throw new Error('Segments: poloměr musí být kladný, směr nenulový a úhlová tolerance 0 až π radiánů.');
    numbers.forEach((n,i)=>{if(n!==result.readFloatLE(offset+i*4))result.writeFloatLE(n,offset+i*4);});
  }
  return result;
}
export function changeSegments(source,pointCount,request){
  const bytes=Buffer.from(source),parsed=parseSegments(bytes,pointCount);
  if(!parsed.active)throw new Error('Segments: starou verzi 1.0 PC hra nečte; její převod není podporovaný.');
  if(!request||!['add-cover','update','delete-cover'].includes(request.action)||Object.keys(request).some(key=>!['action','index','special','nodes','values'].includes(key)))throw new Error('Segments: neplatná operace.');
  const parts=parsed.records.map(r=>Buffer.from(bytes.subarray(r.start,r.end)));let index=request.index;
  if(request.action==='add-cover'){
    if(parsed.records.length>=100000)throw new Error('Segments: příliš mnoho záznamů.');
    if(!request.values||Object.keys(cornerFields).some(key=>!Object.hasOwn(request.values,key)))throw new Error('Segments: vyplňte všechny vlastnosti nového krycího rohu.');
    const payload=writeCorner(Buffer.alloc(56),request.values),nodes=nodeList(request.nodes??[],pointCount),header=Buffer.alloc(24+nodes.length*4);
    header.writeUInt32LE(0x10000020);payload.copy(header,4,36,40);payload.copy(header,8,0,12);header.writeUInt32LE(nodes.length,20);nodes.forEach((n,i)=>header.writeUInt32LE(n,24+i*4));
    index=parts.length;parts.push(Buffer.concat([header,payload]));
  }else{
    if(!Number.isInteger(index)||!parsed.records[index])throw new Error('Segments: neplatný segment.');
    const record=parsed.records[index];let body=Buffer.from(bytes.subarray(record.payload,record.end)),packed=bytes.readUInt32LE(record.start);
    if(request.action==='delete-cover'||request.values!==undefined){
      const special=record.specials[request.special];if(!Number.isInteger(request.special)||special?.type!==2)throw new Error('Segments: vyberte krycí roh typu 2.');
      const offset=special.start-record.payload;
      if(request.action==='delete-cover'){
        body=Buffer.concat([body.subarray(0,offset),body.subarray(offset+56)]);
        packed=record.own|((record.specials.length-1)<<28);record.specials.filter(s=>s.index!==special.index).forEach((s,i)=>packed|=s.type<<(4*(i+1)));
      }else writeCorner(body.subarray(offset,offset+56),request.values).copy(body,offset);
    }
    const nodes=request.nodes===undefined?record.nodes:nodeList(request.nodes,pointCount),header=Buffer.from(bytes.subarray(record.start,record.start+24)),indices=Buffer.alloc(nodes.length*4);
    header.writeUInt32LE(packed>>>0);header.writeUInt32LE(nodes.length,20);nodes.forEach((n,i)=>indices.writeUInt32LE(n,i*4));
    if(!packed&&request.action==='delete-cover'){parts.splice(index,1);index=Math.min(index,parts.length-1);}else parts[index]=Buffer.concat([header,indices,body]);
  }
  const head=Buffer.from(bytes.subarray(0,20));head.writeUInt32LE(parts.length,16);const data=Buffer.concat([head,...parts]);parseSegments(data,pointCount);return {data,index};
}
