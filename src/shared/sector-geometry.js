// Validation uses quantised float32 coordinates, as stored by the engine.
const sub=(a,b)=>a.map((v,i)=>v-b[i]);
const dot=(a,b)=>a.reduce((n,v,i)=>n+v*b[i],0);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const fail=message=>{throw new Error(`4DS sektor: ${message}`);};
export const sameSectorValues=(a,b)=>Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&Array.from(a).every((v,i)=>Object.is(v,b[i]));
export function sectorCoordinates(values,min,max){
  if(!Array.isArray(values)||values.length%3||values.length/3<min||values.length/3>max||!Array.from(values).every(v=>typeof v==='number'&&Number.isFinite(v)&&Number.isFinite(Math.fround(v))))fail('neplatné souřadnice nebo počet vrcholů.');
  return values.map(Math.fround);
}
function vertices(positions){return Array.from({length:positions.length/3},(_,i)=>positions.slice(i*3,i*3+3));}
function tolerance(positions){return Math.max(1e-5,positions.reduce((n,v)=>Math.max(n,Math.abs(v)),0)*2**-23*4);}
export function sectorVolume(positions,indices){
  positions=sectorCoordinates(positions,4,65536);const v=vertices(positions);
  if(!Array.isArray(indices)||indices.length<12||indices.length%3||indices.length>196608||!Array.from(indices).every(i=>Number.isInteger(i)&&i>=0&&i<v.length))fail('neplatné trojúhelníky.');
  // Avoid unbounded quadratic convexity checks on untrusted UI requests.
  if(v.length*indices.length/3>4000000)fail('objem je příliš složitý pro kontrolu konvexity.');
  const edges=new Map(),used=new Set(indices),hull=[...used].map(i=>v[i]),eps=tolerance(positions);let volume=0;
  for(let i=0;i<indices.length;i+=3){
    const ids=indices.slice(i,i+3),[a,b,c]=ids.map(id=>v[id]),n=cross(sub(b,a),sub(c,a)),size=Math.hypot(...n);
    if(new Set(ids).size!==3||size<1e-12)fail('trojúhelník má nulovou plochu.');
    for(const [first,second]of [[ids[0],ids[1]],[ids[1],ids[2]],[ids[2],ids[0]]]){const key=first<second?`${first}/${second}`:`${second}/${first}`,edge=edges.get(key)??{count:0,direction:0};edge.count++;edge.direction+=first<second?1:-1;edges.set(key,edge);}
    for(const p of hull)if(dot(n,sub(p,a))/size < -eps)fail('sektor musí být konvexní a mít všechny plochy orientované dovnitř.');
    // Use a nearby reference so large world coordinates do not cancel volume.
    volume+=dot(sub(a,v[0]),cross(sub(b,v[0]),sub(c,v[0])))/6;
  }
  // Original sectors often retain additional vertices not used by volume
  // triangles (including portal points). Preserve them; they are not holes.
  if([...edges.values()].some(e=>e.count!==2||e.direction!==0))fail('sektor musí být uzavřený bez nesouhlasných hran.');
  if(Math.abs(volume)<1e-10)fail('sektor musí mít nenulový objem.');
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];for(const p of v)for(let i=0;i<3;i++){min[i]=Math.min(min[i],p[i]);max[i]=Math.max(max[i],p[i]);}
  return {positions,indices:[...indices],bounds:[...min,...max]};
}
export function portalPolygon(positions){
  positions=sectorCoordinates(positions,3,8);const v=vertices(positions),eps=tolerance(positions);
  if(new Set(v.map(p=>p.join('/'))).size!==v.length)fail('portál má opakované vrcholy.');
  let n;
  for(let i=1;i<v.length-1;i++){const candidate=cross(sub(v[i],v[0]),sub(v[i+1],v[0])),size=Math.hypot(...candidate);if(size>1e-12){n=candidate.map(x=>x/size);break;}}
  if(!n)fail('portál má nulovou plochu.');
  for(const p of v)if(Math.abs(dot(n,sub(p,v[0])))>eps)fail('vrcholy portálu musí ležet v jedné rovině.');
  // Every other point must be on the inside of every directed polygon edge.
  // This rejects concavity, self intersections and reversed partial ordering.
  for(let i=0;i<v.length;i++){const edge=sub(v[(i+1)%v.length],v[i]),size=Math.hypot(...edge);if(size<1e-10)fail('portál má nulovou hranu.');for(const p of v)if(dot(cross(edge,sub(p,v[i])),n)/size < -eps)fail('portál musí být konvexní s vrcholy seřazenými po obvodu.');}
  // The reference engine rebuilds its world plane from last/first/second.
  // Start a changed polygon at a genuine corner, keeping winding and shape.
  const corner=v.findIndex((p,i)=>Math.hypot(...cross(sub(p,v[(i+v.length-1)%v.length]),sub(v[(i+1)%v.length],p)))>1e-12);
  if(corner<0)fail('portál nemá nenulový roh.');
  positions=[...v.slice(corner),...v.slice(0,corner)].flat();
  const plane=[...n,-dot(n,v[0])].map(Math.fround);if(!plane.every(Number.isFinite))fail('rovinu portálu nelze uložit do float32.');
  return {positions,plane};
}
