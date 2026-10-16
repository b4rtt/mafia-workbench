import {ShapeUtils,Vector2} from 'three';
import {osmNavigationElevation} from './navigation-elevation.js';

const fail=m=>{throw Error('OpenStreetMap · usazení domu: '+m);};
const signed=r=>r.reduce((s,a,i)=>{const b=r[(i+1)%r.length];return s+a[0]*b[1]-b[0]*a[1];},0)/2;
function inside(r,p){let yes=false;for(let i=0,j=r.length-1;i<r.length;j=i++)if((r[i][1]>p[1])!==(r[j][1]>p[1])&&p[0]<(r[j][0]-r[i][0])*(p[1]-r[i][1])/(r[j][1]-r[i][1])+r[i][0])yes=!yes;return yes;}

// A horizontal building base over the exact triangular terrain. Extrema of
// the clipped piecewise-linear field occur on boundary cuts or grid vertices,
// including vertices inside the footprint, but excluding courtyard interiors.
// This is internal until the importer publishes foundations with their houses.
export function osmBuildingSupport(surface,area,polygon,offset){
  const terrain=osmNavigationElevation(surface);if(!terrain)return null;
  const field=terrain.field;
  if(['latitude','longitude','size'].some(k=>area?.[k]!==field.area[k]))fail('výškový podklad patří jiné oblasti.');
  if(!Number.isFinite(offset)||offset<0||offset>5)fail('nad terénem je podporovaný nezáporný odstup 0–5 m.');
  if(!Array.isArray(polygon)||!polygon.length||polygon.length>32||polygon.some(r=>!Array.isArray(r)||r.length<3||r.length>256||r.some(p=>!Array.isArray(p)||p.length!==2||p.some(n=>!Number.isFinite(n)))))fail('neplatný půdorys.');
  const rings=polygon.map((r,i)=>{
    const copy=r.map(p=>{const v=terrain.point([p[0],0,p[1]],0);return [v[0],v[2]];});
    if(copy[0].every((v,k)=>v===copy.at(-1)[k]))copy.pop();
    if(copy.length<3||Math.abs(signed(copy))<1e-8)fail('nulová plocha půdorysu.');
    if((signed(copy)>0)!==(i===0))copy.reverse();return copy;
  });
  const profiles=rings.map(r=>r.flatMap((a,i)=>field.splitEdge(a,r[(i+1)%r.length]).slice(0,-1).map(c=>[c.point[0],field.heightAt(...c.point),c.point[1]])));
  if(profiles.reduce((s,r)=>s+r.length,0)>8000)return {reason:'Půdorys má příliš mnoho terénních řezů pro jeden sokl.'};
  const heights=profiles.flatMap(r=>r.map(p=>p[1]));
  for(const z of field.z)for(const x of field.x)if(inside(rings[0],[x,z])&&!rings.slice(1).some(r=>inside(r,[x,z])))heights.push(field.heightAt(x,z));
  const minimum=Math.min(...heights),maximum=Math.max(...heights),ground=Math.fround(maximum+offset+.01);
  if(ground-minimum>3)return {reason:'Sokl by přesáhl 3 m; svah vyžaduje ruční terasování nebo jiný dům.'};
  const texture=surface.model?.materials?.[2]?.texture;
  if(typeof texture!=='string'||!/^([\x20-\x7e]+)\.bmp$/i.test(texture)||/[\\/:*?"<>|]/.test(texture)||texture.length>120)fail('chybí BMP materiál soklu z obrubníku.');
  return {version:1,ground,minimum,maximum,relief:maximum-minimum,offset,embed:.03,texture:'maps/'+texture,polygon:rings,profiles};
}

// World-space foundation, or translated into the unrotated shell's origin.
// Native models remain rigid. No cap fills a concavity or a courtyard hole.
export function osmBuildingFoundation(support,origin=[0,0,0]){
  if(support?.version!==1||!Array.isArray(support.profiles)||!support.profiles.length||support.profiles.length>32||support.profiles.reduce((n,r)=>n+(Array.isArray(r)?r.length:8001),0)>8000||support.profiles.some(r=>r.length<3||r.some(p=>!Array.isArray(p)||p.length!==3||p.some(n=>!Number.isFinite(n))||p[1]>=support.ground))||!Array.isArray(support.polygon)||support.polygon.length!==support.profiles.length||support.polygon.some(r=>!Array.isArray(r)||r.length<3||r.length>256||r.some(p=>!Array.isArray(p)||p.length!==2||p.some(n=>!Number.isFinite(n))))||!Number.isFinite(support.ground)||support.embed!==.03||typeof support.texture!=='string'||!/^maps\/[\x20-\x7e]+\.bmp$/i.test(support.texture)||/[\\/:*?"<>|]/.test(support.texture.slice(5))||!Array.isArray(origin)||origin.length!==3||origin.some(n=>!Number.isFinite(n)))fail('neplatný profil soklu.');
  const positions=[],normals=[],uv=[],indices=[];
  function triangle(points,tex){
    const p=points.map(v=>v.map((n,k)=>Math.fround(n-origin[k]))),[a,b,c]=p,u=b.map((n,k)=>n-a[k]),v=c.map((n,k)=>n-a[k]),normal=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],length=Math.hypot(...normal);
    if(length<1e-8)return;if(positions.length/3+3>60000)fail('sokl překračuje 60 000 vrcholů.');
    const at=positions.length/3;positions.push(...p.flat());normals.push(...Array(3).fill(normal.map(n=>Math.fround(n/length))).flat());uv.push(...tex.flat().map(Math.fround));indices.push(at,at+1,at+2);
  }
  for(const ring of support.profiles){let distance=0;for(let i=0;i<ring.length;i++){
    const a=ring[i],b=ring[(i+1)%ring.length],end=distance+Math.hypot(b[0]-a[0],b[2]-a[2]),lowA=a[1]-support.embed,lowB=b[1]-support.embed;
    const p=[[a[0],lowA,a[2]],[a[0],support.ground,a[2]],[b[0],lowB,b[2]],[b[0],support.ground,b[2]]],t=[[distance,support.ground-lowA],[distance,0],[end,support.ground-lowB],[end,0]];
    for(const ids of [[0,1,2],[2,1,3]])triangle(ids.map(j=>p[j]),ids.map(j=>t[j]));distance=end;
  }}
  const rings=support.polygon.map(r=>r.map(p=>new Vector2(...p))),vertices=rings.flat();
  for(let ids of ShapeUtils.triangulateShape(rings[0],rings.slice(1))){let p=ids.map(i=>vertices[i]);if((p[1].x-p[0].x)*(p[2].y-p[0].y)-(p[1].y-p[0].y)*(p[2].x-p[0].x)>0)p=[p[0],p[2],p[1]];triangle(p.map(v=>[v.x,support.ground,v.y]),p.map(v=>[v.x,v.y]));}
  return {version:29,materials:[{flags:0x00840001,ambient:[1,1,1],diffuse:[1,1,1],emission:[0,0,0],opacity:1,texture:support.texture.slice(5)}],meshes:[{id:1,name:'OSM_FOUNDATION',type:1,visual:0,renderFlags:0,logicFlags:0x2a,culling:9,parent:0,position:[0,0,0],rotation:[1,0,0,0],scale:[1,1,1],lods:[{distance:0,vertices:positions.length/3,positions,normals,uv,faces:[{material:1,indices}]}]}],animated:0};
}

export const osmFoundationVertices=support=>new Set(osmBuildingFoundation(support).meshes.flatMap(m=>{const p=m.lods[0].positions;return Array.from({length:p.length/3},(_,i)=>p.slice(i*3,i*3+3).join('/'));})).size;
