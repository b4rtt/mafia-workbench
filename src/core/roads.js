const CROSSING_SIZE = 236, NODE_SIZE = 24, SLOT_SIZE = 52;

// PC version 2 stores the engine's crossing/node records verbatim.
// Tagged references: 0xffff = absent; bit 0x8000 selects the node table.
export function parseRoads(source) {
  const bytes = Buffer.from(source);
  if (bytes.length < 12 || bytes.readUInt32LE(0) !== 2) throw new Error('Road: nepodporovaná hlavička.');
  const crossingCount = bytes.readUInt32LE(4), nodeHeader = 8 + crossingCount * CROSSING_SIZE;
  if (crossingCount > 32768 || nodeHeader + 4 > bytes.length) throw new Error('Road: křižovatky překračují soubor.');
  const nodeCount = bytes.readUInt32LE(nodeHeader), nodeStart = nodeHeader + 4;
  if (nodeCount > 32767 || nodeStart + nodeCount * NODE_SIZE !== bytes.length) throw new Error('Road: délka silničních bodů neodpovídá hlavičce.');
  function reference(value) {
    if (value !== 65535 && (value & 32768 ? (value & 32767) >= nodeCount : value >= crossingCount)) throw new Error('Road: vazba odkazuje mimo síť.');
    return value;
  }
  function position(offset) {
    const result = [0,4,8].map(n => bytes.readFloatLE(offset+n));
    if (result.some(n=>!Number.isFinite(n))) throw new Error('Road: neplatná pozice bodu.');
    return result;
  }
  function speed(offset) {
    const value = bytes.readFloatLE(offset);
    if (!Number.isFinite(value)) throw new Error('Road: neplatná rychlost.');
    return value;
  }
  const crossings = [], nodes = [], warnings = [];
  for (let index=0; index<crossingCount; index++) {
    const offset=8+index*CROSSING_SIZE, directions=[];
    for (let slot=0; slot<4; slot++) {
      const at=offset+28+slot*SLOT_SIZE, lanes=[];
      for(let lane=0;lane<4;lane++) lanes.push({type:bytes[at+20+lane*8+2]});
      directions.push({target:reference(bytes.readUInt16LE(at)),priority:bytes.readUInt32LE(at+14),lanes});
    }
    crossings.push({index,position:position(offset),semaphore:bytes[offset+12],speed:speed(offset+16),links:[0,1,2,3].map(slot=>reference(bytes.readUInt16LE(offset+20+slot*2))),directions});
  }
  for(let index=0;index<nodeCount;index++) {
    const offset=nodeStart+index*NODE_SIZE;
    nodes.push({index,position:position(offset),speed:speed(offset+12),previous:reference(bytes.readUInt16LE(offset+16)),next:reference(bytes.readUInt16LE(offset+18)),previousCrossing:reference(bytes.readUInt16LE(offset+20)),nextCrossing:reference(bytes.readUInt16LE(offset+22))});
  }
  if(nodes.some((node,index)=>index&&node.position[0]<nodes[index-1].position[0])) warnings.push('Body nejsou seřazené podle X; náhled je zachová v původním pořadí.');
  return {crossings,nodes,warnings};
}

function editFields(source, changes) {
  const parsed=parseRoads(source), result=Buffer.from(source), seen=new Set();
  if(!Array.isArray(changes)||changes.length>1024) throw new Error('Road: neplatné úpravy.');
  for(const change of changes) {
    const match=/^(crossings|nodes)\/(0|[1-9]\d*)\/(position|speed|semaphore|directions\/[0-3]\/(?:priority|lanes\/[0-3]\/type))$/.exec(change?.id??'');
    if(!match||seen.has(change.id)) throw new Error('Road: neplatná nebo opakovaná vlastnost.');
    seen.add(change.id);
    const [,section,number,field]=match,index=Number(number),value=change.value;
    if(index>=parsed[section].length||(section==='nodes'&&!['position','speed'].includes(field))) throw new Error('Road: vlastnost je mimo rozsah.');
    let offset=section==='crossings'?8+index*CROSSING_SIZE:12+parsed.crossings.length*CROSSING_SIZE+index*NODE_SIZE;
    if(field==='position') {
      if(!Array.isArray(value)||value.length!==3||!Array.from(value).every(n=>typeof n==='number'&&Number.isFinite(n)&&Number.isFinite(Math.fround(n))))throw new Error('Road: pozice musí obsahovat tři konečná čísla float32.');
      value.forEach((n,i)=>{if(!Object.is(n,result.readFloatLE(offset+i*4)))result.writeFloatLE(n,offset+i*4);});
    } else if(field==='speed') {
      if(typeof value!=='number'||!Number.isFinite(value)||!Number.isFinite(Math.fround(value))||value<0) throw new Error('Road: očekávám konečnou nezápornou rychlost v herních jednotkách.');
      offset+=section==='crossings'?16:12;
      if(value!==result.readFloatLE(offset)) result.writeFloatLE(value,offset);
    } else {
      let maximum=255;
      if(field==='semaphore') offset+=12;
      else {
        const parts=field.split('/');offset+=28+Number(parts[1])*SLOT_SIZE;
        if(parts[2]==='priority'){offset+=14;maximum=0xffffffff;}else offset+=22+Number(parts[3])*8;
      }
      if(!Number.isInteger(value)||value<0||value>maximum) throw new Error('Road: příznaky jsou mimo rozsah.');
      if(maximum===255) result[offset]=value; else result.writeUInt32LE(value,offset);
    }
  }
  parseRoads(result);return result;
}

const NONE=65535,PI=Math.fround(Math.PI),TAU=Math.fround(Math.PI*2);
const subtract=(a,b)=>a.map((n,i)=>Math.fround(n-b[i]));
function segment(a,b){
  const delta=subtract(a,b),square=Math.fround(delta.reduce((sum,n)=>sum+n*n,0));
  const distance=square<1e-8?0:Math.abs(square-1)<1e-8?1:Math.sqrt(square);
  if(!Number.isFinite(distance)||!Number.isFinite(Math.fround(distance)))throw new Error('Road: délka cesty překračuje rozsah float32.');return distance;
}
function angle(a,b){let value=Math.atan2(b[2],b[0])-Math.atan2(a[2],a[0]);if(value< -PI)value+=TAU;if(value>PI)value-=TAU;return value;}
function record(file,ref){return ref&32768?file.nodes[ref&32767]:file.crossings[ref];}
function route(file,crossing,slot){
  const path=[crossing.index],seen=new Set();let previous=crossing.index,current=crossing.links[slot];
  while(current!==NONE){
    if(seen.has(current))throw new Error('Road: cyklická cesta z křižovatky.');seen.add(current);path.push(current);
    if(!(current&32768))return path;
    const node=record(file,current),next=node.previous!==previous&&node.previous!==NONE?node.previous:node.next;
    if(next===previous||next===NONE)throw new Error('Road: aktivní cesta nekončí v křižovatce.');previous=current;current=next;
  }
  throw new Error('Road: aktivní cesta nemá výjezd.');
}
function tangent(file,crossing,slot){
  const ref=crossing.links[slot],node=record(file,ref);
  if(!(ref&32768)||node.previous===NONE||node.next===NONE)return subtract(node.position,crossing.position);
  const next=node.previous===crossing.index?node.next:node.previous;
  return subtract(record(file,next).position,node.position);
}
// Position changes keep the topology and node ownership. Recompute only paths and
// turn ordering whose geometry changed, then relocate whole nodes and repair IDs.
export function prepareRoadEdits(source,changes){
  const before=parseRoads(source),data=editFields(source,changes),after=parseRoads(data),moved=new Set(),total=before.crossings.length;
  for(const [section,rows]of [['crossings',after.crossings],['nodes',after.nodes]])for(const row of rows)if(row.position.some((n,i)=>n!==before[section][row.index].position[i]))moved.add(section==='nodes'?row.index|32768:row.index);
  const mapping=Array.from({length:total+after.nodes.length},(_,i)=>i);
  if(!moved.size)return {data,mapping};
  for(const crossing of after.crossings){
    const active=[];
    for(let slot=0;slot<4;slot++){
      const direction=crossing.directions[slot];if(crossing.links[slot]===NONE||direction.target===NONE)continue;
      const path=route(after,crossing,slot);if(path.at(-1)!==direction.target)throw new Error('Road: cíl směru neodpovídá jeho cestě.');
      if(path.some(ref=>moved.has(ref))){let distance=0;for(let i=1;i<path.length;i++)distance=Math.fround(distance+segment(record(after,path[i-1]).position,record(after,path[i]).position));if(!Number.isFinite(distance))throw new Error('Road: délka cesty překračuje rozsah float32.');data.writeFloatLE(distance,8+crossing.index*CROSSING_SIZE+28+slot*SLOT_SIZE+4);}
      active.push({slot,vector:tangent(after,crossing,slot),oldVector:tangent(before,before.crossings[crossing.index],slot)});
    }
    if(!active.length||!active.some(item=>[0,2].some(i=>item.vector[i]!==item.oldVector[i])))continue;
    if(active.some(item=>!Number.isFinite(item.vector[0])||!Number.isFinite(item.vector[2])||!item.vector[0]&&!item.vector[2]))throw new Error('Road: výjezd křižovatky nemá nenulový směr v rovině XZ.');
    const reference=active[0].vector.map(n=>-n),first=active[0],rest=active.slice(1).map(item=>({...item,angle:angle(reference,item.vector)})).sort((a,b)=>Math.fround(a.angle)-Math.fround(b.angle));
    const order=[first,...rest,...[0,1,2,3].filter(slot=>!active.some(item=>item.slot===slot)).map(slot=>({slot}))];
    const offset=8+crossing.index*CROSSING_SIZE,slots=order.map(item=>({link:data.readUInt16LE(offset+20+item.slot*2),bytes:Buffer.from(data.subarray(offset+28+item.slot*SLOT_SIZE,offset+28+(item.slot+1)*SLOT_SIZE))}));
    let previous=0;for(let i=1;i<active.length;i++){const cumulative=rest[i-1].angle+PI;slots[i].bytes.writeFloatLE(cumulative-previous,8);previous=Math.fround(cumulative);}slots[0].bytes.writeFloatLE(TAU-previous,8);
    slots.forEach((item,i)=>{data.writeUInt16LE(item.link,offset+20+i*2);item.bytes.copy(data,offset+28+i*SLOT_SIZE);});
  }
  const order=after.nodes.map(node=>node.index).sort((a,b)=>after.nodes[a].position[0]-after.nodes[b].position[0]);
  order.forEach((old,index)=>{mapping[total+old]=total+index;});
  const remap=ref=>ref===NONE||!(ref&32768)?ref:32768|(mapping[total+(ref&32767)]-total),nodeStart=12+total*CROSSING_SIZE,original=Buffer.from(data);
  order.forEach((old,index)=>{const offset=nodeStart+index*NODE_SIZE;original.copy(data,offset,nodeStart+old*NODE_SIZE,nodeStart+(old+1)*NODE_SIZE);for(const delta of [16,18,20,22])data.writeUInt16LE(remap(data.readUInt16LE(offset+delta)),offset+delta);});
  for(let i=0;i<total;i++){const offset=8+i*CROSSING_SIZE;for(let slot=0;slot<4;slot++){for(const delta of [20+slot*2,28+slot*SLOT_SIZE])data.writeUInt16LE(remap(data.readUInt16LE(offset+delta)),offset+delta);}}
  parseRoads(data);return {data,mapping};
}
export function editRoads(source,changes){return prepareRoadEdits(source,changes).data;}
