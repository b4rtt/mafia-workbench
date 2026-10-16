import clipping from 'polygon-clipping';
import {ShapeUtils,Vector2} from 'three';
import {osmBuildingFootprints} from './footprints.js';

const fail=m=>{throw Error('OpenStreetMap · chodci: '+m);};
export function validateOsmPedestrians(o){
  if(!o||o.version!==1||!Number.isInteger(o.density)||o.density<1||o.density>100||!Number.isInteger(o.capacity)||o.capacity<1||o.capacity>20||!Array.isArray(o.models)||!o.models.length||o.models.length>16||new Set(o.models.map(m=>m?.path?.toLowerCase())).size!==o.models.length||o.models.some(m=>!/^models\/civil\d+\.4ds$/i.test(m?.path??'')||!/^civil\d+\.i3d$/i.test(m?.model??'')||m.path.slice(7,-4).toLowerCase()!==m.model.slice(0,-4).toLowerCase()||m.model.length>16||!/^[a-f0-9]{64}$/.test(m?.sha256??'')))fail('načtěte 1–16 civilních modelů; hustota je 1–100 a kapacita každého modelu 1–20.');
}
const snap=n=>Math.round(n*1000)/1000;
function capsule(a,b,r){
  const angle=Math.atan2(b[1]-a[1],b[0]-a[0]);
  // Circumscribed end caps retain at least r metres of clearance.
  const radius=r/Math.cos(Math.PI/16),ring=[];
  for(const [p,start]of [[b,angle-Math.PI/2],[a,angle+Math.PI/2]])for(let i=0;i<=8;i++)ring.push([p[0]+Math.cos(start+i*Math.PI/8)*radius,p[1]+Math.sin(start+i*Math.PI/8)*radius].map(snap));
  return [ring];
}
const area=ring=>Math.abs(ring.reduce((s,a,i)=>{const b=ring[(i+1)%ring.length];return s+a[0]*b[1]-a[1]*b[0];},0))/2;
// Generate only on actual raised sidewalks. Park paths and road crossings need
// explicit transitions and are deliberately not joined across missing ground.
export function osmPedestrianPlan(source,roads,surface,props=null){
  if(!surface?.footprints?.sidewalk?.length)fail('vybrané ulice nemají chodníky; zapněte povrchy a zvolte průchozí profil.');
  const blocks=osmBuildingFootprints(source).filter(b=>!b.suppressed&&!b.reason).flatMap(b=>b.polygons).concat((props?.placements??[]).map(p=>[p.footprint]));
  for(const [i,road]of roads.roads.entries()){
    const t=road.tags??{};
    if(t['foot:conditional']||t.foot&&!['yes','designated','permissive'].includes(t.foot)){
      const p=surface.profiles[i],chain=[roads.crossings[road.from].position,...road.positions,roads.crossings[road.to].position],r=p.width/2+Math.max(p.left,p.right)+.01;
      for(let n=1;n<chain.length;n++)blocks.push(capsule([chain[n-1][0],chain[n-1][2]],[chain[n][0],chain[n][2]],r));
    }
  }
  let walkable,safe;
  try{
    walkable=blocks.length?clipping.difference(surface.footprints.sidewalk,blocks):surface.footprints.sidewalk;
    const edges=[];for(const polygon of walkable)for(const ring of polygon)for(let i=1;i<ring.length;i++)if(Math.hypot(ring[i][0]-ring[i-1][0],ring[i][1]-ring[i-1][1])>.001)edges.push(capsule(ring[i-1],ring[i],.4));
    safe=edges.length?clipping.difference(walkable,clipping.union(edges)):[];
  }catch{fail('průchozí plochy nelze bezpečně spojit; zmenšete oblast nebo upravte osazení.');}
  const points=[],links=[],regions=[],used=new Map();
  const add=(p,y)=>{const v=[Math.fround(p[0]),y,Math.fround(p[1])],key=v.join('/');if(!used.has(key)){if(points.length>=8192)fail('síť přesahuje 8192 bodů; zmenšete oblast.');used.set(key,points.length);points.push(v);}return used.get(key);};
  const connect=(a,b)=>{if(a===b)return;const p=points[a],q=points[b],steps=Math.ceil(Math.hypot(p[0]-q[0],p[2]-q[2])/4);let prev=a;for(let n=1;n<=steps;n++){const next=n===steps?b:add([p[0]+(q[0]-p[0])*n/steps,p[2]+(q[2]-p[2])*n/steps],p[1]);if(prev!==next)links.push([prev,next]);prev=next;}};
  const y=Math.fround(surface.model.meshes.reduce((height,m)=>m.lods[0].positions.reduce((h,n,i)=>i%3===1?Math.max(h,n):h,height),-Infinity));
  for(const polygon of safe){
    if(area(polygon[0])-polygon.slice(1).reduce((s,r)=>s+area(r),0)<1)continue;
    const rings=polygon.map(r=>r.slice(0,-1).map(p=>new Vector2(...p))),vertices=rings.flat(),triangles=ShapeUtils.triangulateShape(rings[0],rings.slice(1)),portals=new Map(),centers=[];
    for(const ids of triangles){const p=ids.map(i=>vertices[i]);if(Math.abs((p[1].x-p[0].x)*(p[2].y-p[0].y)-(p[1].y-p[0].y)*(p[2].x-p[0].x))<1e-8){centers.push(null);continue;}centers.push(add([p.reduce((s,v)=>s+v.x,0)/3,p.reduce((s,v)=>s+v.y,0)/3],y));}
    const before=links.length;
    for(const [i,ids]of triangles.entries())if(centers[i]!==null)for(let n=0;n<3;n++){
      const a=ids[n],b=ids[(n+1)%3],key=[a,b].sort((a,b)=>a-b).join('/');
      if(portals.has(key)){const mid=add([(vertices[a].x+vertices[b].x)/2,(vertices[a].y+vertices[b].y)/2],y);connect(centers[i],mid);connect(portals.get(key),mid);}else portals.set(key,centers[i]);
    }
    if(links.length>before)regions.push(polygon);
  }
  const live=new Set(links.flat()),remap=new Map(),positions=[];for(const [i,p]of points.entries())if(live.has(i)){remap.set(i,positions.length);positions.push(p);}
  const unique=[...new Map(links.map(([a,b])=>[a<b?`${a}/${b}`:`${b}/${a}`,[remap.get(a),remap.get(b)]])).values()];
  if(!unique.length)fail('po odečtení hran a překážek nezbyla pěší trasa alespoň 1 m². Rozšiřte chodník nebo změňte osazení.');
  // Count actual graph components; degenerate triangulation slivers may split
  // one polygon into more than one navigable island.
  const neighbors=positions.map(()=>[]),visited=new Set();let components=0;
  for(const [a,b]of unique){neighbors[a].push(b);neighbors[b].push(a);}
  for(let i=0;i<positions.length;i++)if(!visited.has(i)){components++;const queue=[i];visited.add(i);while(queue.length)for(const n of neighbors[queue.pop()])if(!visited.has(n)){visited.add(n);queue.push(n);}}
  return {positions,links:unique,components,clearance:.4,radius:.1,regions};
}

export function osmPedestrianBytes(plan){
  const order=plan.positions.map((position,index)=>({position,index})).sort((a,b)=>a.position[0]-b.position[0]||a.index-b.index),index=new Map(order.map((p,i)=>[p.index,i])),adj=order.map(()=>new Set());
  for(const [a,b]of plan.links){adj[index.get(a)].add(index.get(b));adj[index.get(b)].add(index.get(a));}
  const bytes=Buffer.alloc(8+order.length*30+adj.reduce((n,l)=>n+l.size,0)*8);bytes.writeUInt32LE(0x01abcedf);bytes.writeUInt32LE(order.length,4);let at=8+order.length*30;
  for(const [i,p]of order.entries()){
    const start=8+i*30;p.position.forEach((n,k)=>bytes.writeFloatLE(n,start+k*4));bytes.writeUInt16LE(1,start+12);bytes.writeUInt16LE(i,start+14);bytes.writeUInt16LE(10,start+16);bytes[start+28]=adj[i].size;bytes[start+29]=adj[i].size;
    for(const target of [...adj[i]].sort((a,b)=>a-b)){bytes.writeUInt16LE(target,at);bytes.writeUInt16LE(1,at+2);bytes.writeFloatLE(Math.hypot(...p.position.map((n,k)=>n-order[target].position[k])),at+4);at+=8;}
  }
  return bytes;
}
