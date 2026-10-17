import clipping from 'polygon-clipping';
import {osmBuildingFootprints} from './footprints.js';
import {osmNavigationElevation} from './navigation-elevation.js';

const fail=m=>{throw Error('OpenStreetMap · přechody: '+m);};
const keys=['highway','crossing','crossing:signals','crossing:markings','crossing:markings:colour','crossing:island','crossing:continuous','traffic_calming','width','foot','foot:conditional','access','access:conditional','layer','bridge','tunnel'];
export function readOsmCrossings(data,nodes,project){
  const result=[];
  for(const row of data.elements)if(row.type==='node'&&row.tags?.highway==='crossing'){
    const tags={};for(const key of keys)if(Object.hasOwn(row.tags,key)){if(typeof row.tags[key]!=='string'||row.tags[key].length>1024)fail('neplatná značka bodu.');tags[key]=row.tags[key];}
    result.push({id:row.id,point:project(nodes.get(row.id)),tags});
  }
  if(result.length>512)fail('příliš mnoho přechodů; zmenšete oblast.');return result.sort((a,b)=>a.id-b.id);
}
const area=mp=>mp.reduce((sum,p)=>sum+p.reduce((s,r,i)=>s+(i?-1:1)*Math.abs(r.reduce((n,a,j)=>{const b=r[(j+1)%r.length];return n+a[0]*b[1]-b[0]*a[1];},0))/2,0),0);
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1];
const unit=(a,b)=>{const v=[b[0]-a[0],b[1]-a[1]],d=Math.hypot(...v);return d>.01?v.map(n=>n/d):null;};
const point=p=>[p[0],p[2]];
const level=t=>t.layer&&t.layer!=='0'||t.bridge&&t.bridge!=='no'||t.tunnel&&t.tunnel!=='no';
const allowed=t=>!t['foot:conditional']&&!t['access:conditional']&&(t.foot?['yes','designated','permissive'].includes(t.foot):!t.access||['yes','permissive','designated'].includes(t.access));
function nearest(chain,p){
  let best=null,before=0;for(let i=1;i<chain.length;i++){const a=chain[i-1],b=chain[i],v=[b[0]-a[0],b[1]-a[1]],length=Math.hypot(...v),u=Math.max(0,Math.min(1,dot([p[0]-a[0],p[1]-a[1]],v)/(length*length))),q=a.map((n,k)=>n+v[k]*u),distance=Math.hypot(q[0]-p[0],q[1]-p[1]);if(!best||distance<best.distance)best={distance,at:before+u*length,tangent:v.map(n=>n/length)};before+=length;}return {...best,length:before};
}
// A corridor adds navigation only on existing road/pavement triangles. It
// never supplies a bridge, crossing paint, kerb ramp or signal controller.
export function osmCrossingPlan(source,roads,surface,props=null){
  const placements=[],skipped=[],ground=clipping.union(surface.footprints.road,surface.footprints.sidewalk),half=source.area.size/2;
  const blocks=osmBuildingFootprints(source).filter(b=>!b.suppressed&&!b.reason).flatMap(b=>b.polygons).concat((props?.placements??[]).map(p=>[p.footprint]));
  const terrain=osmNavigationElevation(surface),heights=[];if(!terrain)for(const mesh of surface.model.meshes){const lod=mesh.lods[0];for(const face of lod.faces)if(face.material===1)for(const index of face.indices)heights.push(lod.positions[index*3+1]);}
  const roadHeight=terrain?terrain.levels.road:heights[0],walkHeight=terrain?terrain.levels.sidewalk:surface.model.meshes.reduce((h,m)=>m.lods[0].positions.reduce((h,n,i)=>i%3===1?Math.max(h,n):h,h),-Infinity);
  if(!terrain&&(!Number.isFinite(roadHeight)||heights.some(h=>h!==roadHeight)))fail('vozovka musí mít společnou rovinnou výšku.');
  const chains=roads.roads.map(r=>[roads.crossings[r.from].position,...r.positions,roads.crossings[r.to].position].map(point));
  for(const item of source.pedestrianCrossings??[]){
    const {id,tags:t}=item,p=point(item.point),skip=reason=>skipped.push({id,reason});
    if(p.some(n=>Math.abs(n)>half))continue;
    if(!allowed(t)||level(t)){skip('Omezený přístup nebo jiná výšková úroveň.');continue;}
    if(t['crossing:signals']&&t['crossing:signals']!=='no'||t.crossing==='traffic_signals'){skip('Semafory vyžadují řízení přechodu.');continue;}
    if(!['uncontrolled','unmarked','zebra'].includes(t.crossing)&&!(t['crossing:signals']==='no'&&(!t.crossing||['marked','uncontrolled','unmarked','zebra'].includes(t.crossing)))){skip('Není určený podporovaný neřízený přechod.');continue;}
    if(t['crossing:island']&&t['crossing:island']!=='no'||t.crossing==='island'||t.traffic_calming||t['crossing:continuous']&&t['crossing:continuous']!=='no'){skip('Ostrůvek nebo zvýšený přechod potřebuje vlastní geometrii.');continue;}
    const ways=source.ways.filter(w=>roads.selected.includes(w.id)&&w.nodes.includes(id)),candidates=[];
    for(const [index,road]of roads.roads.entries())if(ways.some(w=>w.id===road.way)){const near=nearest(chains[index],p);if(near.distance<.005)candidates.push({index,...near});}
    if(!candidates.length||candidates.length>2){skip('Přechod není na vybrané ulici nebo leží v uzlu více ulic.');continue;}
    let c=candidates[0],profile=surface.profiles[c.index];const joined=new Set([c.index]);
    if(candidates.length===2){
      // OSM commonly splits the same street at a crossing. Join only its
      // two opposing terminal arms with an identical physical profile.
      const terminal=c=>Math.min(c.at,c.length-c.at)<.005&&[roads.roads[c.index].from,roads.roads[c.index].to].some(i=>roads.crossings[i].id===`n${id}`);
      const other=candidates[1],orient=(c,incoming)=>{const reverse=incoming?c.at<c.length/2:c.at>c.length/2,chain=reverse?[...chains[c.index]].reverse():chains[c.index],p=surface.profiles[c.index];return {chain,profile:{...p,left:reverse?p.right:p.left,right:reverse?p.left:p.right}};},a=orient(c,true),b=orient(other,false);
      if(!candidates.every(terminal)||dot(unit(a.chain.at(-2),a.chain.at(-1))??[0,0],unit(b.chain[0],b.chain[1])??[0,0])<.995||['width','left','right'].some(k=>Math.abs(a.profile[k]-b.profile[k])>.001)){skip('Návazné úseky mají rozdílný profil nebo nepodporovaný úhel.');continue;}
      const chain=[...a.chain,...b.chain.slice(1)];profile=a.profile;c={...c,...nearest(chain,p)};joined.add(other.index);
    }
    if([...joined].some(i=>!allowed(roads.roads[i].tags??{}))||profile.left<.9||profile.right<.9){skip('Na obou stranách musí být průchozí veřejný chodník široký alespoň 0,9 m.');continue;}
    if(walkHeight-roadHeight>.250001){skip('Obrubník přesahuje podporovaný schod 0,25 m.');continue;}
    let width=3,widthSource='náhradní šířka 3 m';
    if(t.width!==undefined){const match=/^(\d+(?:\.\d+)?)(?: m)?$/.exec(t.width);if(!match||Number(match[1])<1.8||Number(match[1])>8){skip('Šířka přechodu musí být 1,8–8 m.');continue;}width=Number(match[1]);widthSource='OSM width';}
    const normal=[-c.tangent[1],c.tangent[0]],paths=source.ways.filter(w=>w.tags.highway==='footway'&&w.tags.footway==='crossing'&&w.nodes.includes(id));let direction=normal,directionSource='odhad: kolmo k ulici';
    if(paths.length){
      const directions=[];let invalid=false;for(const path of paths){if(!allowed(path.tags)||level(path.tags)){invalid=true;break;}const at=path.nodes.indexOf(id);for(const i of [at-1,at+1])if(path.points[i]){const d=unit(p,point(path.points[i]));if(d)directions.push(dot(d,normal)<0?d.map(n=>-n):d);}}
      if(invalid||!directions.length||directions.some(d=>dot(d,directions[0])<.995)||dot(directions[0],normal)<.7){skip('Pěší cesta má nepodporovaný přístup, ohyb nebo příliš šikmý směr.');continue;}direction=directions[0];directionSource='OSM footway=crossing';
    }
    const cosine=dot(direction,normal),left=(profile.width/2+profile.left)/cosine,right=(profile.width/2+profile.right)/cosine,extent=Math.abs(dot(direction,c.tangent))*Math.max(left,right)+width/2+1;
    if(Math.min(c.at,c.length-c.at)<extent){skip('Přechod je příliš blízko konce ulice, hranice nebo křižovatky.');continue;}
    // Reject another street near the corridor even when its pavement union
    // happens to cover a landing: do not invent a junction-wide shortcut.
    if(chains.some((other,i)=>!joined.has(i)&&nearest(other,p).distance<extent+surface.profiles[i].width/2+Math.max(surface.profiles[i].left,surface.profiles[i].right))){skip('Přechod zasahuje do blízké další ulice.');continue;}
    const across=[-direction[1],direction[0]],vertex=(d,w)=>[p[0]+direction[0]*d+across[0]*w,p[1]+direction[1]*d+across[1]*w],ring=[vertex(-right,-width/2),vertex(left,-width/2),vertex(left,width/2),vertex(-right,width/2)];ring.push(ring[0]);
    const strip=[[ring]],polygons=clipping.intersection(strip,ground);
    const landing=(sign,w)=>{const d=sign*(profile.width/2+w/2)/cosine,q=vertex(d,0);return [[Array.from({length:24},(_,i)=>[q[0]+.41*Math.cos(i*Math.PI/12),q[1]+.41*Math.sin(i*Math.PI/12)])]];};
    if(area(clipping.difference(landing(1,profile.left),surface.footprints.sidewalk))>1e-6||area(clipping.difference(landing(-1,profile.right),surface.footprints.sidewalk))>1e-6){skip('Chybí bezpečná návaznost na oba skutečné chodníky.');continue;}
    // A body-wide spine must run continuously between both landing centres,
    // including the road/sidewalk seams. Clipping may trim exterior corners
    // but must never hide a gap in the actual ground.
    const a=-(profile.width/2+profile.right/2)/cosine,b=(profile.width/2+profile.left/2)/cosine,spine=[[[vertex(a,-.41),vertex(a,.41),vertex(b,.41),vertex(b,-.41)]]];
    if(area(clipping.difference(spine,ground))>1e-6||blocks.length&&area(clipping.intersection(polygons,blocks))>1e-6){skip('Přechod protíná chybějící povrch, budovu nebo mobiliář.');continue;}
    if(placements.length>=64)fail('více než 64 podporovaných přechodů; zmenšete oblast.');
    const landings=[vertex(a,0),vertex(b,0)].map(v=>{v=v.map(Math.fround);if(!terrain)return v;const p=terrain.point([v[0],0,v[1]],walkHeight);return [p[0],p[2]];});
    placements.push({id,way:roads.roads[c.index].way,point:terrain?terrain.point(item.point,roadHeight):item.point.map(Math.fround),width,widthSource,direction,directionSource,height:terrain?terrain.point(item.point,roadHeight)[1]:roadHeight,...(terrain?{level:roadHeight,landingHeights:landings.map(p=>terrain.point([p[0],0,p[1]],walkHeight)[1])}:{}),landings,polygons:polygons.map(p=>p.map(r=>r.map(v=>v.map(Math.fround))))});
  }
  return {placements,skipped};
}
