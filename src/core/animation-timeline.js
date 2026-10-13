import {parseFiveDs,editFiveDs} from './fiveds.js';
import {animationChannels,validateAnimationKeys,trackKeys} from '../shared/animation-timeline.js';
const HEADER=18;
export function editAnimationTimeline(source,request){
  source=Buffer.from(source);const parsed=parseFiveDs(source,true);
  if(!request||!Number.isInteger(request.frames)||request.frames<0||request.frames>65535||!Array.isArray(request.tracks)||request.tracks.length>parsed.nodes.length*4||!Array.isArray(request.changes))throw new Error('5DS: neplatná úprava časové osy.');
  if(request.frames!==parsed.frames&&parsed.nodes.some(node=>node.unknownFlags))throw new Error('5DS: délka animace s neznámými příznaky se nemění.');
  const byNode=new Map(),seen=new Set();
  for(const change of request.tracks){
    if(!change||!Number.isInteger(change.node)||!parsed.nodes[change.node]||Object.keys(change).some(key=>!['node','channel','keys'].includes(key)))throw new Error('5DS: neplatný uzel časové osy.');
    const node=parsed.nodes[change.node],id=`${change.node}/${change.channel}`;
    if(node.unknownFlags)throw new Error('5DS: struktura uzlu s neznámými příznaky se nemění.');if(seen.has(id))throw new Error('5DS: opakovaný kanál.');seen.add(id);
    validateAnimationKeys(node.tracks[change.channel],change.keys,request.frames,change.channel);if(!byNode.has(change.node))byNode.set(change.node,new Map());byNode.get(change.node).set(change.channel,change.keys);
  }
  // Do not let value edits target indices that change meaning in this request.
  for(const change of request.changes){const match=/^nodes\/(\d+)\/(rotation|position|scale|note)\//.exec(change?.id??'');if(match&&seen.has(`${match[1]}/${match[2]}`))throw new Error('5DS: hodnoty a strukturu stejného kanálu upravte společně v časové ose.');}
  for(const node of parsed.nodes)for(const [channel,track]of Object.entries(node.tracks))if(!seen.has(`${node.id}/${channel}`)&&track.times.some(time=>time>request.frames))throw new Error('5DS: zkrácení by ořízlo existující klíče.');
  let result=editFiveDs(source,request.changes);
  // Existing value edits must also be isolated when nodes share a payload.
  // Validate them with the attribute writer, then put their old bytes back
  // and include the requested value in this node's appended channel instead.
  for(const change of request.changes){
    const match=/^nodes\/(\d+)\/(rotation|position|scale|note)\/(\d+)$/.exec(change.id);if(!match)continue;
    const id=Number(match[1]),channel=match[2],node=parsed.nodes[id],track=node.tracks[channel];if(node.unknownFlags)throw new Error('5DS: struktura uzlu s neznámými příznaky se nemění.');
    const entry=parsed.entries.find(entry=>entry.id===change.id);source.copy(result,entry.offset,entry.offset,entry.offset+entry.length);
    if(!byNode.has(id))byNode.set(id,new Map());const changes=byNode.get(id);if(!changes.has(channel))changes.set(channel,trackKeys(track));changes.get(channel)[Number(match[3])].value=change.value;
  }
  for(const [id,changes]of byNode){
    const node=parsed.nodes[id],chunks=[],header=Buffer.alloc(4);let flags=node.flags;
    for(const [channel,,bit,components]of animationChannels){
      const track=node.tracks[channel];if(!changes.has(channel)){if(track)chunks.push(result.subarray(track.layout.start,track.layout.end));continue;}
      const keys=changes.get(channel);if(keys===null){flags&=~bit;continue;}flags|=bit;
      const padding=channel==='note'?2:keys.length%2===0?2:0,stride=channel==='note'?2:components*4,block=Buffer.alloc(2+keys.length*2+padding+keys.length*stride),valueOffset=2+keys.length*2+(channel==='note'?0:padding);block.writeUInt16LE(keys.length,0);
      // Preserve existing alignment/trailer bytes when the field still exists.
      if(padding&&track){const oldPad=channel==='note'?track.layout.end-2:track.times.length%2===0?track.layout.valueOffset-2:null;if(oldPad!==null)source.copy(block,channel==='note'?block.length-2:valueOffset-2,oldPad,oldPad+2);}
      keys.forEach((key,i)=>{block.writeUInt16LE(key.frame,2+i*2);const at=valueOffset+i*stride;if(Object.hasOwn(key,'value')){if(channel==='note')block.writeUInt16LE(key.value,at);else key.value.forEach((value,c)=>block.writeFloatLE(value,at+c*4));}else source.copy(block,at,track.layout.valueOffset+key.source*stride,track.layout.valueOffset+(key.source+1)*stride);});chunks.push(block);
    }
    header.writeUInt32LE(flags>>>0);const body=Buffer.concat([header,...chunks]);if(body.equals(result.subarray(node.layout.start,node.layout.end)))continue;
    // Keep every original byte in place; only this node's table pointer moves
    // to its revised, aligned payload. Names and opaque tails remain referenced.
    const alignment=(4-(result.length-HEADER)%4)%4,offset=result.length+alignment;
    result=Buffer.concat([result,Buffer.alloc(alignment),body]);result.writeUInt32LE(offset-HEADER,node.layout.pointer);
  }
  result.writeUInt16LE(request.frames,20);result.writeUInt32LE(result.length-HEADER,14);parseFiveDs(result);return result;
}
