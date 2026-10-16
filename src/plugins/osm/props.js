import clipping from 'polygon-clipping';
import {Vector3} from 'three';
import {frameMatrix} from '../../shared/scene-world.js';
import {osmBuildingFootprints} from './footprints.js';
import {osmGreenModel,osmGreenReservation} from './green-areas.js';

const fail=m=>{throw Error(`OpenStreetMap · osazení: ${m}`);};
export const osmPropLabels=Object.freeze({tree:'Strom',bench:'Lavička',bin:'Odpadkový koš',lamp:'Lampa'});
export const osmPropDefaults=Object.freeze({version:1,treeHeight:12,lampHeight:6.5,ground:0,lights:false});
const kind=t=>t?.natural==='tree'?'tree':t?.amenity==='bench'?'bench':t?.amenity==='waste_basket'?'bin':t?.highway==='street_lamp'?'lamp':null;
export function readOsmProps(data,nodes,project){
  const props=[];
  for(const row of data.elements)if(row.type==='node'&&kind(row.tags)){
    const tags={};for(const key of ['name','natural','amenity','highway','height','est_height','direction','leaf_type','leaf_cycle','species','genus','circumference','diameter','diameter_crown','support','location','layer','bridge','tunnel','indoor','access','backrest'])if(Object.hasOwn(row.tags,key)){if(typeof row.tags[key]!=='string'||row.tags[key].length>1024)fail('neplatná značka bodu.');tags[key]=row.tags[key];}
    props.push({id:row.id,kind:kind(tags),tags,point:project(nodes.get(row.id))});
  }
  if(props.length>4096)fail('příliš mnoho mapovaných bodů; zmenšete oblast.');return props.sort((a,b)=>a.id-b.id);
}
export function validateOsmPropOptions(o){
  if(!o||o.version!==1||!Array.isArray(o.selected)||!o.selected.length||o.selected.length>256||new Set(o.selected).size!==o.selected.length||o.selected.some(id=>!Number.isSafeInteger(id)||id<=0)||typeof o.lights!=='boolean'||!Array.isArray(o.models)||!o.models.length||o.models.length>6||o.models.some(m=>typeof m?.path!=='string'||!/^[a-f0-9]{64}$/.test(m.sha256??'')))fail('vyberte 1–256 jedinečných bodů a načtěte katalog modelů.');
  for(const[key,min,max]of [['treeHeight',3,35],['lampHeight',2,15],['ground',-5,5]])if(!Number.isFinite(o[key])||o[key]<min||o[key]>max)fail(`neplatný rozměr ${key}.`);
}
const area=mp=>mp.reduce((sum,p)=>sum+p.reduce((s,r,i)=>s+(i?-1:1)*Math.abs(r.reduce((n,a,j)=>{const b=r[(j+1)%r.length];return n+a[0]*b[1]-b[0]*a[1];},0))/2,0),0);
const overlap=(a,b)=>b.length&&area(clipping.intersection(a,b))>.0001;
const within=(p,b)=>b.length&&area(clipping.difference(p,b))<.0001;
const metres=v=>{const m=/^(\d+(?:\.\d+)?)(?: (m|ft))?$/.exec(v??'');return m?Number(m[1])*(m[2]==='ft'?.3048:1):null;};
const compass={N:0,NNE:22.5,NE:45,ENE:67.5,E:90,ESE:112.5,SE:135,SSE:157.5,S:180,SSW:202.5,SW:225,WSW:247.5,W:270,WNW:292.5,NW:315,NNW:337.5};
function direction(value){if(Object.hasOwn(compass,value??''))return compass[value];return /^(?:\d+(?:\.\d+)?)$/.test(value??'')&&Number(value)<=360?Number(value)%360:null;}
export function osmPropReservation(surface,buildings,catalog,green){return osmGreenReservation(surface,buildings,catalog)+(green?.placements??[]).reduce((s,item)=>{const model=osmGreenModel(item,green.elevation);return s+new Set(model.meshes.flatMap(m=>{const p=m.lods[0].positions;return Array.from({length:p.length/3},(_,i)=>p.slice(i*3,i*3+3).map(Math.fround).join('/'));})).size;},0);}
export function osmPropPlan(source,surface,catalog,o,green=null,reservedVertices=0){
  validateOsmPropOptions(o);if(!surface||!Number.isFinite(source?.area?.size)||!Number.isSafeInteger(reservedVertices)||reservedVertices<0)fail('nejdřív vytvořte platné povrchy ulic.');
  if(catalog.some(m=>![m.min,m.max,m.footMin,m.footMax,m.anchor].every(v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite))||!Number.isSafeInteger(m.vertices)||m.vertices<3||!osmPropLabels[m.kind]))fail('neplatné rozměry katalogu.');
  const models=catalog.filter(m=>o.models.some(c=>c.path.toLowerCase()===m.path.toLowerCase()&&c.sha256===m.sha256));if(models.length!==o.models.length)fail('katalog se změnil; načtěte jej znovu.');
  const buildings=osmBuildingFootprints(source).filter(b=>!b.reason&&!b.suppressed).flatMap(b=>b.polygons),road=surface.footprints.road,sidewalk=surface.footprints.sidewalk,walks=(green?.placements??[]).flatMap(p=>p.paths),occupied=[],placements=[],skipped=[],half=source.area.size/2,paths=source.ways.filter(w=>['footway','path','pedestrian'].includes(w.tags.highway)&&w.tags.area!=='yes'),streets=source.ways.filter(w=>w.eligible);let vertices=reservedVertices;
  for(const id of [...o.selected].sort((a,b)=>a-b)){
    const f=source.props?.find(p=>p.id===id);if(!f)fail(`bod ${id} není v podkladu.`);const skip=reason=>skipped.push({id,kind:f.kind,reason}),notes=[],t=f.tags;
    if(t.indoor==='yes'||t.layer&&t.layer!=='0'||t.bridge&&t.bridge!=='no'||t.tunnel&&t.tunnel!=='no'||['underground','roof','rooftop'].includes(t.location)||t.support&&!['pole','ground'].includes(t.support)){skip('Jiná úroveň nebo připevnění na stěnu vyžaduje ruční umístění.');continue;}
    let candidates=models.filter(m=>m.kind===f.kind);if(f.kind==='tree'&&t.leaf_type){if(!['broadleaved','needleleaved'].includes(t.leaf_type)){skip('Nepodporovaný typ listí vyžaduje ruční model.');continue;}candidates=candidates.filter(m=>m.leaf===t.leaf_type);}else if(f.kind==='tree'){candidates=candidates.filter(m=>m.leaf==='broadleaved');notes.push('Typ stromu není v mapě určený; použit povolený listnatý model.');}
    if(!candidates.length){skip('Pro tento typ není povolený dostupný model.');continue;}const m=candidates[id%candidates.length];let scale=1,heightSource='původní herní model',target=m.max[1]-m.anchor[1];
    if(['tree','lamp'].includes(f.kind)){
      const h=metres(t.height),estimate=f.kind==='tree'?metres(t.est_height):null,min=f.kind==='tree'?3:2,max=f.kind==='tree'?35:15;
      if(h!==null&&h>=min&&h<=max){target=h;heightSource='OSM height';}else if(estimate!==null&&estimate>=min&&estimate<=max){target=estimate;heightSource='OSM est_height (odhad)';}else {target=o[f.kind+'Height'];heightSource='ruční náhradní výška';if(t.height!==undefined)notes.push('Výška z mapy není použitelná.');}
      scale=target/(m.max[1]-m.anchor[1]);if(scale<.25||scale>3){skip('Cílová výška by příliš deformovala původní model.');continue;}
    }
    let heading=direction(t.direction),directionSource='OSM direction';
    if(heading===null){
      if(t.direction!==undefined)notes.push('Směr z mapy není použitelný.');let near=null,distance=Infinity;
      for(const way of [...paths,...streets])for(let i=1;i<way.points.length;i++){const a=way.points[i-1],b=way.points[i],dx=b[0]-a[0],dz=b[2]-a[2],q=dx*dx+dz*dz;if(q<1e-8)continue;const u=Math.max(0,Math.min(1,((f.point[0]-a[0])*dx+(f.point[2]-a[2])*dz)/q)),p=[a[0]+u*dx,a[2]+u*dz],d=Math.hypot(p[0]-f.point[0],p[1]-f.point[2]);if(d<distance){near=p;distance=d;}}
      heading=f.kind==='tree'?(id*137.508)%360:near?Math.atan2(near[0]-f.point[0],near[1]-f.point[2])*180/Math.PI:0;directionSource=f.kind==='tree'?'stabilní natočení náhradního modelu':near?'odhad: směrem k nejbližší cestě':'náhradní směr sever';
    }
    const a=-heading*Math.PI/180,rotation=[Math.cos(a/2),0,Math.sin(a/2),0].map(Math.fround),transform=frameMatrix({position:[0,0,0],rotation,scale:[scale,scale,scale]}),anchor=new Vector3(...m.anchor).applyMatrix4(transform),position=[f.point[0]-anchor.x,o.ground-anchor.y,f.point[2]-anchor.z].map(Math.fround),matrix=frameMatrix({position,rotation,scale:[scale,scale,scale]}),foot=(min,max,margin=0)=>[[[min[0]-margin,min[2]-margin],[max[0]+margin,min[2]-margin],[max[0]+margin,max[2]+margin],[min[0]-margin,max[2]+margin]].map(([x,z])=>{const p=new Vector3(x,0,z).applyMatrix4(matrix);return [p.x,p.z];})],base=foot(m.footMin,m.footMax,.1/scale),full=foot(m.min,m.max);
    if(full[0].some(p=>p.some(n=>Math.abs(n)>half))){skip('Model přesahuje hranici oblasti.');continue;}
    if(overlap(full,buildings)){skip('Model by zasahoval do mapované budovy.');continue;}
    if(overlap(base,road)||f.kind==='tree'&&overlap(base,walks)){skip('Základna by zasahovala do vozovky nebo strom do pěší cesty.');continue;}
    if(overlap(base,occupied)){skip('Základna by se překrývala s jiným osazeným objektem.');continue;}
    let ground=o.ground,groundSource='ruční základní rovina';
    if(overlap(base,sidewalk)){if(!within(base,sidewalk)){skip('Objekt by stál přes hranu vyvýšeného chodníku.');continue;}ground=surface.model.meshes.flatMap(mesh=>mesh.lods[0].positions.filter((n,i)=>i%3===1)).reduce((a,b)=>Math.max(a,b),-.1);groundSource='generovaný chodník';}
    else for(const lawn of green?.placements??[]){const region=[...lawn.grass,...lawn.paths];if(overlap(base,region)){if(!within(base,region)){skip('Objekt by stál přes hranu zeleně.');ground=null;break;}ground=lawn.height;groundSource='generovaná zeleň / pěší cesta';break;}}
    if(ground===null)continue;if(placements.length>=256||vertices+m.vertices>60000){skip('Limit 256 objektů nebo sdílený rozpočet kolizních vrcholů.');continue;}
    position[1]=Math.fround(ground-anchor.y);const item={id,name:`OSM_PROP_${id}`,label:t.name??`${osmPropLabels[f.kind]} ${id}`,kind:f.kind,model:m.path,modelHash:m.sha256,position,rotation,scale:[scale,scale,scale].map(Math.fround),footprint:base[0],height:target,heightSource,direction:heading,directionSource,ground,groundSource,opaqueOnly:f.kind==='tree',notes};
    if(f.kind==='lamp'&&o.lights)item.light={name:`OSM_LIGHT_${id}`,position:[f.point[0],ground+target-.25*scale,f.point[2]].map(Math.fround),parameters:{type:1,color:[1,.88,.65],power:.8,range:[.5,12],mode:99,sectors:['Primary sector']}};
    placements.push(item);occupied.push(base);vertices+=m.vertices;
  }
  return {placements,skipped};
}
