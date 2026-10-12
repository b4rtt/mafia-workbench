import iconv from 'iconv-lite';

// Mafia GifC v5. Array order and relative cell references follow the PC
// collision_load_level loader, including the extra world-space vertices.
const arrays = [
  { name:'triangles', type:0, size:32, countOffset:0x30 },
  { name:'aabbs', type:0x81, size:32, countOffset:0x40 },
  { name:'xtobbs', type:0x80, size:184, countOffset:0x38 },
  { name:'cylinders', type:0x84, size:20, countOffset:0x58 },
  { name:'obbs', type:0x83, size:160, countOffset:0x50 },
  { name:'spheres', type:0x82, size:24, countOffset:0x48 }
];
const fail = message => { throw new Error(`KLZ: ${message}`); };
const pad = n => (4 - n % 4) % 4;
export function parseCollision(source) {
  const bytes=Buffer.from(source), range=(offset,size)=>{if(!Number.isSafeInteger(offset)||!Number.isSafeInteger(size)||offset<0||size<0||offset+size>bytes.length)fail('data překračují soubor.');};
  range(0,24);
  if(bytes.toString('ascii',0,4)!=='GifC'||bytes.readUInt32LE(4)!==5)fail('podporovaná je pouze verze GifC 5.');
  const gridOffset=bytes.readUInt32LE(8),linkCount=bytes.readUInt32LE(12);
  range(24,linkCount*4);if(gridOffset<24+linkCount*4)fail('mřížka překrývá odkazy.');range(gridOffset,104);
  const links=[];
  for(let index=0;index<linkCount;index++){
    const offset=bytes.readUInt32LE(24+index*4);if(offset<24+linkCount*4||offset+5>gridOffset)fail('neplatný odkaz na frame.');
    const end=bytes.indexOf(0,offset+4);if(end<0||end>=gridOffset)fail('neukončený název frame.');
    const size=4+end-(offset+4)+1+pad(end-(offset+4)+1);if(offset+size>gridOffset)fail('neplatný padding odkazu.');
    links.push({index,offset,type:bytes.readUInt32LE(offset),name:iconv.decode(bytes.subarray(offset+4,end),'windows-1250'),raw:bytes.subarray(offset,offset+size)});
  }
  const f=offset=>bytes.readFloatLE(gridOffset+offset),u=offset=>bytes.readUInt32LE(gridOffset+offset);
  const grid={minX:f(0),minZ:f(4),maxX:f(8),maxZ:f(12),cellWidth:f(16),cellLength:f(20),width:u(24),length:u(28),raw:bytes.subarray(gridOffset,gridOffset+104)};
  if([grid.minX,grid.minZ,grid.maxX,grid.maxZ,grid.cellWidth,grid.cellLength].some(n=>!Number.isFinite(n))||grid.cellWidth<=0||grid.cellLength<=0||grid.maxX<=grid.minX||grid.maxZ<=grid.minZ||!grid.width||!grid.length||grid.width*grid.length>10000000)fail('neplatné rozměry mřížky.');
  let offset=gridOffset+104;range(offset,(grid.width+grid.length+2)*4);
  grid.x=Array.from({length:grid.width+1},(_,i)=>bytes.readFloatLE(offset+i*4));offset+=(grid.width+1)*4;
  grid.z=Array.from({length:grid.length+1},(_,i)=>bytes.readFloatLE(offset+i*4));offset+=(grid.length+1)*4;
  if([grid.x,grid.z].some(bounds=>bounds.some((n,i)=>!Number.isFinite(n)||(i>0&&n<=bounds[i-1]))))fail('neplatné hranice buněk.');
  range(offset,4);const separator=bytes.subarray(offset,offset+4);offset+=4;const primitives={};
  for(const spec of arrays){
    const count=u(spec.countOffset);range(offset,count*spec.size);const start=offset,records=[];
    for(let index=0;index<count;index++){
      const recordOffset=offset+index*spec.size,raw=bytes.subarray(recordOffset,recordOffset+spec.size),type=raw[0];
      if(spec.type===0?type>7:type!==spec.type)fail('typ primitiva neodpovídá jeho poli.');
      const record={index,offset:recordOffset,raw,type,sort:raw[1],flags:raw[2],material:raw[3]};
      if(spec.type===0){record.vertices=Array.from({length:3},(_,i)=>({index:raw.readUInt16LE(4+i*4),link:raw.readUInt16LE(6+i*4)}));record.plane=Array.from({length:4},(_,i)=>raw.readFloatLE(16+i*4));}
      else{record.link=raw.readUInt32LE(4);if(record.link>=links.length)fail('primitivum odkazuje mimo framy.');}
      if(spec.name==='aabbs'){record.min=Array.from({length:3},(_,i)=>raw.readFloatLE(8+i*4));record.max=Array.from({length:3},(_,i)=>raw.readFloatLE(20+i*4));}
      records.push(record);
    }
    offset+=count*spec.size;primitives[spec.name]={...spec,count,start,raw:bytes.subarray(start,offset),records};
  }
  const vertexCount=u(0x60);range(offset,vertexCount*12);const extraVertices=bytes.subarray(offset,offset+vertexCount*12);offset+=vertexCount*12;
  for(const record of primitives.triangles.records){const extra=record.vertices[0].link===0x7fff;if(extra?record.vertices.some(v=>v.index>=vertexCount):record.vertices[0].link>=links.length)fail('trojúhelník odkazuje mimo vrcholy nebo framy.');}
  range(offset,4);const cellSeparator=bytes.subarray(offset,offset+4);offset+=4;range(offset,grid.width*grid.length*16);const cells=[],byType=new Map(Object.values(primitives).map(array=>[array.type,array]));
  for(let index=0;index<grid.width*grid.length;index++){
    range(offset,16);const start=offset,count=bytes.readUInt32LE(offset);offset+=16;range(offset,count*5+pad(count));
    const references=[];
    for(let n=0;n<count;n++){
      const packed=bytes.readUInt32LE(offset+n*4),type=packed>>>24,relative=packed&0xffffff,array=byType.get(type);
      if(!array||relative%array.size||relative/array.size>=array.count)fail('buňka odkazuje mimo primitiva.');
      references.push({type,index:relative/array.size,flag:bytes[offset+count*4+n]});
    }
    offset+=count*5+pad(count);cells.push({index,header:bytes.subarray(start,start+16),references,raw:bytes.subarray(start,offset)});
  }
  return {bytes,gridOffset,links,grid,separator,primitives,vertexCount,extraVertices,cellSeparator,cells,tail:bytes.subarray(offset)};
}

export function appendCollisionBoxes(source, boxes) {
  const parsed=parseCollision(source);if(!Array.isArray(boxes)||boxes.length>65536)fail('neplatný seznam boxů.');if(!boxes.length)return Buffer.from(source);
  const {grid}=parsed,links=parsed.links.map(link=>link.raw),records=[],byName=new Map(),nameCounts=new Map();
  for(const link of parsed.links){const key=link.name.normalize('NFC').toLowerCase();byName.set(key,link.index);nameCounts.set(key,(nameCounts.get(key)??0)+1);}
  let minX=grid.minX,minZ=grid.minZ,maxX=grid.maxX,maxZ=grid.maxZ;
  for(const box of boxes){
    if(!box||typeof box.name!=='string'||!box.name||box.name.includes('\0')||box.name.length>255||!Array.isArray(box.min)||!Array.isArray(box.max)||box.min.length!==3||box.max.length!==3||[...box.min,...box.max].some(n=>typeof n!=='number'||!Number.isFinite(Math.fround(n)))||box.min.some((n,i)=>n>=box.max[i]))fail('neplatný název nebo rozměry boxu.');
    const xyzMin=box.min.map(Math.fround),xyzMax=box.max.map(Math.fround);if(xyzMin.some((n,i)=>n>=xyzMax[i]))fail('box je menší než přesnost float32.');
    const nameKey=box.name.normalize('NFC').toLowerCase();let link=byName.get(nameKey);
    if(nameCounts.get(nameKey)>1)fail('nejednoznačný název frame.');
    if(link===undefined){const name=iconv.encode(box.name,'windows-1250');if(iconv.decode(name,'windows-1250')!==box.name)fail('název nelze zapsat ve Windows-1250.');const raw=Buffer.alloc(4+name.length+1+pad(name.length+1));raw.writeUInt32LE(2);name.copy(raw,4);link=links.length;links.push(raw);byName.set(nameKey,link);}
    else if(link<parsed.links.length&&parsed.links[link].type!==2)fail('název již používá povrchový odkaz.');
    const raw=Buffer.alloc(32);raw[0]=0x81;raw.writeUInt32LE(link,4);
    for(const [field,fallback,offset] of [['sort',0,1],['flags',0,2],['material',0,3]]){const value=box[field]??fallback;if(!Number.isInteger(value)||value<0||value>255)fail('neplatný příznak nebo materiál boxu.');raw[offset]=value;}
    xyzMin.forEach((n,i)=>raw.writeFloatLE(n,8+i*4));xyzMax.forEach((n,i)=>raw.writeFloatLE(n,20+i*4));records.push({raw,min:xyzMin,max:xyzMax});
    minX=Math.min(minX,xyzMin[0]);minZ=Math.min(minZ,xyzMin[2]);maxX=Math.max(maxX,xyzMax[0]);maxZ=Math.max(maxZ,xyzMax[2]);
  }
  // Expand by whole existing cells; preserve the existing axes and every old
  // cell's opaque header and flags. Untouched cells retain their exact padding.
  // No existing collider is regenerated.
  const left=Math.ceil((grid.minX-minX)/grid.cellWidth),bottom=Math.ceil((grid.minZ-minZ)/grid.cellLength),right=Math.ceil((maxX-grid.maxX)/grid.cellWidth),top=Math.ceil((maxZ-grid.maxZ)/grid.cellLength);
  const extend=(axis,before,after,step)=>[...Array.from({length:before},(_,i)=>Math.fround(axis[0]-(before-i)*step)),...axis,...Array.from({length:after},(_,i)=>Math.fround(axis.at(-1)+(i+1)*step))];
  const width=grid.width+left+right,length=grid.length+bottom+top;
  if(width*length>1000000||!Number.isSafeInteger(width*length))fail('rozšířená mřížka je příliš velká.');
  const x=extend(grid.x,left,right,grid.cellWidth),z=extend(grid.z,bottom,top,grid.cellLength);
  const lower=(axis,value,upper=false)=>{let lo=0,hi=axis.length;while(lo<hi){const mid=(lo+hi)>>>1;if(axis[mid]<value||(upper&&axis[mid]===value))lo=mid+1;else hi=mid;}return lo;};
  const additions=new Map();let referenceCount=0;
  for(const [i,record] of records.entries()){
    const offset=(parsed.primitives.aabbs.count+i)*32;if(offset>0xffffff)fail('příliš mnoho kolizních boxů.');
    const firstX=Math.max(0,lower(x,record.min[0])-1),lastX=Math.min(width-1,lower(x,record.max[0],true)-1),firstZ=Math.max(0,lower(z,record.min[2])-1),lastZ=Math.min(length-1,lower(z,record.max[2],true)-1);
    referenceCount+=(lastX-firstX+1)*(lastZ-firstZ+1);if(referenceCount>10000000)fail('příliš mnoho nových vazeb buněk.');
    for(let row=firstZ;row<=lastZ;row++)for(let col=firstX;col<=lastX;col++){const index=row*width+col,refs=additions.get(index)??[];refs.push((0x81000000+offset)>>>0);additions.set(index,refs);}
  }
  const gridRaw=Buffer.from(grid.raw);gridRaw.writeFloatLE(x[0],0);gridRaw.writeFloatLE(z[0],4);gridRaw.writeFloatLE(x.at(-1),8);gridRaw.writeFloatLE(z.at(-1),12);gridRaw.writeUInt32LE(width,24);gridRaw.writeUInt32LE(length,28);gridRaw.writeUInt32LE(parsed.primitives.aabbs.count+records.length,0x40);
  const cells=[];
  for(let row=0;row<length;row++)for(let col=0;col<width;col++){
    const old=col>=left&&col<left+grid.width&&row>=bottom&&row<bottom+grid.length?parsed.cells[(row-bottom)*grid.width+col-left]:null,added=additions.get(row*width+col)??[];
    if(!added.length&&old){cells.push(old.raw);continue;}
    const count=(old?.references.length??0)+added.length,raw=Buffer.alloc(16+count*5+pad(count));if(old)old.header.copy(raw);raw.writeUInt32LE(count);let n=0;
    // Queries can stop early on sorted triangle X bounds. Test new volumes
    // before that existing triangle sequence, keeping its order unchanged.
    for(const packed of added){raw.writeUInt32LE(packed,16+n*4);n++;}
    for(const ref of old?.references??[]){const spec=arrays.find(array=>array.type===ref.type);raw.writeUInt32LE((ref.type*0x1000000+ref.index*spec.size)>>>0,16+n*4);raw[16+count*4+n]=ref.flag;n++;}
    cells.push(raw);
  }
  const offsets=Buffer.alloc(links.length*4),shift=(links.length-parsed.links.length)*4,linkBlock=parsed.bytes.subarray(24+parsed.links.length*4,parsed.gridOffset),newLinks=links.slice(parsed.links.length);let offset=parsed.gridOffset+shift;
  parsed.links.forEach((link,i)=>offsets.writeUInt32LE(link.offset+shift,i*4));newLinks.forEach((raw,i)=>{offsets.writeUInt32LE(offset,(parsed.links.length+i)*4);offset+=raw.length;});
  const header=Buffer.from(parsed.bytes.subarray(0,24));header.writeUInt32LE(offset,8);header.writeUInt32LE(links.length,12);
  const bounds=Buffer.alloc((x.length+z.length)*4);[...x,...z].forEach((n,i)=>bounds.writeFloatLE(n,i*4));
  const result=Buffer.concat([header,offsets,linkBlock,...newLinks,gridRaw,bounds,parsed.separator,...arrays.flatMap(spec=>[parsed.primitives[spec.name].raw,...(spec.name==='aabbs'?records.map(record=>record.raw):[])]),parsed.extraVertices,parsed.cellSeparator,...cells,parsed.tail]);
  parseCollision(result);return result;
}
