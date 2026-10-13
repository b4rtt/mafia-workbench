export const animationChannels=[['rotation','Rotace WXYZ',4,4],['position','Pozice XYZ',2,3],['scale','Měřítko XYZ',8,3],['note','Poznámky (raw ID)',16,1]];
export function trackKeys(track){return track?track.times.map((frame,source)=>({source,frame})):[];}
export function validateAnimationKeys(track,keys,frames,channel){
  const descriptor=animationChannels.find(item=>item[0]===channel);if(!descriptor||keys!==null&&(!Array.isArray(keys)||keys.length>65535))throw new Error('5DS: neplatný kanál nebo počet klíčů.');if(keys===null)return;
  let previous=-1;for(const key of keys){
    if(!key||Object.keys(key).some(name=>!['source','frame','value'].includes(name))||!Number.isInteger(key.frame)||key.frame<0||key.frame>frames||key.frame<previous)throw new Error('5DS: snímky klíčů musí být seřazené a v délce animace.');previous=key.frame;
    if(Object.hasOwn(key,'source')&&(!Number.isInteger(key.source)||key.source<0||!track||key.source>=track.times.length))throw new Error('5DS: neplatný zdroj klíče.');
    if(!Object.hasOwn(key,'source')&&!Object.hasOwn(key,'value'))throw new Error('5DS: nový klíč potřebuje hodnotu.');
    if(Object.hasOwn(key,'value')){
      if(channel==='note'){if(!Number.isInteger(key.value)||key.value<0||key.value>65535)throw new Error('5DS: poznámka musí být celé číslo 0–65535.');}
      else if(!Array.isArray(key.value)||key.value.length!==descriptor[3]||!Array.from(key.value).every(value=>typeof value==='number'&&Number.isFinite(value)&&Number.isFinite(Math.fround(value))))throw new Error('5DS: neplatná hodnota animačního klíče.');
    }
  }
}
export function timelineTrack(track,keys){return keys===null?null:{times:keys.map(key=>key.frame),values:keys.map(key=>Object.hasOwn(key,'value')?Array.isArray(key.value)?key.value.map(Math.fround):key.value:track.values[key.source])};}
export function insertAnimationKey(keys,key){const index=keys.findIndex(item=>item.frame>key.frame),result=[...keys];result.splice(index<0?result.length:index,0,key);return {keys:result,index:index<0?result.length-1:index};}
export class AnimationTimelineDraft{
  constructor(animation,drafts){this.source=animation;this.drafts=drafts;this.tracks=new Map();}
  get frames(){return this.drafts.get('timeline/frames')??this.source.frames;}
  track(node,channel){const original=this.source.nodes[node]?.tracks[channel];return this.tracks.has(`${node}/${channel}`)?timelineTrack(original,this.tracks.get(`${node}/${channel}`)):original;}
  keys(node,channel){const value=this.tracks.get(`${node}/${channel}`);return value===undefined?trackKeys(this.source.nodes[node]?.tracks[channel]):value;}
  set(node,channel,keys){const original=this.source.nodes[node]?.tracks[channel],prefix=`nodes/${node}/${channel}/`,values=[...this.drafts].filter(([id])=>id.startsWith(prefix));if(keys)keys=keys.map(key=>{const value=values.find(([id])=>id===prefix+key.source);return value&&!Object.hasOwn(key,'value')?{...key,value:value[1]}:key;});validateAnimationKeys(original,keys,this.frames,channel);const id=`${node}/${channel}`,identity=keys===null?!original:original&&keys.length===original.times.length&&keys.every((key,i)=>key.source===i&&key.frame===original.times[i]&&!Object.hasOwn(key,'value'));for(const [id]of values)this.drafts.delete(id);if(identity){this.tracks.delete(id);this.drafts.delete('timeline/'+id);}else{this.tracks.set(id,keys);this.drafts.set('timeline/'+id,keys);}}
  setFrames(value){if(!Number.isInteger(value)||value<0||value>65535)throw new Error('5DS: poslední snímek musí být celé číslo 0–65535.');if(value!==this.source.frames&&this.source.nodes.some(node=>node.unknownFlags))throw new Error('5DS: délka animace s neznámými příznaky se nemění.');for(const node of this.source.nodes)for(const [channel]of animationChannels)validateAnimationKeys(node.tracks[channel],this.keys(node.id,channel),value,channel);if(value===this.source.frames)this.drafts.delete('timeline/frames');else this.drafts.set('timeline/frames',value);}
  animation(){return {...this.source,frames:this.frames,nodes:this.source.nodes.map(node=>({...node,tracks:Object.fromEntries(animationChannels.flatMap(([channel])=>{const track=this.track(node.id,channel);return track?[[channel,track]]:[];}))}))};}
  request(){return {frames:this.frames,tracks:[...this.tracks].map(([id,keys])=>{const [node,channel]=id.split('/');return {node:Number(node),channel,keys};}),changes:[...this.drafts].filter(([id])=>id.startsWith('nodes/')).map(([id,value])=>({id,value}))};}
}
