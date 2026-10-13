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
    return ref!==65535&&ref!==index&&file.crossings[ref]? [{slot,target:ref,enabled:crossing.directions[slot].target===ref&&crossing.directions[slot].lanes.some(l=>l.type)}]:[];
  });
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
