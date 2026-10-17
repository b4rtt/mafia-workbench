import clipping from 'polygon-clipping';
import {osmGreenPathFootprints,osmGreenModel} from './green-areas.js';
import {osmBuildingFootprints} from './footprints.js';
import {osmNavigationElevation} from './navigation-elevation.js';
import {elevationCoordinate} from './elevation.js';

export const osmWalkwayDefaults=Object.freeze({version:1,width:2,tileSize:2,height:.03,texture:'maps/^chdnk02.bmp'});
const fail=m=>{throw Error('OpenStreetMap · pěší cesty: '+m);};
export const osmWalkwayCandidates=source=>source.ways.filter(w=>['footway','path','pedestrian'].includes(w.tags.highway));
export function validateOsmWalkways(o){
  if(!o||o.version!==1||!Array.isArray(o.selected)||!o.selected.length||o.selected.length>256||new Set(o.selected).size!==o.selected.length||o.selected.some(n=>!Number.isSafeInteger(n)||n<=0))fail('vyberte 1–256 jedinečných pěších cest.');
  for(const [key,min,max]of [['width',.5,5],['tileSize',.25,10],['height',.01,.04]])if(typeof o[key]!=='number'||!Number.isFinite(o[key])||o[key]<min||o[key]>max)fail('neplatný rozměr '+key+'.');
  if(typeof o.texture!=='string'||!/^maps\/[\x20-\x7e]+\.bmp$/i.test(o.texture)||/[\\/:*?"<>|]/.test(o.texture.slice(5))||o.texture.slice(5).length>120)fail('vyberte BMP ze složky maps.');
  if(o.textureHash!==undefined&&!/^[a-f0-9]{64}$/.test(o.textureHash))fail('neplatný kontrolní součet textury.');
}
const area=polys=>polys.reduce((s,p)=>s+p.reduce((s,r,i)=>s+(i?-1:1)*Math.abs(r.slice(1).reduce((s,b,j)=>s+r[j][0]*b[1]-b[0]*r[j][1],0)/2),0),0);
export function osmWalkwayPlan(source,surface,green,o,reservedVertices=0){
  validateOsmWalkways(o);if(!surface?.footprints||!source?.area||!Number.isSafeInteger(reservedVertices)||reservedVertices<0)fail('zapněte povrchy ulic a ověřte rozpočet kolizí.');
  const terrain=osmNavigationElevation(surface),field=terrain?.field;
  if(field&&['latitude','longitude','size'].some(k=>field.area[k]!==source.area[k])||green&&(field?green.elevation!==field:green.elevation))fail('cesty musí používat společný výškový podklad ulic a zeleně.');
  // Use one integral micron grid for clipping against float32 street edges.
  const boolean=(op,...shapes)=>clipping[op](...shapes.map(s=>s.map(p=>p.map(r=>r.map(v=>v.map(n=>Math.round(n*1e6))))))).map(p=>p.map(r=>r.map(v=>v.map(n=>elevationCoordinate(n/1e6)))));
  const half=source.area.size/2,x=field?[field.x[0],field.x.at(-1)]:[-half,half],z=field?[field.z[0],field.z.at(-1)]:[-half,half],box=[[[[x[0],z[0]],[x[1],z[0]],[x[1],z[1]],[x[0],z[1]],[x[0],z[0]]]]],reserved=[...surface.footprints.road,...surface.footprints.sidewalk,...osmBuildingFootprints(source).filter(b=>!b.reason&&!b.suppressed).flatMap(b=>b.polygons),...(green?.placements??[]).flatMap(p=>[...p.grass,...p.paths])],profiles=[],skipped=[],parts=[];
  const ways=osmWalkwayCandidates(source),selected=[...o.selected].sort((a,b)=>a-b);
  if(selected.reduce((n,id)=>n+(ways.find(w=>w.id===id)?.points.length??0),0)>8192)fail('výběr přesahuje 8192 mapovaných bodů; zmenšete oblast.');
  for(const id of selected){
    const w=ways.find(w=>w.id===id);if(!w)fail(`cesta ${id} není v podkladu.`);const t=w.tags,skip=reason=>skipped.push({way:id,name:t.name??String(id),reason});
    if(t.area==='yes'){skip('Pěší plocha area=yes vyžaduje vlastní plošný model.');continue;}
    if(t.footway==='crossing'){skip('Přechod řeší samostatná volba mapovaných neřízených přechodů.');continue;}
    if(t.bridge&&t.bridge!=='no'||t.tunnel&&t.tunnel!=='no'||t.layer&&t.layer!=='0'){skip('Most, tunel nebo jiná výšková úroveň vyžaduje ruční model.');continue;}
    if(t['foot:conditional']||t['access:conditional']||(t.foot?!['yes','designated','permissive'].includes(t.foot):t.access&&!['yes','designated','permissive'].includes(t.access))){skip('Přístup pro pěší je omezený, podmíněný nebo neurčený.');continue;}
    const path=osmGreenPathFootprints({...source,ways:[w]},{pathWidth:o.width}),polygons=boolean('difference',boolean('intersection',path.polygons,box),reserved);
    profiles.push({...path.profiles[0],surface:t.surface??null,materialSource:'ručně vybraná společná textura'});
    if(area(polygons)<.1){skip('Po odečtení ulic, budov, zeleně a hranice nezbyla plocha alespoň 0,1 m².');continue;}parts.push(polygons);
  }
  if(!parts.length)return {placements:[],profiles,skipped,...(field?{elevation:field}:{})};
  const paths=boolean('union',...parts),item={name:'OSM_WALKWAYS',grass:[],paths,height:o.height,texture:o.texture,pathTexture:o.texture,tileSize:o.tileSize,pathTileSize:o.tileSize,area:area(paths),...(field?{elevated:true}:{})},model=osmGreenModel(item,field),vertices=new Set(model.meshes.flatMap(m=>{const p=m.lods[0].positions;return Array.from({length:p.length/3},(_,i)=>p.slice(i*3,i*3+3).join('/'));})).size;
  if(reservedVertices+vertices>60000)fail('cesty překračují společný limit 60 000 kolizních vrcholů; zmenšete výběr.');
  item.triangles=model.meshes.reduce((n,m)=>n+m.lods[0].faces.reduce((n,f)=>n+f.indices.length/3,0),0);
  return {placements:[item],profiles,skipped,vertices,...(field?{elevation:field}:{})};
}
export const osmWalkwayModel=(item,field)=>osmGreenModel(item,field);
