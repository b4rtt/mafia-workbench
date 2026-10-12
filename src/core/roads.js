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

export function editRoads(source, changes) {
  const parsed=parseRoads(source), result=Buffer.from(source), seen=new Set();
  if(!Array.isArray(changes)||changes.length>1024) throw new Error('Road: neplatné úpravy.');
  for(const change of changes) {
    const match=/^(crossings|nodes)\/(0|[1-9]\d*)\/(speed|semaphore|directions\/[0-3]\/(?:priority|lanes\/[0-3]\/type))$/.exec(change?.id??'');
    if(!match||seen.has(change.id)) throw new Error('Road: neplatná nebo opakovaná vlastnost.');
    seen.add(change.id);
    const [,section,number,field]=match,index=Number(number),value=change.value;
    if(index>=parsed[section].length||(section==='nodes'&&field!=='speed')) throw new Error('Road: vlastnost je mimo rozsah.');
    let offset=section==='crossings'?8+index*CROSSING_SIZE:12+parsed.crossings.length*CROSSING_SIZE+index*NODE_SIZE;
    if(field==='speed') {
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
