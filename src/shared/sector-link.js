import {Matrix4,Vector3} from 'three';
import {sectorVolume,portalPolygon} from './sector-geometry.js';

const fail=message=>{throw new Error(`Spojení sektorů: ${message}`);};
const points=p=>Array.from({length:p.length/3},(_,i)=>p.slice(i*3,i*3+3));
export function sectorWorldPoints(positions,matrix){const transform=new Matrix4().fromArray(matrix);return points(positions).flatMap(p=>new Vector3(...p).applyMatrix4(transform).toArray());}
function transform(sector){
  if(!Array.isArray(sector.worldMatrix)||sector.worldMatrix.length!==16||!sector.worldMatrix.every(Number.isFinite))fail('neplatná světová transformace.');
  const matrix=new Matrix4().fromArray(sector.worldMatrix);if(Math.abs(matrix.determinant())<1e-12)fail('transformace nemá bezpečnou inverzi.');return matrix;
}
function volume(sector){
  sectorVolume(sector.sector.positions,sector.sector.indices);const matrix=transform(sector),indices=[...sector.sector.indices];
  if(matrix.determinant()<0)for(let i=0;i<indices.length;i+=3)[indices[i+1],indices[i+2]]=[indices[i+2],indices[i+1]];
  return sectorVolume(sectorWorldPoints(sector.sector.positions,sector.worldMatrix),indices);
}
function boundary(hull,polygon,epsilon){
  const vertices=points(hull.positions),corners=points(polygon.positions);let supporting=false;
  for(let i=0;i<hull.indices.length;i+=3){const [a,b,c]=hull.indices.slice(i,i+3).map(id=>new Vector3(...vertices[id])),normal=b.sub(a).cross(c.sub(a)).normalize();
    const distances=corners.map(p=>normal.dot(new Vector3(...p).sub(a)));if(distances.some(d=>d < -epsilon))fail('portál leží mimo objem sektoru.');
    if(distances.every(d=>Math.abs(d)<=epsilon)&&normal.dot(new Vector3(...polygon.plane.slice(0,3)))>.9999)supporting=true;
  }
  if(!supporting)fail('portál musí ležet na společné hranici a směřovat dovnitř každého sektoru.');
}
function sameOpening(a,b,epsilon){const first=points(a),second=points(b);return first.length===second.length&&first.every(p=>second.some(q=>Math.hypot(...p.map((v,i)=>v-q[i]))<=epsilon));}
// Coplanar overlapping openings are ambiguous for the native geometric matcher.
// A separating-axis test allows neighbouring windows on the same wall.
function overlap(a,b,epsilon){
  const n=new Vector3(...a.plane.slice(0,3));if(Math.abs(n.dot(new Vector3(...b.plane.slice(0,3))))<.9999)return false;
  if(points(b.positions).some(p=>Math.abs(n.dot(new Vector3(...p))+a.plane[3])>epsilon))return false;
  const aa=points(a.positions).map(p=>new Vector3(...p)),bb=points(b.positions).map(p=>new Vector3(...p));
  for(const polygon of [aa,bb])for(let i=0;i<polygon.length;i++){const axis=polygon[(i+1)%polygon.length].clone().sub(polygon[i]).cross(n).normalize(),av=aa.map(p=>axis.dot(p)),bv=bb.map(p=>axis.dot(p));if(Math.min(...av)>=Math.max(...bv)-epsilon||Math.min(...bv)>=Math.max(...av)-epsilon)return false;}
  return true;
}
export function sectorLinkPlan(context,request){
  if(!request||Object.keys(request).some(k=>!['mesh','portal','target'].includes(k))||!Number.isInteger(request.mesh)||!Number.isInteger(request.portal)||!Number.isInteger(request.target))fail('neplatný výběr.');
  const source=context.sectors.find(s=>s.id===request.mesh),target=context.sectors.find(s=>s.id===request.target),original=source?.sector.portals[request.portal];
  if(!source||!target||source===target||!original)fail('vyberte portál a jiný sousední sektor.');
  const polygon=portalPolygon(sectorWorldPoints(original.positions,source.worldMatrix)),epsilon=Math.max(1e-4,...polygon.positions.map(v=>Math.abs(v)*2**-23*8));boundary(volume(source),polygon,epsilon);
  const reversed=portalPolygon(points(polygon.positions).reverse().flat());boundary(volume(target),reversed,epsilon);
  let existing=null;
  for(const sector of context.sectors)for(let index=0;index<sector.sector.portals.length;index++){
    if(sector===source&&index===request.portal)continue;let other;try{other=portalPolygon(sectorWorldPoints(sector.sector.portals[index].positions,sector.worldMatrix));}catch{continue;}
    if(!overlap(polygon,other,epsilon))continue;
    if(sector===target&&sameOpening(other.positions,polygon.positions,epsilon)&&new Vector3(...polygon.plane.slice(0,3)).dot(new Vector3(...other.plane.slice(0,3)))<-.9999&&existing===null)existing=index;
    else fail(`otvor se překrývá s portálem ${index+1} sektoru ${sector.name}; spojení by bylo nejednoznačné.`);
  }
  if(existing!==null)return {target:target.id,targetPortal:existing,already:true,worldPositions:reversed.positions};
  if(target.sector.portals.length>=255)fail('sousední sektor již má 255 portálů.');
  const inverse=transform(target).invert(),local=portalPolygon(points(reversed.positions).flatMap(p=>new Vector3(...p).applyMatrix4(inverse).toArray()));
  if(!sameOpening(sectorWorldPoints(local.positions,target.worldMatrix),reversed.positions,epsilon))fail('protikus nelze přesně uložit v souřadnicích sousedního sektoru.');
  return {target:target.id,targetPortal:target.sector.portals.length,positions:local.positions,worldPositions:reversed.positions,already:false};
}
