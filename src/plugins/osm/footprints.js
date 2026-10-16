import clipping from 'polygon-clipping';
const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
const area=ring=>Math.abs(ring.reduce((s,a,i)=>{const b=ring[(i+1)%ring.length];return s+a[0]*b[1]-b[0]*a[1];},0))/2;
const polyArea=mp=>mp.reduce((s,p)=>s+area(p[0])-p.slice(1).reduce((n,r)=>n+area(r),0),0);
const invalid=message=>{throw Error(message);};
function touches(a,b,c,d){
  const on=(p,q,r)=>Math.abs(cross(p,q,r))<1e-8&&r[0]>=Math.min(p[0],q[0])-1e-8&&r[0]<=Math.max(p[0],q[0])+1e-8&&r[1]>=Math.min(p[1],q[1])-1e-8&&r[1]<=Math.max(p[1],q[1])+1e-8;
  return cross(a,b,c)*cross(a,b,d)<0&&cross(c,d,a)*cross(c,d,b)<0||on(a,b,c)||on(a,b,d)||on(c,d,a)||on(c,d,b);
}
function ringsTouch(a,b){return a.some((p,i)=>b.some((q,j)=>touches(p,a[(i+1)%a.length],q,b[(j+1)%b.length])));}
function ring(ids,nodes,project){
  if(ids.length<4||ids.length>257||ids[0]!==ids.at(-1)||new Set(ids.slice(0,-1)).size!==ids.length-1)invalid('Neuzavřený, opakovaný nebo příliš složitý obrys (nejvýše 256 hran).');
  // Canonical start/direction makes component IDs independent of member order.
  const open=ids.slice(0,-1),at=open.indexOf(Math.min(...open)),forward=[...open.slice(at),...open.slice(0,at)],reverse=[forward[0],...forward.slice(1).reverse()],ordered=forward[1]<reverse[1]?forward:reverse;
  const points=ordered.map(id=>{if(!nodes.has(id))invalid('Chybí uzly členské cesty.');const p=project(nodes.get(id));return [p[0],p[2]];});
  if(area(points)<.01||points.some((a,i)=>Math.hypot(a[0]-points[(i+1)%points.length][0],a[1]-points[(i+1)%points.length][1])<1e-6||points.some((b,j)=>j!==i&&(i+1)%points.length!==j&&(j+1)%points.length!==i&&touches(a,points[(i+1)%points.length],b,points[(j+1)%points.length]))))invalid('Obrys se protíná nebo má nulovou plochu.');
  return {key:ordered.join('/'),points};
}
function join(members,ways,nodes,project){
  const pending=members.map(m=>{const way=ways.get(m.ref);if(!way||!Array.isArray(way.nodes)||way.nodes.length<2||way.nodes.length>257||way.nodes.some(id=>!Number.isSafeInteger(id)||id<=0))invalid('Chybí členská cesta nebo má neplatné uzly.');return [...way.nodes];}),ends=new Map(),result=[];
  for(const ids of pending)if(ids[0]!==ids.at(-1))for(const id of [ids[0],ids.at(-1)])ends.set(id,(ends.get(id)??0)+1);
  if([...ends.values()].some(n=>n!==2))invalid('Členské cesty mají otevřené nebo nejednoznačné spoje.');
  while(pending.length){const ids=pending.shift();while(ids[0]!==ids.at(-1)){const at=pending.findIndex(p=>p[0]===ids.at(-1)||p.at(-1)===ids.at(-1));if(at<0)invalid('Členské cesty netvoří uzavřený obrys.');const next=pending.splice(at,1)[0];if(next[0]!==ids.at(-1))next.reverse();ids.push(...next.slice(1));if(ids.length>257)invalid('Složený obrys přesahuje 256 hran.');}result.push(ring(ids,nodes,project));}
  return result.sort((a,b)=>a.key.localeCompare(b.key,'en'));
}
// A missing/unsupported relation is kept as a visible reason, never filled by
// its tagged outer way. Input data and raw relation membership are preserved.
export function readOsmBuildings(data,nodes,project,ways,tagNames){
  const rawWays=new Map(data.elements.filter(r=>r.type==='way').map(r=>[r.id,r])),relations=data.elements.filter(r=>r.type==='relation'&&(r.tags?.building&&r.tags.building!=='no'||r.tags?.type==='building'||r.tags?.type==='multipolygon'&&Array.isArray(r.members)&&r.members.some(m=>m?.role==='outer'&&m.type==='way'&&rawWays.get(m.ref)?.tags?.building))),claimed=new Set(relations.flatMap(r=>Array.isArray(r.members)?r.members.filter(m=>m?.type==='way').map(m=>m.ref):[])),buildings=[];
  for(const way of ways.filter(w=>w.tags.building)){
    const feature={id:way.id,tags:way.tags,polygons:[]};
    if(claimed.has(way.id)){feature.suppressed=true;feature.reason='Součást složené budovy nebo multipolygonu; vyberte jeho relaci.';}
    else try{feature.polygons=[[ring(way.nodes,nodes,project).points]];}catch(error){feature.reason=error.message;}
    buildings.push(feature);
  }
  for(const relation of relations){
    const feature={id:`relation/${relation.id}/1`,tags:{},polygons:[],relation:relation.id};
    try{
      if(!relation.tags||typeof relation.tags!=='object'||Array.isArray(relation.tags))invalid('Neplatné značky relace.');
      for(const key of tagNames)if(Object.hasOwn(relation.tags,key)){const value=relation.tags[key];if(typeof value!=='string'||value.length>1024)invalid('Neplatná značka relace.');feature.tags[key]=value;}
      if(!Array.isArray(relation.members)||!relation.members.length||relation.members.length>128)invalid('Relace vyžaduje 1–128 členských cest.');
      if(!feature.tags.building||feature.tags.building==='no')invalid('Značka building je pouze na členské cestě nebo je relace vyloučená; starší či rozporné značení vyžaduje ruční model.');
      const members=relation.members;
      if(relation.tags.type!=='multipolygon')invalid('Relace building s 3D částmi vyžaduje ruční model.');
      if(members.some(m=>m?.type!=='way'||!Number.isSafeInteger(m.ref)||m.ref<=0||!['outer','inner'].includes(m.role))||new Set(members.map(m=>m.ref)).size!==members.length)invalid('Nepodporovaný, opakovaný nebo neoznačený člen relace (outer/inner).');
      const outer=join(members.filter(m=>m.role==='outer'),rawWays,nodes,project),inner=join(members.filter(m=>m.role==='inner'),rawWays,nodes,project);
      if(!outer.length||outer.length+inner.length>32)invalid('Relace vyžaduje vnější obrys a nejvýše 32 prstenců.');
      const polygons=outer.map(r=>[r.points]);
      for(const hole of inner){
        const owners=outer.map((o,i)=>!ringsTouch(o.points,hole.points)&&polyArea(clipping.difference([hole.points],[o.points]))<1e-6?i:-1).filter(i=>i!==-1);
        if(owners.length!==1)invalid('Otvor není jednoznačně uvnitř vnějšího obrysu nebo se ho dotýká.');
        const polygon=polygons[owners[0]];
        if(polygon.slice(1).some(h=>ringsTouch(h,hole.points)||polyArea(clipping.intersection([h],[hole.points]))>1e-6))invalid('Otvory se dotýkají, překrývají nebo jsou vnořené.');polygon.push(hole.points);
      }
      for(let i=0;i<polygons.length;i++)for(let j=0;j<i;j++)if(ringsTouch(polygons[i][0],polygons[j][0])||polyArea(clipping.intersection(polygons[i],polygons[j]))>1e-6)invalid('Vnější části se dotýkají nebo překrývají.');
      polygons.forEach((polygon,i)=>buildings.push({...feature,id:`relation/${relation.id}/${i+1}`,polygons:[polygon],component:i+1,components:polygons.length}));
    }catch(error){feature.reason=error.message;buildings.push(feature);}
  }
  return buildings;
}
// Legacy version-1 plans used way IDs. Keep those sources/settings loadable.
export function osmBuildingFootprints(source){return source.buildings??source.ways.filter(w=>w.tags.building).map(w=>({id:w.id,tags:w.tags,polygons:[[w.points.slice(0,-1).map(p=>[p[0],p[2]])]],...(w.buildingRelation?{reason:'Součást složené budovy nebo multipolygonu vyžaduje ruční model.'}:w.nodes[0]!==w.nodes.at(-1)||w.nodes.length<4||w.nodes.length>257?{reason:'Vyžaduje jednoduchý uzavřený půdorys do 256 hran.'}:{})}));}
