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
    offset+=24+nodeCount*4;const payload=offset;offset+=OWN_SIZE.get(own);
    for(let i=0;i<specialCount;i++){const type=(packed>>>(4*(i+1)))&15;if(!SPECIAL_SIZE.has(type))throw new Error('Segments: neznámý typ doplňkové geometrie.');offset+=SPECIAL_SIZE.get(type);}
    if(offset>bytes.length)throw new Error('Segments: geometrie překračuje soubor.');
    records.push({index,start,payload,end:offset,nodes});
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
