import clipping from 'polygon-clipping';

const fail=m=>{throw Error('OpenStreetMap · oblouky dopravy: '+m);};
const gap=(a,b)=>Math.hypot(b[0]-a[0],b[2]-a[2]);
const cross=(a,b)=>a[0]*b[2]-a[2]*b[0];
const unit=(a,b)=>{const l=gap(a,b);if(l<.001)fail('body jsou příliš blízko.');return [(b[0]-a[0])/l,0,(b[2]-a[2])/l];};
const mix=(a,b,t)=>a.map((v,i)=>v+(b[i]-v)*t);
const area=polys=>polys.reduce((s,p)=>s+p.reduce((s,r,i)=>s+(i?-1:1)*Math.abs(r.slice(1).reduce((s,b,j)=>s+r[j][0]*b[1]-b[0]*r[j][1],0)/2),0),0);
function simplified(chain){
  const result=[];for(const p of chain){result.push(p);while(result.length>2){const [a,b,c]=result.slice(-3),u=unit(a,b),v=unit(b,c);if(Math.abs(cross(u,v))>1e-6||u[0]*v[0]+u[2]*v[2]<0)break;result.splice(-2,1);}}return result;
}
function fillet(A,B,u,v,radius){
  const den=cross(u,v),angle=Math.acos(Math.max(-1,Math.min(1,u[0]*v[0]+u[2]*v[2])));
  if(angle>Math.PI-.01)fail('obrat o 180° nelze zaoblit.');
  if(angle<1e-5){if(gap(A,B)>.001)fail('přímé pokračování mění boční polohu pruhu.');return {incoming:0,outgoing:0,angle,points:[A]};}
  const difference=B.map((n,k)=>n-A[k]),t=cross(difference,v)/den,s=cross(difference,u)/den,p=A.map((n,k)=>n+u[k]*t),inset=radius*Math.tan(angle/2),start=p.map((n,k)=>n-u[k]*inset),end=p.map((n,k)=>n+v[k]*inset),sign=Math.sign(den),centre=[start[0]-sign*u[2]*radius,0,start[2]+sign*u[0]*radius],theta=Math.atan2(start[2]-centre[2],start[0]-centre[0]),count=Math.max(2,Math.ceil(angle*radius/.5));
  return {incoming:inset-t,outgoing:inset+s,angle,points:Array.from({length:count+1},(_,j)=>j===0?start:j===count?end:[centre[0]+radius*Math.cos(theta+sign*angle*j/count),0,centre[2]+radius*Math.sin(theta+sign*angle*j/count)])};
}
// Separate directional axes and explicit tangent connectors. This edits only
// native navigation; the mapped street surface is never enlarged to fit it.
// Full-body containment is a sampled geometric gate, not steering simulation.
export function osmTrafficTurns(plan,surface,traffic,radius,envelopes){
  if(!plan.flat||surface.elevation)fail('oblouky zatím vyžadují rovinný podklad.');
  if(!surface.footprints?.road?.length||!Number.isFinite(radius)||radius<5||radius>12||!envelopes?.length)fail('chybí povrch, rozměry aut nebo poloměr 5–12 m.');
  const bounds={min:[Math.min(...envelopes.map(b=>b.min[0])),Math.min(...envelopes.map(b=>b.min[1]))],max:[Math.max(...envelopes.map(b=>b.max[0])),Math.max(...envelopes.map(b=>b.max[1]))]},corners=[[bounds.min[0],bounds.min[1]],[bounds.max[0],bounds.min[1]],[bounds.max[0],bounds.max[1]],[bounds.min[0],bounds.max[1]]];
  const legs=plan.crossings.map(()=>({incoming:[],outgoing:[]})),chains=[],turns=[],crossings=[],roads=[];
  for(const [i,r]of plan.roads.entries())for(const reverse of [false,true])if(reverse?r.reverse:r.forward){
    const ordered=simplified([plan.crossings[r.from].position,...r.positions,plan.crossings[r.to].position]);if(reverse)ordered.reverse();
    const shift=r.forward&&r.reverse?surface.profiles[i].width/4:0;
    const offset=ordered.map((p,j)=>{
      const before=unit(ordered[Math.max(0,j-1)],ordered[j===0?1:j]),after=unit(ordered[j===ordered.length-1?j-1:j],ordered[Math.min(ordered.length-1,j+1)]),a=[p[0]+before[2]*shift,0,p[2]-before[0]*shift],b=[p[0]+after[2]*shift,0,p[2]-after[0]*shift],den=cross(before,after);
      if(Math.abs(den)<1e-6){if(before[0]*after[0]+before[2]*after[2]<0)fail(`ulice ${r.way} se obrací zpět.`);return a;}
      const t=cross(b.map((n,k)=>n-a[k]),after)/den;if(Math.abs(t)>surface.profiles[i].width*2)fail(`příliš ostrý boční posun ulice ${r.way}.`);return a.map((n,k)=>n+before[k]*t);
    });
    const curves=offset.map((p,j)=>j===0||j===offset.length-1?{incoming:0,outgoing:0,points:[p]}:fillet(p,p,unit(offset[j-1],p),unit(p,offset[j+1]),radius));
    const item={road:i,reverse,offset,curves,ambient:(reverse?traffic.roads[i].reverseLanes:traffic.roads[i].forwardLanes)[0].type===2,way:r.way,tags:r.tags,insetStart:.25,insetEnd:.25};chains.push(item);legs[reverse?r.to:r.from].outgoing.push(item);legs[reverse?r.from:r.to].incoming.push(item);
  }
  for(const [i,items]of legs.entries())for(const a of items.incoming)for(const b of items.outgoing)if(a.road!==b.road){
    const A=a.offset.at(-1),B=b.offset[0],f=fillet(A,B,unit(a.offset.at(-2),A),unit(B,b.offset[1]),radius);
    if(f.incoming<-.001||f.outgoing<-.001)fail(`oblouk u křižovatky ${i} by mířil proti jízdnímu směru.`);
    turns.push({a,b,...f,crossing:i});a.insetEnd=Math.max(a.insetEnd,f.incoming);b.insetStart=Math.max(b.insetStart,f.outgoing);
  }
  const port=p=>{crossings.push({id:'traffic-port-'+crossings.length,position:p.map(Math.fround)});return crossings.length-1;};
  const connect=(from,to,points,source,ambient,kind,curves)=>{
    const chain=[crossings[from].position,...points.map(p=>p.map(Math.fround)),crossings[to].position].filter((p,i,all)=>!i||gap(p,all[i-1])>.001),positions=[];
    for(let j=1;j<chain.length;j++){const a=chain[j-1],b=chain[j],steps=Math.ceil(gap(a,b)/2);for(let n=1;n<=steps;n++)if(j<chain.length-1||n<steps)positions.push(mix(a,b,n/steps).map(Math.fround));}
    if(!positions.length)positions.push(mix(chain[0],chain.at(-1),.5).map(Math.fround));
    // Keep the original turn span: local angles on a sampled wide arc can all
    // fall below 30 degrees, even though the complete mapped turn is sharp.
    const cornerPaths=curves.filter(f=>f.angle>=Math.PI/6-1e-8).map(f=>f.points.map(p=>p.map(Math.fround)));
    roads.push({from,to,positions,forward:true,reverse:false,way:source.way,tags:source.tags,sourceRoad:source.road,sourceReverse:source.reverse,ambient,kind,cornerPaths});
  };
  for(const a of chains){
    const lengths=a.offset.slice(1).map((p,i)=>gap(a.offset[i],p));a.curves[0].outgoing=a.insetStart;a.curves.at(-1).incoming=a.insetEnd;
    if(lengths.some((length,i)=>a.curves[i].outgoing+a.curves[i+1].incoming>=length-.01))fail(`poloměr ${radius} m se nevejde mezi ohyby ulice ${a.tags.name??a.way}. Zmenšete poloměr nebo upravte výběr ulic.`);
    const curves=a.curves.slice(1,-1),start=mix(a.offset[0],a.offset[1],a.insetStart/lengths[0]),end=mix(a.offset.at(-1),a.offset.at(-2),a.insetEnd/lengths.at(-1));a.start=port(start);a.end=port(end);connect(a.start,a.end,curves.flatMap(f=>f.points),a,a.ambient,'street',curves);
  }
  for(const t of turns)connect(t.a.end,t.b.start,t.points,t.a,t.a.ambient&&t.b.ambient,'turn',[t]);
  if(crossings.length>1024||roads.reduce((n,r)=>n+r.positions.length,0)>4096)fail('oblouky překračují limit 1024 křižovatek nebo 4096 jízdních bodů; zmenšete výběr.');
  const degree=new Uint8Array(crossings.length);for(const r of roads){degree[r.from]++;degree[r.to]++;}if(degree.some(n=>n>4))fail('vzniklo napojení s více než čtyřmi výjezdy.');
  let poses=0;for(const r of roads)if(r.ambient){
    const chain=[crossings[r.from].position,...r.positions,crossings[r.to].position];
    for(let j=1;j<chain.length;j++){
      const a=chain[j-1],b=chain[j],v=unit(a,b),count=Math.max(1,Math.ceil(gap(a,b)/.5));
      for(let n=0;n<=count;n++){
        if(++poses>40000)fail('kontrola karoserie překračuje 40000 poloh; zmenšete výběr.');
        const p=mix(a,b,n/count),ring=corners.map(([x,z])=>[p[0]+x*v[2]+z*v[0],p[2]-x*v[0]+z*v[2]]);ring.push(ring[0]);
        if(area(clipping.difference([[ring]],surface.footprints.road))>.001)fail(`karoserie přesahuje asfalt na ulici ${r.tags.name??r.way} (${r.kind==='turn'?'odbočení':'jízdní osa'}). Upravte poloměr nebo zaoblení povrchu; rozměry města se automaticky nemění.`);
      }
    }
  }
  return {network:{flat:true,crossings,roads},turns:{radius,connectors:turns.length,axes:chains.length,bodyPoses:poses,bounds,sampleStep:.5}};
}
