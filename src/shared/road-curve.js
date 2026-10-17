import {roadConnections,roadSettingsPair} from './roads.js';

const fail=message=>{throw Error('Road · oblouk: '+message);};
const length=(a,b)=>Math.hypot(a[0]-b[0],a[2]-b[2]);
// Replace one ordinary node, not a junction or neighbouring mapped bends.
// This is an explicit navigation edit; it never claims to fit a road surface.
export function roadCurvePlan(file,index,radius){
  const node=file.nodes[index],total=file.crossings.length,ref=32768|index;
  if(!Number.isInteger(index)||index<0||!node)fail('vyberte mezilehlý silniční bod.');
  const owners=[node.previousCrossing,node.nextCrossing];
  if(owners.some(i=>i===65535||i&32768||!file.crossings[i])||owners[0]===owners[1])fail('bod nemá dvě rozpoznané koncové křižovatky.');
  const routes=roadConnections(file,owners[0]).filter(r=>r.target===owners[1]&&r.nodes.includes(ref));
  if(routes.length!==1||!roadSettingsPair(file,owners[0],routes[0].slot))fail('bod nemá jednoznačnou vzájemnou cestu.');
  const refs=[node.previous,node.next],record=r=>r&32768?file.nodes[r&32767]:file.crossings[r];
  if(refs.some(r=>r===65535||r===ref||!record(r))||refs[0]===refs[1])fail('bod potřebuje dva různé sousedy.');
  for(const r of refs){const n=record(r),links=r&32768?[n.previous,n.next]:n.links;if(links.filter(v=>v===ref).length!==1)fail('sousední vazby nejsou jednoznačné.');}
  for(const c of file.crossings){if(c.directions.some(d=>d.target===ref)||c.links.some(v=>v===ref)&&!refs.includes(c.index))fail('bod používá další výjezd.');}
  for(const n of file.nodes)if(n.index!==index){
    if([n.previousCrossing,n.nextCrossing].includes(ref)||[n.previous,n.next].includes(ref)&&!refs.includes(32768|n.index))fail('bod používá další silniční vazba.');
  }
  const [a,b]=refs.map(r=>record(r).position),p=node.position,inLength=length(a,p),outLength=length(p,b);
  if(inLength<.02||outLength<.02)fail('sousední body jsou příliš blízko v XZ.');
  const u=[(p[0]-a[0])/inLength,(p[2]-a[2])/inLength],v=[(b[0]-p[0])/outLength,(b[2]-p[2])/outLength];
  const turn=Math.atan2(u[0]*v[1]-u[1]*v[0],u[0]*v[0]+u[1]*v[1]),angle=Math.abs(turn);
  if(angle<Math.PI/180||angle>Math.PI*175/180)fail('ohyb musí mít 1° až 175°; přímku nebo obrat nelze tímto nástrojem zaoblit.');
  const maxRadius=(Math.min(inLength,outLength)-.01)/Math.tan(angle/2);
  if(radius===undefined)radius=Math.min(6,maxRadius*.8);
  if(typeof radius!=='number'||!Number.isFinite(radius)||radius<.05||radius>maxRadius)fail(`poloměr musí být alespoň 0,05 m a nejvýše ${maxRadius.toFixed(3)} m; větší oblouk by přesáhl sousední body.`);
  const distance=radius*Math.tan(angle/2),entry=p.map((n,i)=>n+(a[i]-n)*distance/inLength),exit=p.map((n,i)=>n+(b[i]-n)*distance/outLength);
  const sign=Math.sign(turn),center=[entry[0]-u[1]*radius*sign,entry[2]+u[0]*radius*sign],start=Math.atan2(entry[2]-center[1],entry[0]-center[0]),steps=Math.max(2,Math.ceil(radius*angle/.75));
  if(steps>256||file.nodes.length+steps>32767)fail('oblouk překračuje limit 257 nových bodů nebo limit silniční sítě.');
  const positions=Array.from({length:steps+1},(_,i)=>{
    const t=i/steps,at=start+turn*t;return (i===0?entry:i===steps?exit:[center[0]+radius*Math.cos(at),entry[1]+(exit[1]-entry[1])*t,center[1]+radius*Math.sin(at)]).map(Math.fround);
  });
  const chain=[a,...positions,b];
  if(chain.some(p=>p.some(n=>!Number.isFinite(n)))||chain.slice(1).some((p,i)=>length(p,chain[i])<.001))fail('po převodu do float32 jsou body oblouku příliš blízko.');
  if(!Number.isFinite(node.speed)||node.speed<0)fail('vybraný bod nemá podporovanou nezápornou rychlost.');
  return {index,refs,owners,radius,maxRadius,angle,original:[a,p,b].map(p=>[...p]),positions,speed:node.speed,middle:Math.floor(steps/2),selection:total+index+Math.floor(steps/2)};
}
