import clipping from 'polygon-clipping';
import {ShapeUtils,Vector2} from 'three';
import {osmRing,osmMultipolygon,osmBuildingFootprints} from './footprints.js';
import {osmShellModel} from './building-shells.js';

export const osmGreenDefaults=Object.freeze({version:1,approximateParks:false,height:.03,tileSize:4,pathWidth:1.5,pathTileSize:2,texture:'maps/^trava02.bmp',pathTexture:'maps/^chdnk02.bmp'});
const fail=message=>{throw Error(`OpenStreetMap · zeleň: ${message}`);};
const tagsOf=row=>{if(!row.tags||typeof row.tags!=='object'||Array.isArray(row.tags))throw Error('Neplatné značky plochy.');const tags={};for(const key of ['name','landuse','landcover','natural','leisure','surface','layer','bridge','tunnel'])if(Object.hasOwn(row.tags,key)){if(typeof row.tags[key]!=='string'||row.tags[key].length>1024)throw Error('Neplatná značka plochy.');tags[key]=row.tags[key];}return tags;};
export const osmGreenKind=tags=>['grass','meadow'].includes(tags?.landuse)||tags?.landcover==='grass'||tags?.natural==='grassland'?'grass':['park','garden'].includes(tags?.leisure)?'park':null;
const signed=r=>r.reduce((s,a,i)=>{const b=r[(i+1)%r.length];return s+a[0]*b[1]-b[0]*a[1];},0)/2;
const area=mp=>mp.reduce((s,p)=>s+Math.abs(signed(p[0]))-p.slice(1).reduce((n,r)=>n+Math.abs(signed(r)),0),0);
const snap=n=>Math.round(n*1000)/1000;
// Incomplete relations suppress tagged member ways too; never fill their holes.
export function readOsmGreenAreas(data,nodes,project){
  const ways=new Map(data.elements.filter(r=>r.type==='way').map(r=>[r.id,r])),relations=data.elements.filter(r=>r.type==='relation'&&(osmGreenKind(r.tags)||r.tags?.type==='multipolygon'&&Array.isArray(r.members)&&r.members.some(m=>m?.type==='way'&&m.role==='outer'&&osmGreenKind(ways.get(m.ref)?.tags)))),claimed=new Set(relations.flatMap(r=>Array.isArray(r.members)?r.members.filter(m=>m?.type==='way').map(m=>m.ref):[])),features=[];
  for(const way of ways.values())if(osmGreenKind(way.tags)){
    const f={id:way.id,kind:osmGreenKind(way.tags),tags:{},polygons:[]};
    try{f.tags=tagsOf(way);if(claimed.has(way.id)){f.suppressed=true;throw Error('Součást multipolygonu; vyberte relaci.');}if(!Array.isArray(way.nodes)||way.nodes.some(id=>!Number.isSafeInteger(id)||id<=0))throw Error('Neplatné uzly plochy.');f.polygons=[[osmRing(way.nodes,nodes,project)]];}catch(e){f.reason=e.message;}features.push(f);
  }
  for(const relation of relations){const f={id:`relation/${relation.id}/1`,relation:relation.id,kind:osmGreenKind(relation.tags),tags:{},polygons:[]};try{f.tags=tagsOf(relation);if(!f.kind)throw Error('Značky jsou pouze na členské cestě; určete typ relace ručně.');const polygons=osmMultipolygon(relation,ways,nodes,project);polygons.forEach((p,i)=>features.push({...f,id:`relation/${relation.id}/${i+1}`,component:i+1,components:polygons.length,polygons:[p]}));}catch(e){features.push({...f,reason:e.message});}}
  if(features.length>2048)fail('příliš mnoho ploch zeleně; zmenšete oblast.');return features;
}
export function validateOsmGreenOptions(o){
  if(!o||o.version!==1||!Array.isArray(o.selected)||!o.selected.length||o.selected.length>64||new Set(o.selected).size!==o.selected.length||o.selected.some(id=>!(Number.isSafeInteger(id)&&id>0||typeof id==='string'&&/^relation\/[1-9]\d*\/[1-9]\d*$/.test(id)))||typeof o.approximateParks!=='boolean')fail('vyberte 1–64 jedinečných ploch a platné nastavení.');
  if(o.textures!==undefined&&(!Array.isArray(o.textures)||o.textures.length!==2||o.textures.some(t=>typeof t?.path!=='string'||!/^[a-f0-9]{64}$/.test(t.sha256??'')||![o.texture,o.pathTexture].some(p=>typeof p==='string'&&p.toLowerCase()===t.path.toLowerCase()))))fail('neplatné uložené textury.');
  for(const[key,min,max]of [['height',.01,.04],['tileSize',.25,20],['pathWidth',.5,5],['pathTileSize',.25,10]])if(!Number.isFinite(o[key])||o[key]<min||o[key]>max)fail(`neplatný rozměr ${key}.`);
  for(const key of ['texture','pathTexture'])if(typeof o[key]!=='string'||!/^maps\/[\x20-\x7e]+\.bmp$/i.test(o[key])||/[\\/:*?"<>|]/.test(o[key].slice(5))||o[key].slice(5).length>120)fail('vyberte BMP z hlavní složky maps.');
}
export function osmGreenPathFootprints(source,o){
  const parts=[],profiles=[];
  const ways=source.ways.filter(w=>['footway','path','pedestrian'].includes(w.tags.highway)&&w.tags.area!=='yes');
  if(ways.reduce((s,w)=>s+w.points.length,0)>8192)fail('příliš mnoho bodů pěších cest; zmenšete oblast.');
  for(const way of ways){
    if(way.tags.bridge&&way.tags.bridge!=='no'||way.tags.tunnel&&way.tags.tunnel!=='no'||way.tags.layer&&way.tags.layer!=='0'){profiles.push({way:way.id,skipped:true,note:'Most, tunel nebo jiná úroveň pěší cesty se nevytváří.'});continue;}
    const match=/^(\d+(?:\.\d+)?)(?: (m|ft))?$/.exec(way.tags.width??''),width=match?Number(match[1])*(match[2]==='ft'?.3048:1):null,valid=width!==null&&width>=.5&&width<=5,r=(valid?width:o.pathWidth)/2;
    profiles.push({way:way.id,width:r*2,source:valid?'OSM width':'ruční náhradní šířka',...(way.tags.width!==undefined&&!valid?{note:'Neplatná nebo nepodporovaná šířka pěší cesty; použita náhradní.'}:{})});
    for(let i=1;i<way.points.length;i++){const a=way.points[i-1],b=way.points[i],dx=b[0]-a[0],dz=b[2]-a[2],length=Math.hypot(dx,dz);if(length<.001)continue;const x=dz/length*r,z=-dx/length*r;parts.push([[[a[0]+x,a[2]+z],[b[0]+x,b[2]+z],[b[0]-x,b[2]-z],[a[0]-x,a[2]-z]].map(p=>p.map(snap))]);}
    for(const p of way.points)parts.push([Array.from({length:12},(_,i)=>[snap(p[0]+Math.cos(i*Math.PI/6)*r),snap(p[2]+Math.sin(i*Math.PI/6)*r)])]);
  }
  // Boolean sweeps use integral millimetres. Decimal strip/cap intersections
  // in dense real path networks otherwise leave numerically unclosed rings.
  const integer=parts.map(p=>p.map(r=>r.map(pt=>pt.map(n=>Math.round(n*1000)))));
  return {polygons:parts.length?clipping.union(integer).map(p=>p.map(r=>r.map(pt=>pt.map(n=>n/1000)))):[],profiles};
}
const vertexCount=model=>new Set(model.meshes.flatMap(m=>{const p=m.lods[0].positions;return Array.from({length:p.length/3},(_,i)=>p.slice(i*3,i*3+3).map(Math.fround).join('/'));})).size;
export function osmGreenReservation(surface,buildings,catalog=[]){return (surface?vertexCount(surface.model):0)+(buildings?.placements??[]).reduce((sum,b)=>sum+(b.style?vertexCount(osmShellModel(b)):catalog.find(m=>m.path===b.model)?.vertices??60000),0);}
export function osmGreenPlan(source,surface,o,reservedVertices=surface?vertexCount(surface.model):0){
  validateOsmGreenOptions(o);if(!Number.isFinite(source?.area?.size)||source.area.size<50||source.area.size>450)fail('neplatná oblast.');
  if(!Number.isSafeInteger(reservedVertices)||reservedVertices<0)fail('neplatný rozpočet kolizí.');
  const half=source.area.size/2,box=[[[-half,-half],[half,-half],[half,half],[-half,half]]],exclusions=[...(surface?.footprints.road??[]),...(surface?.footprints.sidewalk??[]),...osmBuildingFootprints(source).filter(b=>!b.reason&&!b.suppressed).flatMap(b=>b.polygons)],reserved=exclusions.length?clipping.union(exclusions):[],paths=osmGreenPathFootprints(source,o),occupied=[],placements=[],skipped=[];
  let vertices=reservedVertices;
  for(const id of [...o.selected].sort((a,b)=>Number(source.greenAreas?.find(f=>f.id===a)?.kind==='park')-Number(source.greenAreas?.find(f=>f.id===b)?.kind==='park')||String(a).localeCompare(String(b),'en'))){
    const f=source.greenAreas?.find(f=>f.id===id);if(!f||f.suppressed)fail(`plocha ${id} není v podkladu.`);const skip=reason=>skipped.push({id,name:f.tags.name??String(id),reason});
    if(f.reason){skip(f.reason);continue;}if(f.kind==='park'&&!o.approximateParks){skip('Park/zahrada neurčuje travnatý povrch; povolte výslovný odhad.');continue;}
    if(f.tags.surface&&f.tags.surface!=='grass'||f.tags.layer&&f.tags.layer!=='0'||f.tags.bridge&&f.tags.bridge!=='no'||f.tags.tunnel&&f.tags.tunnel!=='no'){skip('Jiný povrch nebo výšková úroveň vyžaduje ruční úpravu.');continue;}
    const clipped=clipping.intersection(f.polygons,box),available=clipping.difference(clipped,reserved,occupied),walks=paths.polygons.length?clipping.intersection(available,paths.polygons):[],grass=walks.length?clipping.difference(available,walks):available;
    if(area(available)<1){skip('Po ořezu hranicí, ulicemi, budovami a ostatní zelení nezbyla plocha alespoň 1 m².');continue;}
    const item={id,name:`OSM_GREEN_${String(id).replaceAll('/','_')}`,label:f.tags.name??`Zeleň ${id}`,kind:f.kind,grass,paths:walks,height:o.height,tileSize:o.tileSize,pathTileSize:o.pathTileSize,texture:o.texture,pathTexture:o.pathTexture,area:area(available),notes:f.kind==='park'?['Travnatý podklad parku/zahrady je ručně povolený odhad, nikoli přesný povrch z OSM.']:[],...(f.relation?{relation:f.relation,component:f.component}:{})},model=osmGreenModel(item),count=vertexCount(model);
    if(vertices+count>60000){skip('Plocha by překročila sdílený bezpečný limit vrcholů kolizí.');continue;}vertices+=count;item.triangles=model.meshes.reduce((s,m)=>s+m.lods[0].faces.reduce((n,f)=>n+f.indices.length/3,0),0);placements.push(item);occupied.push(...available);
  }
  return {placements,skipped,pathProfiles:paths.profiles};
}
// New standard visuals only; original terrain geometry is never rebuilt.
export function osmGreenModel(item){
  const positions=[],normals=[],uv=[],faces=[1,2].map(material=>({material,indices:[]}));
  for(const[polygons,material,tile]of [[item.grass,1,item.tileSize],[item.paths,2,item.pathTileSize]])for(const polygon of polygons){
    const rings=polygon.map(r=>{const open=r.length>1&&r[0][0]===r.at(-1)[0]&&r[0][1]===r.at(-1)[1]?r.slice(0,-1):r;return open.map(p=>new Vector2(...p));}),v=rings.flat(),triangles=ShapeUtils.triangulateShape(rings[0],rings.slice(1));
    for(const ids of triangles){let p=ids.map(i=>[Math.fround(v[i].x),Math.fround(item.height),Math.fround(v[i].y)]);const[a,b,c]=p,n=(b[2]-a[2])*(c[0]-a[0])-(b[0]-a[0])*(c[2]-a[2]);if(Math.abs(n)<1e-8)continue;if(n<0)p=[p[0],p[2],p[1]];if(positions.length/3+3>60000)fail('plocha překračuje 60 000 vrcholů; zmenšete oblast.');const at=positions.length/3;positions.push(...p.flat());normals.push(0,1,0,0,1,0,0,1,0);uv.push(...p.flatMap(p=>[Math.fround(p[0]/tile),Math.fround(p[2]/tile)]));faces[material-1].indices.push(at,at+1,at+2);}
  }
  if(!positions.length)fail('plocha nemá platné trojúhelníky.');
  return {version:29,materials:[item.texture,item.pathTexture].map(p=>({flags:0x00840001,ambient:[1,1,1],diffuse:[1,1,1],emission:[0,0,0],opacity:1,texture:p.slice(5)})),meshes:[{id:1,name:'OSM_GREEN',type:1,visual:0,renderFlags:0,logicFlags:0x2a,culling:9,parent:0,position:[0,0,0],rotation:[1,0,0,0],scale:[1,1,1],lods:[{distance:0,vertices:positions.length/3,positions,normals,uv,faces}]}],animated:0};
}
