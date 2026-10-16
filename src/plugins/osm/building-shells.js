import clipping from 'polygon-clipping';
import {ShapeUtils,Vector2} from 'three';
import {osmBuildingFootprints} from './footprints.js';
import {osmBuildingHeight} from './buildings.js';
import {osmSurfaceDefaults,osmSurfaceModel} from './surface.js';
import {osmRoofPlan,osmRaisedRoof,validateOsmRoofOptions} from './building-roofs.js';

// Recipes reference the user's original BMPs. No game pixels are distributed.
// Tile sizes follow the facade UVs of 3rad03/newdum8, in native metres.
export const osmShellStyles=Object.freeze([
  {id:'brick',label:'Cihlový činžovní dům',textures:['maps/D3PATRO1.BMP','maps/D3PATRO2.BMP','maps/3STRE1.BMP','maps/35RIMSV.BMP'],width:5.8,upperHeight:7.14,groundWidth:5.8,groundHeight:3.6},
  {id:'shops',label:'Cihlový dům s obchody',textures:['maps/VYLOH34.BMP','maps/%ND5FAS.BMP','maps/3STRE1.BMP','maps/35RIMSV.BMP'],width:3.2,upperHeight:6.56,groundWidth:6.4,groundHeight:3.6},
]);
const fail=message=>{throw Error(`OpenStreetMap · půdorysné domy: ${message}`);};
const signed=r=>r.reduce((s,a,i)=>{const b=r[(i+1)%r.length];return s+a[0]*b[1]-b[0]*a[1];},0)/2;
const area=mp=>mp.reduce((sum,p)=>sum+Math.abs(signed(p[0]))-p.slice(1).reduce((s,r)=>s+Math.abs(signed(r)),0),0);
const idValid=id=>Number.isSafeInteger(id)&&id>0||typeof id==='string'&&/^relation\/[1-9]\d*\/[1-9]\d*$/.test(id);
function settings(options){
  if(!options||options.version!==1||options.mode!=='footprint'||!Array.isArray(options.selected)||options.selected.length>128||new Set(options.selected).size!==options.selected.length||options.selected.some(id=>!idValid(id))||!Array.isArray(options.styles)||!options.styles.length||options.styles.length>osmShellStyles.length||new Set(options.styles.map(s=>s?.id)).size!==options.styles.length||options.styles.some(s=>!osmShellStyles.some(r=>r.id===s?.id))||!Number.isFinite(options.fallbackHeight)||options.fallbackHeight<5||options.fallbackHeight>60||!Number.isFinite(options.ground)||Math.abs(options.ground)>5)fail('neplatné nastavení nebo výběr.');
  validateOsmRoofOptions(options.roof);
}
// Exterior shell only. Courtyard walls and roof holes remain explicit.
export function osmShellModel(item){
  const style=osmShellStyles.find(s=>s.id===item?.style),polygon=item?.polygon;
  if(!style||!Array.isArray(polygon)||!polygon.length||polygon.length>32||polygon.some(r=>!Array.isArray(r)||r.length<3||r.length>256||r.some(p=>!Array.isArray(p)||p.length!==2||p.some(n=>!Number.isFinite(n)||Math.abs(n)>450)))||!Number.isFinite(item.height)||item.height<3||item.height>120||!Array.isArray(item.position)||item.position.length!==3||item.position.some(n=>!Number.isFinite(n)))fail('neplatná geometrie domu.');
  const rings=polygon.map((r,i)=>{const copy=r.map(p=>[Math.fround(p[0]-item.position[0]),Math.fround(p[1]-item.position[2])]);if((signed(copy)>0)!==(i===0))copy.reverse();return copy;}),positions=[],normals=[],uv=[],faces=style.textures.map((_,i)=>({material:i+1,indices:[]}));
  function triangle(points,tex,material){
    points=points.map(p=>p.map(Math.fround));const[a,b,c]=points,u=b.map((n,i)=>n-a[i]),v=c.map((n,i)=>n-a[i]),n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],length=Math.hypot(...n);if(length<1e-8)fail('nulová plocha po převodu na nativní souřadnice.');
    if(positions.length/3+3>60000)fail('dům překračuje 60 000 vrcholů.');const at=positions.length/3;positions.push(...points.flat());normals.push(...Array(3).fill(n.map(x=>Math.fround(x/length))).flat());uv.push(...tex.flat().map(Math.fround));faces[material-1].indices.push(at,at+1,at+2);
  }
  const top=Math.fround(item.height),raised=item.roofPlan&&item.roofPlan.shape!=='flat',wallTop=raised?Math.fround(top-item.roofPlan.height):top,trim=Math.fround(wallTop-.25),ground=Math.fround(Math.min(style.groundHeight,trim-1));
  for(const ring of rings)for(const[a,i]of ring.map((p,i)=>[p,i])){
    const b=ring[(i+1)%ring.length],length=Math.hypot(b[0]-a[0],b[1]-a[1]);if(length<.001)fail('příliš krátká hrana.');
    for(const[lo,hi,material,tileWidth,tileHeight]of [[0,ground,1,style.groundWidth,style.groundHeight],[ground,trim,2,style.width,style.upperHeight],[trim,wallTop,4,1,.25]]){
      // Prefer whole texture bays when the adjustment stays within 15%; short
      // edges keep metric UVs instead of stretching a whole window across them.
      const raw=length/tileWidth,nearest=Math.round(raw),u=nearest>0&&Math.abs(nearest/raw-1)<=.15?nearest:raw,v=(hi-lo)/tileHeight;
      const p=[[a[0],lo,a[1]],[a[0],hi,a[1]],[b[0],lo,b[1]],[b[0],hi,b[1]]],t=[[0,v],[0,0],[u,v],[u,0]];
      for(const ids of [[0,1,2],[2,1,3]])triangle(ids.map(j=>p[j]),ids.map(j=>t[j]),material);
    }
  }
  if(raised)osmRaisedRoof(rings,item.roofPlan,top,style,triangle);
  else{
    const vectors=rings.map(r=>r.map(p=>new Vector2(...p))),vertices=vectors.flat(),roof=ShapeUtils.triangulateShape(vectors[0],vectors.slice(1));
    if(!roof.length)fail('střechu nelze triangulovat.');
    for(let ids of roof){let p=ids.map(i=>vertices[i]);if((p[1].x-p[0].x)*(p[2].y-p[0].y)-(p[1].y-p[0].y)*(p[2].x-p[0].x)>0)p=[p[0],p[2],p[1]];triangle(p.map(p=>[p.x,top,p.y]),p.map(p=>[p.x/4,p.y/4]),3);}
  }
  return {version:29,materials:style.textures.map(path=>({flags:0x00840001,ambient:[1,1,1],diffuse:[1,1,1],emission:[0,0,0],opacity:1,texture:path.slice(5)})),meshes:[{id:1,name:'OSM_HOUSE',type:1,visual:0,renderFlags:0,logicFlags:0x2a,culling:9,parent:0,position:[0,0,0],rotation:[1,0,0,0],scale:[1,1,1],lods:[{distance:0,vertices:positions.length/3,positions,normals,uv,faces}]}],animated:0};
}
export function osmShellPlan(source,roads,surface,options){
  settings(options);if(!Number.isFinite(source?.area?.size)||source.area.size<50||source.area.size>450)fail('neplatná oblast.');
  surface??=osmSurfaceModel(roads,source.area,osmSurfaceDefaults);
  const buildings=osmBuildingFootprints(source),placements=[],skipped=[],occupied=[],half=source.area.size/2,exclusions=[...surface.footprints.road,...surface.footprints.sidewalk];
  let budget=60000-new Set(surface.model.meshes.flatMap(m=>{const p=m.lods[0].positions;return Array.from({length:p.length/3},(_,i)=>p.slice(i*3,i*3+3).map(Math.fround).join('/'));})).size;
  for(const id of options.selected){
    const feature=buildings.find(b=>b.id===id);if(!feature||feature.suppressed)fail(`půdorys ${id} není v podkladu.`);
    const skip=reason=>skipped.push({way:id,name:feature.tags.name??String(id),reason});if(feature.reason){skip(feature.reason);continue;}
    const tags=feature.tags;
    if(['no','roof','ruins','church','cathedral','chapel','mosque','tower','bridge','construction'].includes(tags.building)||tags['building:part']&&tags['building:part']!=='no'||tags.min_height&&Number(tags.min_height)!==0||tags['building:min_level']&&tags['building:min_level']!=='0'||tags.layer&&tags.layer!=='0'){skip('Zvláštní typ stavby, části nebo výšková úroveň vyžaduje ruční model.');continue;}
    const polygon=feature.polygons[0];if(polygon.some(r=>r.some(p=>p.some(n=>!Number.isFinite(n)||Math.abs(n)>half)))){skip('Budova přesahuje hranici oblasti; půdorys se neořezává.');continue;}
    if(area([polygon])<16){skip('Půdorys je příliš malý.');continue;}
    if(exclusions.length&&area(clipping.intersection(polygon,exclusions))>.0001||occupied.length&&area(clipping.intersection(polygon,occupied))>.0001){skip('Půdorys zasahuje do vozovky, chodníku nebo jiné budovy.');continue;}
    if(placements.length>=64){skip('Limit importu je 64 půdorysných domů.');continue;}
    const ring=polygon[0],target=osmBuildingHeight(tags,options.fallbackHeight),center=[0,1].map(k=>(Math.min(...ring.map(p=>p[k]))+Math.max(...ring.map(p=>p[k])))/2),key=String(id),seed=[...key].reduce((n,c)=>(n*31+c.charCodeAt(0))>>>0,0),style=options.styles[seed%options.styles.length].id;
    const item={way:id,name:feature.relation?`OSM_R_${feature.relation}_${feature.component??1}`:`OSM_B_${id}`,label:tags.name??`Budova ${id}`,polygon:structuredClone(polygon),footprint:structuredClone(ring),style,position:[Math.fround(center[0]),options.ground,Math.fround(center[1])],rotation:[1,0,0,0],scale:[1,1,1],coverage:1,modelHeight:target.height,...target,roof:'flat',...(feature.relation?{relation:feature.relation,component:feature.component}:{}),notes:['Vnější plášť bez interiéru; plochá střecha je zjednodušení.']};
    const roof=osmRoofPlan(tags,polygon,target,options.roof);if(roof){Object.assign(item,roof);item.modelHeight=item.height;item.notes.unshift('Vnější plášť bez interiéru; tvar střechy je zjednodušení.');}
    if(item.height>120){skip('Odhad výšky přesahuje podporovaných 120 m.');continue;}
    const model=osmShellModel(item),lod=model.meshes[0].lods[0],vertices=new Set(Array.from({length:lod.vertices},(_,i)=>lod.positions.slice(i*3,i*3+3).join('/'))).size;
    if(vertices>budget){skip('Dům by překročil bezpečný limit vrcholů nativních kolizí.');continue;}budget-=vertices;
    item.triangles=lod.faces.reduce((s,f)=>s+f.indices.length/3,0);placements.push(item);occupied.push(polygon);
  }
  return {mode:'footprint',placements,skipped};
}
