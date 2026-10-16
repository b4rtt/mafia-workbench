import { roadConnections, roadSettingsPair } from './roads.js';

const fail=message=>{throw new Error(`Ulice: ${message}`);};
// One shared layout for the junction and both ends of its adjoining streets.
// The flat central surface stops before the first bend; slopes resume outside.
export function roadJunctionPlan(file,index,width,sidewalkWidth){
  const crossing=file?.crossings?.[index];
  if(!Number.isInteger(index)||!crossing||!Array.isArray(crossing.position)||crossing.position.length!==3||!crossing.position.every(n=>Number.isFinite(n)&&Math.abs(n)<=32768))fail('neplatná křižovatka.');
  const links=roadConnections(file,index);
  if(links.length<3||links.length>4||links.length!==crossing.links.filter(ref=>ref!==65535).length)fail('povrch křižovatky potřebuje tři nebo čtyři úplné výjezdy.');
  if(!Number.isFinite(width)||width<=0||!Number.isFinite(sidewalkWidth)||sidewalkWidth<=0)fail('neplatná šířka křižovatky.');
  const owned=new Set(),targets=new Set(),legs=links.map(link=>{
    if(!roadSettingsPair(file,index,link.slot)||targets.has(link.target))fail('výjezdy potřebují jednoznačné vzájemné cesty k různým křižovatkám.');
    targets.add(link.target);
    for(const ref of link.nodes){if(owned.has(ref))fail('výjezdy sdílejí silniční bod.');owned.add(ref);}
    const next=(link.nodes.length?file.nodes[link.nodes[0]&32767]:file.crossings[link.target])?.position;
    if(!Array.isArray(next)||next.length!==3||!next.every(n=>Number.isFinite(n)&&Math.abs(n)<=32768))fail('neplatný první bod výjezdu.');
    const dx=next[0]-crossing.position[0],dz=next[2]-crossing.position[2],length=Math.hypot(dx,dz);
    if(length<.01)fail('výjezd křižovatky nemá nenulový vodorovný směr.');
    return {...link,length,direction:[dx/length,dz/length],angle:Math.atan2(dz,dx)};
  }).sort((a,b)=>a.angle-b.angle);
  const gaps=legs.map((leg,i)=>(legs[(i+1)%legs.length].angle-leg.angle+Math.PI*2)%(Math.PI*2));
  if(gaps.some(gap=>gap<Math.PI/6-1e-6||gap>Math.PI+1e-6))fail('výjezdy musí obklopovat střed a svírat úhly 30° až 180°; upravte síť.');
  const outer=width/2+sidewalkWidth,setback=Math.max(outer,...gaps.map(gap=>outer/Math.tan(gap/2)))+1;
  if(legs.some(leg=>leg.length<setback+.1))fail('první bod nebo sousední křižovatka je příliš blízko; prodlužte přímé výjezdy nebo zmenšete šířku.');
  const point=(leg,offset)=>[crossing.position[0]+leg.direction[0]*setback+leg.direction[1]*offset,crossing.position[1],crossing.position[2]+leg.direction[1]*setback-leg.direction[0]*offset].map(Math.fround);
  const corners=gaps.map((gap,i)=>{
    const angle=legs[i].angle+gap/2,at=radius=>[crossing.position[0]+Math.cos(angle)*radius/Math.sin(gap/2),crossing.position[1],crossing.position[2]+Math.sin(angle)*radius/Math.sin(gap/2)].map(Math.fround);
    return {inner:at(width/2),outer:at(outer)};
  });
  return {center:[...crossing.position],setback,legs:legs.map(leg=>({...leg,center:point(leg,0),left:point(leg,-width/2),right:point(leg,width/2),outerLeft:point(leg,-outer),outerRight:point(leg,outer)})),corners};
}
