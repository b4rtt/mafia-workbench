import {parseRoads,compileRoadTopology} from './roads.js';
import {roadDissolvePlan,roadMergePlan} from '../shared/roads.js';
import {roadCurvePlan} from '../shared/road-curve.js';

const CROSS=236,NODE=24,SLOT=52,NONE=65535;
const fail=message=>{throw new Error('Road: '+message);};
const xyz=value=>{
  if(!Array.isArray(value)||value.length!==3||!Array.from(value).every(n=>typeof n==='number'&&Number.isFinite(n)&&Number.isFinite(Math.fround(n))))fail('pozice musí obsahovat tři konečná čísla float32.');
  return value.map(Math.fround);
};
const speed=value=>{if(typeof value!=='number'||!Number.isFinite(value)||!Number.isFinite(Math.fround(value))||value<0)fail('rychlost je mimo rozsah.');return Math.fround(value);};
const crossIndex=(file,index)=>{if(!Number.isInteger(index)||index<0||index>=file.crossings.length)fail('křižovatka je mimo síť.');return index;};
const atCross=index=>8+index*CROSS;
const atSlot=(index,slot)=>atCross(index)+28+slot*SLOT;
// Fresh POD records have no opaque data to preserve. Known defaults match
// mEdit's road definitions; every unused reference is explicitly 0xffff.
function direction(){
  const bytes=Buffer.alloc(SLOT);bytes.writeUInt16LE(NONE);bytes.writeUInt32LE(100,14);
  for(let i=0;i<4;i++)bytes.writeFloatLE(4,24+i*8);return bytes;
}
function crossing(position,velocity,semaphore){
  const bytes=Buffer.alloc(CROSS);position.forEach((n,i)=>bytes.writeFloatLE(n,i*4));bytes[12]=semaphore;bytes.writeFloatLE(velocity,16);
  for(let slot=0;slot<4;slot++){bytes.writeUInt16LE(NONE,20+slot*2);direction().copy(bytes,28+slot*SLOT);}return bytes;
}
function trace(file,from,slot){
  const path=[],visited=new Set();let previous=from,current=file.crossings[from].links[slot];
  while(current!==NONE){
    if(visited.has(current))fail('cyklická cesta.');visited.add(current);path.push(current);
    if(!(current&32768))return path;
    const node=file.nodes[current&32767];if(!node||node.previous!==previous&&node.next!==previous)fail('cesta nemá vzájemné sousední vazby.');
    const next=node.previous===previous?node.next:node.previous;if(next===previous||next===NONE)fail('cesta je otevřená.');previous=current;current=next;
  }
  fail('cesta nemá sousední bod.');
}
function validateRoutes(file){
  for(const c of file.crossings)for(let slot=0;slot<4;slot++){
    // Original files keep stale metadata on disabled directions. Like the
    // engine, only slots with both references present participate in routing.
    if(c.links[slot]===NONE||c.directions[slot].target===NONE)continue;
    if(trace(file,c.index,slot).at(-1)!==c.directions[slot].target)fail('cíl směru neodpovídá cestě.');
  }
}
function slotsTo(file,from,to,node=null){
  return file.crossings[from].links.flatMap((ref,slot)=>{
    if(ref===NONE)return [];
    let path;try{path=trace(file,from,slot);}catch(error){if(file.crossings[from].directions[slot].target!==NONE)throw error;return [];}
    return path.at(-1)===to&&(node===null||path.includes(32768|node))?[slot]:[];
  });
}
function serialize(crossings,nodes){
  const head=Buffer.alloc(8),count=Buffer.alloc(4);head.writeUInt32LE(2);head.writeUInt32LE(crossings.length,4);count.writeUInt32LE(nodes.length);
  return Buffer.concat([head,...crossings,count,...nodes]);
}
function records(source,file){
  const bytes=Buffer.from(source),start=12+file.crossings.length*CROSS;
  return {crossings:file.crossings.map(c=>Buffer.from(bytes.subarray(atCross(c.index),atCross(c.index)+CROSS))),nodes:file.nodes.map(n=>Buffer.from(bytes.subarray(start+n.index*NODE,start+(n.index+1)*NODE)))};
}
function rewriteRefs(data,file,remap){
  const start=12+file.crossings.length*CROSS;
  for(const c of file.crossings)for(let slot=0;slot<4;slot++)for(const offset of [atCross(c.index)+20+slot*2,atSlot(c.index,slot)])data.writeUInt16LE(remap(data.readUInt16LE(offset)),offset);
  for(const n of file.nodes)for(const delta of [16,18,20,22]){const offset=start+n.index*NODE+delta;data.writeUInt16LE(remap(data.readUInt16LE(offset)),offset);}
}
function lanes(value,enabled=true){
  if(!Array.isArray(value)||value.length!==4)fail('směr potřebuje čtyři pruhy.');
  const result=Array.from(value,lane=>{
    if(!lane||!Number.isInteger(lane.type)||lane.type<0||lane.type>3||typeof lane.distance!=='number'||!Number.isFinite(lane.distance)||!Number.isFinite(Math.fround(lane.distance)))fail('neplatný typ nebo boční posun pruhu.');
    return {type:enabled?lane.type:0,distance:Math.fround(lane.distance)};
  });
  if(enabled&&!result.some(lane=>lane.type))fail('povolený směr musí mít alespoň jeden aktivní pruh.');return result;
}
function configureSlot(data,cross,slot,target,laneValues,priority){
  if(!Number.isInteger(priority)||priority<0||priority>0xffffffff)fail('priorita je mimo rozsah.');
  const offset=atSlot(cross,slot),bytes=Buffer.from(data.subarray(offset,offset+SLOT));
  bytes.writeUInt16LE(target);bytes.writeFloatLE(0,4);bytes.writeFloatLE(0,8);bytes.writeUInt32LE(priority,14);
  laneValues.forEach((lane,i)=>{bytes[22+i*8]=lane.type;bytes.writeFloatLE(lane.distance,24+i*8);});bytes.copy(data,offset);
}
function editSlot(data,cross,slot,target,patch){
  if(!patch||typeof patch!=='object'||Array.isArray(patch)||Object.keys(patch).some(key=>!['enabled','priority','lanes'].includes(key)))fail('neplatné nastavení směru.');
  const offset=atSlot(cross,slot),beforeTarget=data.readUInt16LE(offset);let laneTypeChanged=false;
  if('priority' in patch){if(!Number.isInteger(patch.priority)||patch.priority<0||patch.priority>0xffffffff)fail('priorita je mimo rozsah.');data.writeUInt32LE(patch.priority,offset+14);}
  if('lanes' in patch){
    if(!Array.isArray(patch.lanes)||patch.lanes.length!==4)fail('směr potřebuje čtyři pruhy.');
    for(const [i,lane]of Array.from(patch.lanes).entries()){
      if(!lane||typeof lane!=='object'||Array.isArray(lane)||Object.keys(lane).some(key=>!['type','distance'].includes(key)))fail('neplatná úprava pruhu.');
      if('type' in lane){if(!Number.isInteger(lane.type)||lane.type<0||lane.type>255)fail('typ pruhu musí být byte.');laneTypeChanged||=data[offset+22+i*8]!==lane.type;data[offset+22+i*8]=lane.type;}
      if('distance' in lane){if(typeof lane.distance!=='number'||!Number.isFinite(lane.distance)||!Number.isFinite(Math.fround(lane.distance)))fail('boční posun musí být konečné číslo float32.');const at=offset+24+i*8;if(!Object.is(Math.fround(lane.distance),data.readFloatLE(at)))data.writeFloatLE(lane.distance,at);}
    }
  }
  if('enabled' in patch){
    if(typeof patch.enabled!=='boolean')fail('povolení směru musí být ano nebo ne.');
    if(patch.enabled){if(![0,1,2,3].some(i=>data[offset+22+i*8]))fail('povolený směr musí mít alespoň jeden aktivní pruh.');data.writeUInt16LE(target,offset);}
    else {data.writeUInt16LE(NONE,offset);for(let i=0;i<4;i++)data[offset+22+i*8]=0;}
  }else if(laneTypeChanged&&![0,1,2,3].some(i=>data[offset+22+i*8]))data.writeUInt16LE(NONE,offset);
  return data.readUInt16LE(offset)!==beforeTarget;
}
export function changeRoadTopology(source,request){
  const file=parseRoads(source),total=file.crossings.length,count=file.nodes.length,rows=records(source,file),identity=Array.from({length:total+count},(_,i)=>i);
  const action=request?.action;
  if(action==='round-node'){
    validateRoutes(file);const plan=roadCurvePlan(file,request.index,request.radius),index=plan.index,added=plan.positions.length-1;
    const remap=ref=>ref===NONE||!(ref&32768)?ref:(ref&32767)===index?32768|(index+plan.middle):(ref&32767)>index?ref+added:ref;
    // Relocate existing references before inserting the new records. Complete
    // crossing slots and all unaffected node records retain their raw bytes.
    const relocated=Buffer.from(source);rewriteRefs(relocated,file,remap);const next=records(relocated,file),first=32768|index,last=32768|(index+added);
    for(const [i,r]of plan.refs.entries()){
      const n=r&32768?file.nodes[r&32767]:file.crossings[r],bytes=r&32768?next.nodes[r&32767]:next.crossings[r];
      const offset=r&32768?(n.previous===(32768|index)?16:18):20+n.links.indexOf(32768|index)*2;bytes.writeUInt16LE(i?last:first,offset);
    }
    const generated=plan.positions.map((position,i)=>{
      const bytes=Buffer.from(rows.nodes[index]);position.forEach((n,j)=>bytes.writeFloatLE(n,j*4));
      bytes.writeUInt16LE(i?32768|(index+i-1):remap(plan.refs[0]),16);bytes.writeUInt16LE(i<added?32768|(index+i+1):remap(plan.refs[1]),18);return bytes;
    });
    next.nodes.splice(index,1,...generated);const data=serialize(next.crossings,next.nodes),compiled=compileRoadTopology(data,plan.owners,generated.map((_,i)=>index+i));validateRoutes(parseRoads(compiled.data));
    return {data:compiled.data,index:compiled.mapping[plan.selection],mapping:identity.map(i=>compiled.mapping[i<total?i:i===total+index?plan.selection:i>total+index?i+added:i])};
  }
  if(action==='create-crossing'){
    if(total>=32768)fail('síť už má maximální počet křižovatek.');
    const position=xyz(request.position),velocity=speed(request.speed??1.2),semaphore=request.semaphore??0;
    if(!Number.isInteger(semaphore)||semaphore<0||semaphore>1)fail('příznak semaforu musí být 0 nebo 1.');
    rows.crossings.push(crossing(position,velocity,semaphore));const data=serialize(rows.crossings,rows.nodes);parseRoads(data);
    return {data,index:total,mapping:identity.map(i=>i<total?i:i+1)};
  }
  if(action==='delete-crossing'){
    const index=crossIndex(file,request.index);
    if(file.crossings[index].links.some(ref=>ref!==NONE)||file.crossings[index].directions.some(d=>d.target!==NONE))fail('nejdřív odstraňte cesty připojené ke křižovatce.');
    for(const c of file.crossings)if(c.links.includes(index)||c.directions.some(d=>d.target===index))fail('na křižovatku vede jiný odkaz.');
    for(const n of file.nodes)if([n.previous,n.next,n.previousCrossing,n.nextCrossing].includes(index))fail('křižovatku používá silniční bod.');
    rows.crossings.splice(index,1);const data=serialize(rows.crossings,rows.nodes);rewriteRefs(data,parseRoadsForRemap(data),ref=>ref!==NONE&&!(ref&32768)&&ref>index?ref-1:ref);parseRoads(data);
    return {data,index:Math.min(index,Math.max(0,total-2)),mapping:identity.map(i=>i===index?null:i>index?i-1:i)};
  }
  if(action==='dissolve-crossing'){
    const index=crossIndex(file,request.index);validateRoutes(file);
    const plan=roadDissolvePlan(file,index),{from,to,fromSlot,toSlot,chain}=plan;
    // Preserve the removed junction's position/speed as an ordinary node.
    const added=Buffer.alloc(NODE);rows.crossings[index].copy(added,0,0,12);rows.crossings[index].copy(added,12,16,20);
    const ref=32768|count,cut=chain.indexOf(index),joined=chain.map(value=>value===index?ref:value);
    added.writeUInt16LE(cut?joined[cut-1]:from,16);added.writeUInt16LE(cut+1<joined.length?joined[cut+1]:to,18);added.writeUInt16LE(from,20);added.writeUInt16LE(to,22);
    for(let i=0;i<chain.length;i++)if(chain[i]!==index){
      const bytes=rows.nodes[chain[i]&32767],replace=i<cut?to:from;
      for(const offset of [20,22])if(bytes.readUInt16LE(offset)===index)bytes.writeUInt16LE(replace,offset);
    }
    for(const [cross,slot,target]of [[from,fromSlot,to],[to,toSlot,from]]){
      const bytes=rows.crossings[cross],offset=28+slot*SLOT;
      if(bytes.readUInt16LE(offset)!==NONE)bytes.writeUInt16LE(target,offset);
    }
    rows.nodes.push(added);rows.crossings.splice(index,1);
    const remap=value=>value===NONE||value&32768?value:value===index?ref:value>index?value-1:value;
    const data=serialize(rows.crossings,rows.nodes);rewriteRefs(data,parseRoadsForRemap(data),remap);
    const compiled=compileRoadTopology(data,[remap(from),remap(to)],joined.map(value=>value&32767));validateRoutes(parseRoads(compiled.data));
    return {data:compiled.data,index:compiled.mapping[total-1+count],mapping:identity.map(i=>i<total?i===index?compiled.mapping[total-1+count]:remap(i):compiled.mapping[i-1])};
  }
  if(action==='merge-crossings'){
    const from=crossIndex(file,request.from),to=crossIndex(file,request.to);validateRoutes(file);
    const {connector,moved}=roadMergePlan(file,from,to),target=rows.crossings[to];
    // Keep the destination's entire header. Reuse only empty exit slots and
    // the discarded connector; moved exits retain their complete raw records.
    target.writeUInt16LE(NONE,20+connector.backSlot*2);target.writeUInt16LE(NONE,28+connector.backSlot*SLOT);
    const free=[0,1,2,3].filter(slot=>target.readUInt16LE(20+slot*2)===NONE&&target.readUInt16LE(28+slot*SLOT)===NONE);
    moved.forEach((leg,i)=>{target.writeUInt16LE(file.crossings[from].links[leg.slot],20+free[i]*2);rows.crossings[from].copy(target,28+free[i]*SLOT,28+leg.slot*SLOT,28+(leg.slot+1)*SLOT);});
    const removed=new Set(connector.nodes.map(ref=>ref&32767)),nodeMap=[];let next=0;
    rows.nodes=rows.nodes.filter((_,i)=>{nodeMap[i]=removed.has(i)?null:next++;return !removed.has(i);});rows.crossings.splice(from,1);
    const cross=ref=>{if(ref===from)ref=to;return ref>from?ref-1:ref;};
    const remap=ref=>{if(ref===NONE)return ref;if(!(ref&32768))return cross(ref);const index=nodeMap[ref&32767];if(index===null)fail('neodpojený odkaz na odstraněný bod.');return 32768|index;};
    const data=serialize(rows.crossings,rows.nodes);rewriteRefs(data,parseRoadsForRemap(data),remap);
    const affected=moved.flatMap(leg=>leg.nodes.map(ref=>nodeMap[ref&32767]));
    const compiled=compileRoadTopology(data,[...new Set([to,...moved.map(leg=>leg.target)].map(cross))],affected);validateRoutes(parseRoads(compiled.data));
    return {data:compiled.data,index:cross(to),mapping:identity.map(i=>i<total?cross(i):nodeMap[i-total]===null?null:compiled.mapping[total-1+nodeMap[i-total]])};
  }
  if(action==='split-crossing'){
    if(total>=32768)fail('síť už má maximální počet křižovatek.');
    const index=request.index;if(!Number.isInteger(index)||index<0||index>=count)fail('silniční bod je mimo síť.');
    const selected=file.nodes[index],from=crossIndex(file,selected.previousCrossing),to=crossIndex(file,selected.nextCrossing);
    if(from===to)fail('bod potřebuje dvě různé koncové křižovatky.');validateRoutes(file);
    const left=slotsTo(file,from,to,index),right=slotsTo(file,to,from,index);
    if(left.length!==1||right.length!==1)fail('cesta nemá jednoznačné vzájemné směry.');
    const path=trace(file,from,left[0]),back=trace(file,to,right[0]),chain=path.slice(0,-1),cut=chain.indexOf(32768|index);
    if(cut<0||path.at(-1)!==to||back.at(-1)!==from||chain.some(ref=>!(ref&32768))||back.length!==path.length||back.slice(0,-1).some((ref,i)=>ref!==chain[chain.length-1-i]))fail('bod neleží na shodné vzájemné cestě.');
    const owned=new Set(chain.map(ref=>ref&32767));
    for(const n of file.nodes){
      if(owned.has(n.index)){if(![from,to].includes(n.previousCrossing)||![from,to].includes(n.nextCrossing)||n.previousCrossing===n.nextCrossing)fail('bod má jiné vlastníky cesty.');}
      else if([n.previous,n.next,n.previousCrossing,n.nextCrossing].some(ref=>ref!==NONE&&(ref&32768)&&owned.has(ref&32767)))fail('cestu používá jiný silniční bod.');
    }
    for(const c of file.crossings)for(let slot=0;slot<4;slot++)if(!(c.index===from&&slot===left[0]||c.index===to&&slot===right[0])&&[c.links[slot],c.directions[slot].target].some(ref=>ref!==NONE&&(ref&32768)&&owned.has(ref&32767)))fail('cestu používá další výjezd.');
    const velocity=speed(request.speed??selected.speed),semaphore=request.semaphore??0;
    if(!Number.isInteger(semaphore)||semaphore<0||semaphore>1)fail('příznak semaforu musí být 0 nebo 1.');
    const added=Number(cut===0)+Number(cut===chain.length-1);
    if(count-1+added>32767)fail('síť už má maximální počet silničních bodů.');
    const forward=Buffer.from(rows.crossings[from].subarray(28+left[0]*SLOT,28+(left[0]+1)*SLOT)),reverse=Buffer.from(rows.crossings[to].subarray(28+right[0]*SLOT,28+(right[0]+1)*SLOT));
    // Ownership orientation can differ between records. Replace just the old
    // endpoint on each half, retaining the original previous/next ordering.
    for(let i=0;i<chain.length;i++)if(i!==cut){const bytes=rows.nodes[chain[i]&32767],replace=i<cut?to:from;for(const offset of [20,22])if(bytes.readUInt16LE(offset)===replace)bytes.writeUInt16LE(total,offset);}
    rows.crossings.push(crossing(selected.position,velocity,semaphore));
    const nodeMap=Array.from({length:count},(_,i)=>i===index?null:i>index?i-1:i);rows.nodes.splice(index,1);
    const remap=ref=>ref===NONE||!(ref&32768)?ref:(ref&32767)===index?total:32768|nodeMap[ref&32767];
    let data=serialize(rows.crossings,rows.nodes);rewriteRefs(data,parseRoadsForRemap(data),remap);
    const halves=[chain.slice(0,cut).map(remap),chain.slice(cut+1).map(remap)],next=records(data,parseRoads(data));
    // The native loader enters a route through a node. At an end/sole point,
    // supply the missing half's midpoint before publishing the new graph.
    function midpoint(a,b){
      const endpoint=file.crossings[a===total?b:a].position;
      const position=xyz(endpoint.map((n,i)=>(n+selected.position[i])/2));
      if(position[0]===endpoint[0]&&position[2]===endpoint[2]||position[0]===selected.position[0]&&position[2]===selected.position[2])fail('mezi křižovatkami není místo pro odlišný bod v XZ.');
      const bytes=Buffer.alloc(NODE);position.forEach((n,i)=>bytes.writeFloatLE(n,i*4));bytes.writeFloatLE(velocity,12);bytes.writeUInt16LE(a,16);bytes.writeUInt16LE(b,18);bytes.writeUInt16LE(a,20);bytes.writeUInt16LE(b,22);const ref=32768|next.nodes.length;next.nodes.push(bytes);return ref;
    }
    if(!halves[0].length)halves[0].push(midpoint(from,total));
    if(!halves[1].length)halves[1].push(midpoint(total,to));
    const endpoints=[[from,left[0],total,halves[0][0],forward],[to,right[0],total,halves[1].at(-1),reverse],[total,0,from,halves[0].at(-1),reverse],[total,1,to,halves[1][0],forward]];
    for(const [cross,slot,target,near,template]of endpoints){const bytes=next.crossings[cross];bytes.writeUInt16LE(near,20+slot*2);template.copy(bytes,28+slot*SLOT);bytes.writeUInt16LE(template.readUInt16LE()===NONE?NONE:target,28+slot*SLOT);}
    data=serialize(next.crossings,next.nodes);
    const compiled=compileRoadTopology(data,[from,to,total],halves.flat().map(ref=>ref&32767));validateRoutes(parseRoads(compiled.data));
    return {data:compiled.data,index:total,mapping:identity.map(i=>i<total?i:i===total+index?total:compiled.mapping[total+1+nodeMap[i-total]])};
  }
  if(!['connect','disconnect','edit-road'].includes(action))fail('neplatná změna silniční sítě.');
  const from=crossIndex(file,request.from),to=crossIndex(file,request.to);if(from===to)fail('vyberte dvě různé křižovatky.');validateRoutes(file);
  if(action==='connect'){
    if(file.crossings[from].directions.some(d=>d.target===to)||file.crossings[to].directions.some(d=>d.target===from)||slotsTo(file,from,to).length||slotsTo(file,to,from).length)fail('křižovatky už mají vzájemnou cestu.');
    const free=c=>file.crossings[c].links.findIndex((ref,i)=>ref===NONE&&file.crossings[c].directions[i].target===NONE),left=free(from),right=free(to);if(left<0||right<0)fail('křižovatka už má všechny čtyři výjezdy obsazené.');
    const points=request.positions??[file.crossings[from].position.map((n,i)=>(n+file.crossings[to].position[i])/2)];
    if(!Array.isArray(points)||!points.length||points.length>4096||count+points.length>32767)fail('cesta potřebuje 1 až 4096 bodů a nesmí překročit limit sítě.');
    const positions=Array.from(points,xyz),chain=[file.crossings[from].position,...positions,file.crossings[to].position];
    for(let i=1;i<chain.length;i++)if(chain[i][0]===chain[i-1][0]&&chain[i][2]===chain[i-1][2])fail('sousední body cesty potřebují nenulový směr v XZ.');
    const velocity=speed(request.speed??Math.min(file.crossings[from].speed,file.crossings[to].speed));
    const defaults=()=>[{type:2,distance:1.5},...Array.from({length:3},()=>({type:0,distance:4}))];
    const forwardEnabled=request.forwardEnabled??true,reverseEnabled=request.reverseEnabled??true;
    if(typeof forwardEnabled!=='boolean'||typeof reverseEnabled!=='boolean')fail('povolení směru musí být ano nebo ne.');
    if(!forwardEnabled&&!reverseEnabled)fail('nová cesta musí mít alespoň jeden povolený směr.');
    // The loader drops slots with four zero lane bytes. Retain their physical
    // near links so the editor can still split or remove the reciprocal chain.
    const forward=lanes(request.forwardLanes??defaults(),forwardEnabled),reverse=lanes(request.reverseLanes??defaults(),reverseEnabled);
    positions.forEach((position,i)=>{const bytes=Buffer.alloc(NODE);position.forEach((n,j)=>bytes.writeFloatLE(n,j*4));bytes.writeFloatLE(velocity,12);bytes.writeUInt16LE(i?32768|(count+i-1):from,16);bytes.writeUInt16LE(i+1<positions.length?32768|(count+i+1):to,18);bytes.writeUInt16LE(from,20);bytes.writeUInt16LE(to,22);rows.nodes.push(bytes);});
    const data=serialize(rows.crossings,rows.nodes);data.writeUInt16LE(32768|count,atCross(from)+20+left*2);data.writeUInt16LE(32768|(count+positions.length-1),atCross(to)+20+right*2);
    configureSlot(data,from,left,forwardEnabled?to:NONE,forward,request.forwardPriority??100);configureSlot(data,to,right,reverseEnabled?from:NONE,reverse,request.reversePriority??100);
    const compiled=compileRoadTopology(data,[from,to],positions.map((_,i)=>count+i));validateRoutes(parseRoads(compiled.data));
    return {data:compiled.data,index:from,mapping:identity.map(i=>compiled.mapping[i])};
  }
  let left=slotsTo(file,from,to),right=slotsTo(file,to,from);
  if(action==='edit-road'&&request.fromSlot!==undefined){
    if(!Number.isInteger(request.fromSlot)||request.fromSlot<0||request.fromSlot>3)fail('výjezd je mimo rozsah.');
    left=left.filter(slot=>slot===request.fromSlot);
    if(left.length===1){const route=trace(file,from,left[0]).slice(0,-1);right=right.filter(slot=>{const back=trace(file,to,slot);return back.length===route.length+1&&back.slice(0,-1).every((ref,i)=>ref===route[route.length-1-i]);});}
  }
  if(left.length!==1||right.length!==1)fail('cesta nemá jednoznačné vzájemné směry.');
  const path=trace(file,from,left[0]),back=trace(file,to,right[0]),removed=path.slice(0,-1);
  if(path.at(-1)!==to||back.at(-1)!==from||removed.some(ref=>!(ref&32768))||back.length!==path.length||back.slice(0,-1).some((ref,i)=>ref!==removed[removed.length-1-i]))fail('cesta nemá shodné vzájemné řetězce.');
  const remove=new Set(removed.map(ref=>ref&32767));
  for(const n of file.nodes){
    if(remove.has(n.index)){if(![from,to].includes(n.previousCrossing)||![from,to].includes(n.nextCrossing)||n.previousCrossing===n.nextCrossing)fail('bod má jiné vlastníky cesty.');}
    else if([n.previous,n.next,n.previousCrossing,n.nextCrossing].some(ref=>ref!==NONE&&(ref&32768)&&remove.has(ref&32767)))fail('cestu používá jiný silniční bod.');
  }
  for(const c of file.crossings)for(let slot=0;slot<4;slot++)if(!(c.index===from&&slot===left[0]||c.index===to&&slot===right[0])&&[c.links[slot],c.directions[slot].target].some(ref=>ref!==NONE&&(ref&32768)&&remove.has(ref&32767)))fail('cestu používá další výjezd.');
  if(action==='edit-road'){
    const data=Buffer.from(source),forward=editSlot(data,from,left[0],to,request.forward??{}),reverse=editSlot(data,to,right[0],from,request.reverse??{});
    if(!forward&&!reverse){parseRoads(data);return {data,index:from,mapping:identity};}
    const compiled=compileRoadTopology(data,[from,to],removed.map(ref=>ref&32767));validateRoutes(parseRoads(compiled.data));
    return {data:compiled.data,index:from,mapping:compiled.mapping};
  }
  const nodeMap=[];rows.nodes=rows.nodes.filter((_,i)=>{nodeMap[i]=remove.has(i)?null:undefined;return !remove.has(i);});let next=0;for(let i=0;i<count;i++)if(!remove.has(i))nodeMap[i]=next++;
  const data=serialize(rows.crossings,rows.nodes);
  for(const [cross,slot] of [[from,left[0]],[to,right[0]]]){data.writeUInt16LE(NONE,atCross(cross)+20+slot*2);data.writeUInt16LE(NONE,atSlot(cross,slot));}
  const remap=ref=>{if(ref===NONE||!(ref&32768))return ref;const value=nodeMap[ref&32767];if(value===null)fail('neodpojený odkaz na odstraněný bod.');return 32768|value;};
  rewriteRefs(data,parseRoadsForRemap(data),remap);
  const compiled=compileRoadTopology(data,[from,to]);validateRoutes(parseRoads(compiled.data));
  return {data:compiled.data,index:from,mapping:identity.map(i=>i<total?i:nodeMap[i-total]===null?null:compiled.mapping[total+nodeMap[i-total]])};
}
// During compaction old references can temporarily exceed the new table count.
// The byte walk only needs the new record counts, before full parse validation.
function parseRoadsForRemap(data){
  const crossings=data.readUInt32LE(4),nodes=data.readUInt32LE(8+crossings*CROSS);
  return {crossings:Array.from({length:crossings},(_,index)=>({index})),nodes:Array.from({length:nodes},(_,index)=>({index}))};
}
