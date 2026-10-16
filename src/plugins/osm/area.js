// Versioned city source plan. This module has no Electron or project access.
export const osmPlugin = Object.freeze({id:'openstreetmap-city',version:1,api:1});
export const osmProviders=Object.freeze({fossgis:{name:'Overpass · FOSSGIS',url:'https://overpass-api.de/api/interpreter'},coffee:{name:'Overpass · Private.coffee',url:'https://overpass.private.coffee/api/interpreter'}});
export const osmAttribution = '© OpenStreetMap contributors · ODbL 1.0 · https://www.openstreetmap.org/copyright · https://opendatacommons.org/licenses/odbl/1-0/';
const fail=message=>{throw Error(`OpenStreetMap: ${message}`);};
const earth=6371008.8,rad=Math.PI/180;
export function osmArea(value){
  const {latitude,longitude,size}=value??{};
  if(![latitude,longitude,size].every(n=>typeof n==='number'&&Number.isFinite(n))||Math.abs(latitude)>80||Math.abs(longitude)>179.9||size<50||size>450)fail('zadejte šířku −80…80°, délku −179,9…179,9° a čtverec 50–450 m.');
  const dy=size/2/earth/rad,dx=dy/Math.cos(latitude*rad);
  return {latitude,longitude,size,bbox:[latitude-dy,longitude-dx,latitude+dy,longitude+dx]};
}
export function osmMapLocation(text){
  let url;try{url=new URL(text);}catch{fail('vložte odkaz z openstreetmap.org s #map=zoom/šířka/délka.');}
  if(url.protocol!=='https:'||!['www.openstreetmap.org','openstreetmap.org'].includes(url.hostname))fail('očekávám HTTPS odkaz z openstreetmap.org.');
  const match=/(?:^#|&)map=\d+(?:\.\d+)?\/(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)(?:&|$)/.exec(url.hash);
  if(!match)fail('odkaz musí obsahovat #map=zoom/šířka/délka.');
  const latitude=Number(match[1]),longitude=Number(match[2]);osmArea({latitude,longitude,size:200});return {latitude,longitude};
}
const motor=new Set(['motorway','motorway_link','trunk','trunk_link','primary','primary_link','secondary','secondary_link','tertiary','tertiary_link','unclassified','residential','living_street','service','road']);
const knownTags=['highway','name','ref','oneway','junction','width','width:carriageway','est_width','lanes','lanes:forward','lanes:backward','sidewalk','sidewalk:left','sidewalk:right','sidewalk:both','sidewalk:left:width','sidewalk:right:width','sidewalk:both:width','bridge','tunnel','layer','access','motor_vehicle','vehicle','maxspeed','surface','building','building:part','height','min_height','building:min_level','building:levels','ele'];
export function osmSource(data,area){
  area=osmArea(area);
  if(!data||!Array.isArray(data.elements)||data.elements.length>60000||data.remark||data.error)fail(data?.remark||data?.error?'server vrátil neúplná data; zmenšete oblast nebo zkuste později.':'neplatná nebo příliš velká odpověď.');
  const buildingMembers=new Set(data.elements.filter(r=>r?.type==='relation'&&(r.tags?.building&&r.tags.building!=='no'||r.tags?.type==='building')).flatMap(r=>Array.isArray(r.members)?r.members.filter(m=>m?.type==='way').map(m=>m.ref):[]));
  const nodes=new Map(),ways=[],seen=new Set();
  for(const row of data.elements){
    if(!row||!['node','way','relation'].includes(row.type)||!Number.isSafeInteger(row.id)||row.id<=0||seen.has(`${row.type}/${row.id}`))fail('neplatný nebo opakovaný OSM prvek.');seen.add(`${row.type}/${row.id}`);
    if(row.type==='node'){
      if(!Number.isFinite(row.lat)||!Number.isFinite(row.lon)||Math.abs(row.lat)>90||Math.abs(row.lon)>180)fail('neplatné souřadnice uzlu.');
      nodes.set(row.id,{id:row.id,latitude:row.lat,longitude:row.lon});
    }else if(row.type==='way'){
      if(!row.tags?.highway&&!row.tags?.building)continue;
      if(!Array.isArray(row.nodes)||row.nodes.length<2||row.nodes.length>10000||row.nodes.some(id=>!Number.isSafeInteger(id)||id<=0)||!row.tags||typeof row.tags!=='object'||Array.isArray(row.tags))fail('neplatná cesta nebo její značky.');
      const tags={};for(const key of knownTags)if(Object.hasOwn(row.tags,key)){if(typeof row.tags[key]!=='string'||row.tags[key].length>1024)fail('neplatná značka cesty.');tags[key]=row.tags[key];}
      ways.push({id:row.id,nodes:[...row.nodes],tags});
    }
  }
  if(ways.length>5000)fail('oblast obsahuje příliš mnoho cest. Zmenšete ji.');
  for(const way of ways)if(way.nodes.some(id=>!nodes.has(id)))fail('chybí uzly cesty; odpověď není úplná.');
  const project=node=>[(node.longitude-area.longitude)*rad*earth*Math.cos(area.latitude*rad),0,(node.latitude-area.latitude)*rad*earth];
  const list=ways.map(way=>{
    const t=way.tags,blocked=!motor.has(t.highway)?'Pěší cesta nebo jiný typ bez automobilové sítě.':t.bridge&&t.bridge!=='no'||t.tunnel&&t.tunnel!=='no'||t.layer&&t.layer!=='0'?'Most, tunel nebo jiná úroveň vyžaduje výškový podklad.':['access','vehicle','motor_vehicle'].some(key=>['no','private'].includes(t[key]))?'Omezený přístup pro vozidla.':t.oneway&&!['yes','1','true','no','0','false','-1'].includes(t.oneway)?'Podmíněný nebo neznámý jednosměrný provoz.':null;
    return {...way,...(way.tags.building&&buildingMembers.has(way.id)?{buildingRelation:true}:{}),points:way.nodes.map(id=>project(nodes.get(id))),blocked,eligible:Boolean(t.highway&&!blocked)};
  });
  return {format:'mafia-workbench-osm',version:1,plugin:osmPlugin,area,attribution:osmAttribution,nodes:[...nodes.values()],ways:list,timestamp:typeof data.osm3s?.timestamp_osm_base==='string'?data.osm3s.timestamp_osm_base.slice(0,80):null};
}
// Liang–Barsky clipping: boundary vertices retain shared identity, intersections
// between unconnected ways never invent a junction (bridges in particular).
function clip(a,b,half){
  let low=0,high=1;const dx=b[0]-a[0],dz=b[2]-a[2];
  for(const [p,q]of [[-dx,a[0]+half],[dx,half-a[0]],[-dz,a[2]+half],[dz,half-a[2]]]){if(Math.abs(p)<1e-12){if(q<0)return null;continue;}const r=q/p;if(p<0)low=Math.max(low,r);else high=Math.min(high,r);if(low>high)return null;}
  if((high-low)*Math.hypot(dx,dz)<.05)return null;
  return [low,high].map(t=>({t,point:a.map((n,i)=>n+(b[i]-n)*t)}));
}
export function osmRoadPlan(source,selected){
  if(!source||source.format!=='mafia-workbench-osm'||source.version!==1)fail('neplatný plán oblasti.');
  if(!Array.isArray(selected)||!selected.length||selected.length>256||new Set(selected).size!==selected.length||selected.some(id=>!Number.isSafeInteger(id)))fail('vyberte 1–256 jedinečných ulic.');
  const ways=selected.map(id=>{const way=source.ways.find(w=>w.id===id);if(!way?.eligible)fail(`cesta ${id} není připravená pro import.`);return way;}),pieces=[],half=source.area.size/2;
  for(const way of ways){
    let current=null;
    for(let i=1;i<way.points.length;i++){
      const segment=clip(way.points[i-1],way.points[i],half);if(!segment){current=null;continue;}
      const [a,b]=segment,key=(v,end)=>v.t<1e-10?`n${way.nodes[i-1]}`:v.t>1-1e-10?`n${way.nodes[i]}`:`cut${way.id}/${i}/${end}`;
      const start={id:key(a,0),position:a.point},end={id:key(b,1),position:b.point};
      if(!current||current.points.at(-1).id!==start.id){current={way:way.id,tags:way.tags,points:[start]};pieces.push(current);}current.points.push(end);
      if(b.t<1-1e-10)current=null;
    }
  }
  const count=new Map();for(const piece of pieces)for(const point of piece.points)count.set(point.id,(count.get(point.id)??0)+1);
  const crossings=[],index=new Map(),roads=[];
  const crossing=point=>{if(!index.has(point.id)){index.set(point.id,crossings.length);crossings.push({id:point.id,position:point.position.map(Math.fround)});}return index.get(point.id);};
  for(const piece of pieces){
    const points=piece.points,anchors=new Set([0,points.length-1]);points.forEach((p,i)=>{if(count.get(p.id)>1)anchors.add(i);});
    if(points[0].id===points.at(-1).id){anchors.add(Math.floor((points.length-1)/3));anchors.add(Math.floor(2*(points.length-1)/3));}
    const cuts=[...anchors].sort((a,b)=>a-b);
    for(let i=1;i<cuts.length;i++){
      const chain=points.slice(cuts[i-1],cuts[i]+1);if(chain.length<2)continue;
      const from=crossing(chain[0]),to=crossing(chain.at(-1));if(from===to)fail(`uzavřená cesta ${piece.way} vyžaduje rozdělení.`);
      const one=piece.tags.oneway,forward=one!=='-1',implicit=piece.tags.junction==='roundabout'||piece.tags.highway==='motorway',reverse=one==='-1'||['no','0','false'].includes(one)||!one&&!implicit;
      const positions=chain.slice(1,-1).map(p=>p.position.map(Math.fround));if(!positions.length)positions.push(chain[0].position.map((n,j)=>Math.fround((n+chain.at(-1).position[j])/2)));
      roads.push({from,to,positions,way:piece.way,tags:piece.tags,forward,reverse});
    }
  }
  if(!roads.length)fail('ve výběru nejsou ulice uvnitř oblasti.');
  // Parallel ways with the same endpoints need an extra crossing: LS3D's
  // authoring interface deliberately refuses ambiguous pairs of crossings.
  const pairs=new Set();for(const road of [...roads]){const key=[road.from,road.to].sort((a,b)=>a-b).join('/');if(!pairs.has(key)){pairs.add(key);continue;}const at=Math.floor(road.positions.length/2),middle=road.positions[at],next=crossings.length;crossings.push({id:`parallel/${roads.indexOf(road)}`,position:middle});const tail={...road,from:next,positions:road.positions.slice(at+1)};road.to=next;road.positions=road.positions.slice(0,at);for(const r of [road,tail])if(!r.positions.length)r.positions=[crossings[r.from].position.map((n,j)=>Math.fround((n+crossings[r.to].position[j])/2))];roads.push(tail);}
  const degree=new Map();for(const r of roads)for(const i of [r.from,r.to])degree.set(i,(degree.get(i)??0)+1);
  if([...degree.values()].some(n=>n>4))fail('některý uzel má více než čtyři výjezdy; odeberte připojenou ulici.');
  if(crossings.length>512||roads.reduce((n,r)=>n+r.positions.length,0)>4096)fail('síť je příliš velká; zmenšete oblast nebo výběr.');
  for(const road of roads){const chain=[crossings[road.from].position,...road.positions,crossings[road.to].position];if(chain.some((p,i)=>i&&Math.hypot(p[0]-chain[i-1][0],p[2]-chain[i-1][2])<.01))fail('příliš krátký úsek po ořezu; posuňte střed oblasti.');}
  return {crossings,roads,selected:[...selected],flat:true};
}
