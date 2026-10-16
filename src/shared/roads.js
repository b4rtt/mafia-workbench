export function roadReference(value) {
  return value===65535?'Bez vazby':value&32768?`Bod ${value&32767}`:`Křižovatka ${value}`;
}
// Physical adjacency survives a disabled traffic direction in original files.
// A broken or cyclic chain is not offered as an editable connection.
export function roadConnections(file,index){
  const crossing=file.crossings[index];if(!crossing)return [];
  return crossing.links.flatMap((ref,slot)=>{
    const seen=new Set();let previous=index;
    while(ref!==65535&&(ref&32768)){
      if(seen.has(ref))return [];seen.add(ref);
      const node=file.nodes[ref&32767];if(!node||node.previous!==previous&&node.next!==previous)return [];
      const next=node.previous===previous?node.next:node.previous;previous=ref;ref=next;
    }
    return ref!==65535&&ref!==index&&file.crossings[ref]? [{slot,target:ref,nodes:[...seen],enabled:crossing.directions[slot].target===ref&&crossing.directions[slot].lanes.some(l=>l.type)}]:[];
  });
}
export function roadSettingsPair(file,from,slot){
  const forward=roadConnections(file,from).find(link=>link.slot===slot);if(!forward)return null;
  const reverse=roadConnections(file,forward.target).filter(link=>link.target===from&&link.nodes.length===forward.nodes.length&&link.nodes.every((ref,i)=>ref===forward.nodes[forward.nodes.length-1-i]));
  if(reverse.length!==1)return null;
  return {to:forward.target,fromSlot:slot,forward:{...file.crossings[from].directions[slot],enabled:forward.enabled},reverse:{...file.crossings[forward.target].directions[reverse[0].slot],enabled:reverse[0].enabled}};
}
export function roadGraph(file) {
  const total=file.crossings.length,points=[],target=value=>value&32768?total+(value&32767):value;
  let linkCount=0;
  for(const [section,records] of [['crossings',file.crossings],['nodes',file.nodes]]) for(const record of records) {
    const links=(section==='crossings'?record.links:[record.previous,record.next]).filter(value=>value!==65535).map(value=>({index:linkCount++,target:target(value),type:0}));
    points.push({index:points.length,position:[...record.position],type:section==='crossings'?1:2,section,recordIndex:record.index,links});
  }
  return {points,linkCount,editable:true};
}
export function roadEntries(file,section,index) {
  const record=file[section][index],context=`${section==='crossings'?'Křižovatka':'Bod'} ${index}`;
  const entry=(field,label,kind,value,where=context)=>({id:`${section}/${index}/${field}`,context:where,label,kind,value});
  const result=[entry('position','Pozice XYZ','vec3',record.position),entry('speed','Rychlost (herní jednotky)','float',record.speed)];
  if(section==='crossings') {
    result.push(entry('semaphore','Příznak semaforu (raw)','uint8',record.semaphore));
    record.directions.forEach((direction,slot)=>{
      const where=`${context} / Směr ${slot} → ${roadReference(direction.target)}`;
      result.push(entry(`directions/${slot}/priority`,'Priorita (raw)','uint32',direction.priority,where));
      direction.lanes.forEach((lane,i)=>result.push(entry(`directions/${slot}/lanes/${i}/type`,`Pruh ${i} · typ / příznaky (raw)`,'uint8',lane.type,where)));
    });
  }
  return result;
}

// Read-only plan shared by the dialog and writer. A junction can disappear only
// when its two physical legs describe one continuous, reciprocal road.
export function roadDissolvePlan(file,index){
  const fail=message=>{throw new Error('Road: '+message);},source=file.crossings[index];
  if(!Number.isInteger(index)||!source)fail('křižovatka je mimo síť.');
  if(file.nodes.length>=32767)fail('síť už má maximální počet silničních bodů.');
  const legs=roadConnections(file,index);
  if(source.links.filter(ref=>ref!==65535).length!==2||legs.length!==2||legs[0].target===legs[1].target)fail('spojení vyžaduje právě dvě cesty ke dvěma různým křižovatkám.');
  const [left,right]=legs,from=left.target,to=right.target,owned=new Set();
  const checkDirection=(cross,slot,target)=>{
    const direction=file.crossings[cross].directions[slot];
    if(direction.target!==65535&&(direction.target!==target||!direction.lanes.some(l=>l.type)||direction.lanes.some(l=>l.type&&!Number.isFinite(l.distance))))fail('směr má neplatný cíl, posun nebo žádný aktivní pruh.');
    return {...direction,enabled:direction.target!==65535};
  };
  const outer=legs.map(leg=>{
    const matches=roadConnections(file,leg.target).filter(back=>back.target===index&&back.nodes.length===leg.nodes.length&&back.nodes.every((ref,i)=>ref===leg.nodes[leg.nodes.length-1-i]));
    if(matches.length!==1)fail('cesta nemá jednoznačný vzájemný řetězec.');
    for(const ref of leg.nodes){
      if(owned.has(ref))fail('cesty sdílejí silniční bod.');owned.add(ref);
      const n=file.nodes[ref&32767];
      if(n.previousCrossing===n.nextCrossing||![index,leg.target].includes(n.previousCrossing)||![index,leg.target].includes(n.nextCrossing))fail('bod má jiné vlastníky cesty.');
    }
    return matches[0];
  });
  const pairs=[[checkDirection(from,outer[0].slot,index),checkDirection(index,right.slot,to)],[checkDirection(to,outer[1].slot,index),checkDirection(index,left.slot,from)]];
  for(const [a,b]of pairs){
    if(a.enabled!==b.enabled)fail('povolené směry na sebe nenavazují; nejprve upravte pruhy a směry obou cest.');
    if(a.enabled&&a.lanes.some((lane,i)=>lane.type!==b.lanes[i].type||lane.type&&!Object.is(lane.distance,b.lanes[i].distance)))fail('aktivní pruhy na sebe nenavazují; nejprve sjednoťte jejich typy a boční posuny.');
  }
  for(const cross of file.crossings)for(let slot=0;slot<4;slot++){
    const permitted=cross.index===index&&(slot===left.slot||slot===right.slot)||cross.index===from&&slot===outer[0].slot||cross.index===to&&slot===outer[1].slot;
    if(!permitted&&[cross.links[slot],cross.directions[slot].target].some(ref=>ref===index||owned.has(ref)))fail('křižovatku nebo cestu používá další výjezd.');
    if(cross.index===index&&!permitted&&cross.directions[slot].target!==65535)fail('nepoužitý výjezd má uložený cíl.');
  }
  for(const node of file.nodes)if(!owned.has(32768|node.index)&&[node.previous,node.next,node.previousCrossing,node.nextCrossing].some(ref=>ref===index||owned.has(ref)))fail('křižovatku nebo cestu používá jiný silniční bod.');
  const chain=[...left.nodes].reverse().concat(index,right.nodes);
  const position=ref=>ref&32768?file.nodes[ref&32767].position:file.crossings[ref].position;
  return {index,from,to,fromSlot:outer[0].slot,toSlot:outer[1].slot,chain,positions:[file.crossings[from].position,...chain.map(position),file.crossings[to].position],forwardEnabled:pairs[0][0].enabled,reverseEnabled:pairs[1][0].enabled};
}

// Collapse one reciprocal link into its destination junction. All remaining
// legs must be exclusive chains; no incoming reference may disappear silently.
export function roadMergePlan(file,from,to){
  const fail=message=>{throw new Error('Road: '+message);};
  if(!Number.isInteger(from)||!Number.isInteger(to)||!file.crossings[from]||!file.crossings[to])fail('křižovatka je mimo síť.');
  if(from===to)fail('vyberte dvě různé křižovatky.');
  const owned=new Map(),permitted=new Set(),legs=[];
  for(const index of [from,to]){
    const cross=file.crossings[index],connections=roadConnections(file,index);
    if(connections.length!==cross.links.filter(ref=>ref!==65535).length)fail('křižovatka má neúplnou nebo cyklickou cestu.');
    for(let slot=0;slot<4;slot++)if(cross.links[slot]===65535&&cross.directions[slot].target!==65535)fail('nepoužitý výjezd má uložený cíl.');
    for(const leg of connections){
      const reverse=roadConnections(file,leg.target).filter(back=>back.target===index&&back.nodes.length===leg.nodes.length&&back.nodes.every((ref,i)=>ref===leg.nodes[leg.nodes.length-1-i]));
      if(reverse.length!==1)fail('cesta nemá jednoznačný vzájemný řetězec.');
      const back=reverse[0],key=[`${index}/${leg.slot}`,`${leg.target}/${back.slot}`].sort().join(':');
      for(const [c,s,target]of [[index,leg.slot,leg.target],[leg.target,back.slot,index]]){
        const d=file.crossings[c].directions[s];permitted.add(`${c}/${s}`);
        if(d.target!==65535&&(d.target!==target||!d.lanes.some(l=>l.type)||d.lanes.some(l=>l.type&&!Number.isFinite(l.distance))))fail('směr má neplatný cíl, posun nebo žádný aktivní pruh.');
      }
      for(const ref of leg.nodes){
        if(owned.has(ref)&&owned.get(ref)!==key)fail('cesty sdílejí silniční bod.');owned.set(ref,key);
        const n=file.nodes[ref&32767];
        if(n.previousCrossing===n.nextCrossing||![index,leg.target].includes(n.previousCrossing)||![index,leg.target].includes(n.nextCrossing))fail('bod má jiné vlastníky cesty.');
      }
      legs.push({...leg,from:index,backSlot:back.slot});
    }
  }
  const connectors=legs.filter(l=>l.from===from&&l.target===to);
  if(connectors.length!==1)fail('sloučení vyžaduje právě jednu společnou cestu.');
  const connector=connectors[0],moved=legs.filter(l=>l.from===from&&l.target!==to),retained=legs.filter(l=>l.from===to&&l.target!==from);
  if(moved.length+retained.length>4)fail('spojená křižovatka by měla více než čtyři výjezdy.');
  for(const leg of [...moved,...retained])if(!leg.nodes.length)fail('navazující cesta potřebuje alespoň jeden silniční bod.');
  for(const leg of moved){
    const positions=[file.crossings[to].position,...leg.nodes.map(ref=>file.nodes[ref&32767].position),file.crossings[leg.target].position];
    for(let i=1;i<positions.length;i++)if(positions[i][0]===positions[i-1][0]&&positions[i][2]===positions[i-1][2])fail('po sloučení by úsek neměl nenulový směr v XZ.');
  }
  for(const cross of file.crossings)for(let slot=0;slot<4;slot++)if(!permitted.has(`${cross.index}/${slot}`)&&[cross.links[slot],cross.directions[slot].target].some(ref=>ref===from||ref===to||owned.has(ref)))fail('křižovatku nebo cestu používá další výjezd.');
  for(const n of file.nodes)if(!owned.has(32768|n.index)&&[n.previous,n.next,n.previousCrossing,n.nextCrossing].some(ref=>ref===from||ref===to||owned.has(ref)))fail('křižovatku nebo cestu používá jiný silniční bod.');
  return {from,to,connector,moved,retained};
}
