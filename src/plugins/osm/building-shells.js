import clipping from 'polygon-clipping';
import {ShapeUtils,Vector2} from 'three';
import {osmBuildingFootprints} from './footprints.js';
import {osmBuildingHeight} from './buildings.js';
import {osmSurfaceDefaults,osmSurfaceModel} from './surface.js';
import {osmRoofPlan,osmRaisedRoof,validateOsmRoofOptions} from './building-roofs.js';
import {osmBuildingSupport,osmBuildingFoundation} from './building-terrain.js';
import {validateOsmFacade,osmFacadePanels,osmFacadeTileSize,osmFacadeRing} from './building-facades.js';
import {validateOsmBuildingMatching,osmBuildingMatch} from './building-selection.js';

// Recipes reference the user's original BMPs. No game pixels are distributed.
// Tile sizes follow the source facade UVs, in native metres. Roof and trim
// textures may be shared between recipes; these are not copies of whole houses.
export const osmShellStyles=Object.freeze([
  {id:'brick',label:'Cihlový činžovní dům',source:'3rad03.4ds',textures:['maps/D3PATRO1.BMP','maps/D3PATRO2.BMP','maps/3STRE1.BMP','maps/35RIMSV.BMP'],width:5.8,upperHeight:7.14,groundWidth:5.8,groundHeight:3.6},
  {id:'shops',label:'Cihlový dům s obchody',source:'newdum8.4ds',textures:['maps/VYLOH34.BMP','maps/%ND5FAS.BMP','maps/3STRE1.BMP','maps/35RIMSV.BMP'],width:3.2,upperHeight:6.56,groundWidth:6.4,groundHeight:3.6},
  {id:'stone',label:'Kamenná fasáda s výkladci',source:'3rad02.4ds',textures:['maps/VYLOH14.BMP','maps/3OKNA5.BMP','maps/STRECH03.BMP','maps/35RIMSV.BMP'],width:6.24,upperHeight:8.01,groundWidth:2.35,groundHeight:2.89},
  {id:'rose',label:'Růžová omítka s cihlovým přízemím',source:'3rad05.4ds',textures:['maps/3CIH.BMP','maps/3OKNA7.BMP','maps/STRECH09.BMP','maps/35RIMSV.BMP'],width:5.47,upperHeight:3.9,groundWidth:2.18,groundHeight:2.6},
  {id:'ornate',label:'Zdobený městský dům',source:'%radovk5.4ds',textures:['maps/VYLOH18.BMP','maps/%NEFAS.BMP','maps/STRECH10.BMP','maps/35RIMSV.BMP'],width:7.32,upperHeight:14,groundWidth:3.44,groundHeight:3.03},
  {id:'green-stone',label:'Zelený kamenný dům',source:'%radovk9.4ds',textures:['maps/VYLOH03.BMP','maps/%NR6FAS.BMP','maps/STRECH10.BMP','maps/35RIMSV.BMP'],width:6.52,upperHeight:10.02,groundWidth:2.7,groundHeight:2.85},
  {id:'arched',label:'Dům s obloukovými okny',source:'%radovk10.4ds',textures:['maps/VYLOH14.BMP','maps/%NR7FAS.BMP','maps/STRECH10.BMP','maps/35RIMSV.BMP'],width:5.49,upperHeight:10.6,groundWidth:2.35,groundHeight:2.89},
  {id:'hotel',label:'Červenohnědá fasáda s výkladci',source:'%hotelv4.4ds',textures:['maps/VYLOH25.BMP','maps/%HOFAS.BMP','maps/STRECH10.BMP','maps/%HORIMD.BMP'],width:6.3,upperHeight:8.43,groundWidth:3.44,groundHeight:2.91},
  {id:'old-brick',label:'Starší cihlový městský dům',source:'dum01.4ds',textures:['maps/03.BMP','maps/01.BMP','maps/3STRE1.BMP','maps/35RIMSV.BMP'],width:6.55,upperHeight:7.88,groundWidth:4.8,groundHeight:4.43},
  {id:'grey-blocks',label:'Šedé kamenné kvádry',source:'3rad08.4ds',textures:['maps/3VYL2B.BMP','maps/3OKNA2A.BMP','maps/3STRE1.BMP','maps/35RIMSV.BMP'],width:5.07,upperHeight:6.94,groundWidth:4.55,groundHeight:3.55},
  {id:'carved-stone',label:'Kamenná fasáda s ozdobnými překlady',source:'3rad02.4ds',textures:['maps/VYLOH14.BMP','maps/3OKNA3.BMP','maps/STRECH03.BMP','maps/35RIMSV.BMP'],width:2.57,upperHeight:3.54,groundWidth:2.35,groundHeight:2.89},
  {id:'tall-stone',label:'Světlý kámen s vysokými okny',source:'3rad02.4ds',textures:['maps/VYLOH14.BMP','maps/3OKNA4.BMP','maps/STRECH03.BMP','maps/35RIMSV.BMP'],width:5.22,upperHeight:3.69,groundWidth:2.35,groundHeight:2.89},
  {id:'sandstone',label:'Písková fasáda s tmavými okny',source:'3rad04.4ds',textures:['maps/3DVERE5.BMP','maps/3OKNA9.BMP','maps/0V1STRE.BMP','maps/35RIMSV.BMP'],width:5.38,upperHeight:6.02,groundWidth:3.45,groundHeight:3.17},
  {id:'terracotta',label:'Terakotová omítka s vysokými okny',source:'3rad10.4ds',textures:['maps/3VYL01.BMP','maps/3OKNA6.BMP','maps/3STRE1.BMP','maps/35RIMSV.BMP'],width:5.57,upperHeight:3.03,groundWidth:2.54,groundHeight:3.48},
  {id:'dark-brick',label:'Tmavá cihla s plochými překlady',source:'newdum1.4ds',textures:['maps/SPODEK08.BMP','maps/%ND6FAS.BMP','maps/3STRE1.BMP','maps/35RIMSV.BMP'],width:5.34,upperHeight:5.71,groundWidth:8.01,groundHeight:4},
  {id:'red-brick',label:'Červená cihla se světlými rámy',source:'4build13.4ds',textures:['maps/VYLOH04.BMP','maps/5OKNA03.BMP','maps/STRECH05.BMP','maps/35RIMSV.BMP'],width:5.85,upperHeight:5.5,groundWidth:2.94,groundHeight:3.02},
  {id:'warm-brick',label:'Teplá cihla s kamenným soklem',source:'4build20.4ds',textures:['maps/PDZKA13.BMP','maps/5OKNA06.BMP','maps/3STRE1.BMP','maps/35RIMSV.BMP'],width:4.39,upperHeight:5.09,groundWidth:2.46,groundHeight:1.35},
  {id:'white-stone',label:'Bílý kámen se zdobenými římsami',source:'4build36.4ds',textures:['maps/5VYLOHA6.BMP','maps/5OKNA17.BMP','maps/STRECH01.BMP','maps/35RIMSV.BMP'],width:8.35,upperHeight:8.55,groundWidth:3.89,groundHeight:4.66},
  {id:'cream',label:'Světlá omítka s tmavými rámy',source:'%radovk40.4ds',textures:['maps/%ND7SPD.BMP','maps/%ND7FAS.BMP','maps/STRECH10.BMP','maps/35RIMSV.BMP'],width:6,upperHeight:4.91,groundWidth:6,groundHeight:3},
  {id:'green-ornate',label:'Zelená omítka se zdobenými okny',source:'%radovk25.4ds',textures:['maps/VYLOH20.BMP','maps/%FASDM6.BMP','maps/STRECH10.BMP','maps/35RIMSV.BMP'],width:3.28,upperHeight:7.88,groundWidth:3.69,groundHeight:2.94},
  {id:'blue',label:'Modrá omítka s kamennými rámy',source:'%radovk26.4ds',textures:['maps/VYLOH16.BMP','maps/%FASDM7.BMP','maps/STRECH10.BMP','maps/35RIMSV.BMP'],width:3.27,upperHeight:3.85,groundWidth:4,groundHeight:3.63},
  {id:'charcoal',label:'Tmavá omítka s kamennými rámy',source:'%radovk27.4ds',textures:['maps/VYLOH03.BMP','maps/%FASDM8.BMP','maps/STRECH10.BMP','maps/35RIMSV.BMP'],width:3.26,upperHeight:3.58,groundWidth:5,groundHeight:3.63},
  {id:'ochre',label:'Okrová fasáda s obloukovým reliéfem',source:'9dum1.4ds',textures:['maps/VYLOH19.BMP','maps/%FASD_1.BMP','maps/STRECH10.BMP','maps/35RIMSV.BMP'],width:3,upperHeight:6.85,groundWidth:4.16,groundHeight:2.94},
  {id:'arched-brick',label:'Cihlová fasáda s bílými oblouky',source:'9dum2.4ds',textures:['maps/VYLOH20.BMP','maps/%FADUM2.BMP','maps/STRECH10.BMP','maps/35RIMSV.BMP'],width:5.9,upperHeight:7.51,groundWidth:3.69,groundHeight:2.94},
  {id:'brick-relief',label:'Cihla s oválnými reliéfy',source:'4build55.4ds',textures:['maps/5STENA15.BMP','maps/5OKNA34.BMP','maps/3STRE1.BMP','maps/35RIMSV.BMP'],width:4.14,upperHeight:8.58,groundWidth:4.14,groundHeight:3.96},
  {id:'sage-relief',label:'Šalvějová omítka s reliéfy',source:'4build55z.4ds',textures:['maps/5STENA16.BMP','maps/5OKNA36.BMP','maps/STRECH10.BMP','maps/35RIMSV.BMP'],width:4.13,upperHeight:8.58,groundWidth:4.14,groundHeight:3.4},
  {id:'arched-orange',label:'Oranžová cihla s obloukovými překlady',source:'4build60.4ds',textures:['maps/5STENA17.BMP','maps/5OKNA38.BMP','maps/3STRE1.BMP','maps/35RIMSV.BMP'],width:3.77,upperHeight:8.59,groundWidth:5.77,groundHeight:3.56},
  {id:'pale-columns',label:'Světlý kámen se sloupky',source:'tbuild07.4ds',textures:['maps/5ZSPOD02.BMP','maps/5OKNA43.BMP','maps/STRECH10.BMP','maps/35RIMSV.BMP'],width:6.14,upperHeight:11.68,groundWidth:7.51,groundHeight:4.17},
  {id:'cream-lintels',label:'Krémová omítka s cihlovými překlady',source:'tbuild11.4ds',textures:['maps/VYLOH32.BMP','maps/5OKNA46.BMP','maps/3STRE1.BMP','maps/35RIMSV.BMP'],width:8.26,upperHeight:7.48,groundWidth:8,groundHeight:3.33},
  {id:'peach-arches',label:'Broskvová omítka se zdobenými oblouky',source:'4build81d.4ds',textures:['maps/SPODEK06.BMP','maps/5OKNA51B.BMP','maps/STRECH10.BMP','maps/35RIMSV.BMP'],width:6.44,upperHeight:10.9,groundWidth:9.93,groundHeight:6.1},
]);
const fail=message=>{throw Error(`OpenStreetMap · půdorysné domy: ${message}`);};
const signed=r=>r.reduce((s,a,i)=>{const b=r[(i+1)%r.length];return s+a[0]*b[1]-b[0]*a[1];},0)/2;
const area=mp=>mp.reduce((sum,p)=>sum+Math.abs(signed(p[0]))-p.slice(1).reduce((s,r)=>s+Math.abs(signed(r)),0),0);
const idValid=id=>Number.isSafeInteger(id)&&id>0||typeof id==='string'&&/^relation\/[1-9]\d*\/[1-9]\d*$/.test(id);
function settings(options){
  if(!options||options.version!==1||options.mode!=='footprint'||!Array.isArray(options.selected)||options.selected.length>128||new Set(options.selected).size!==options.selected.length||options.selected.some(id=>!idValid(id))||!Array.isArray(options.styles)||!options.styles.length||options.styles.length>osmShellStyles.length||new Set(options.styles.map(s=>s?.id)).size!==options.styles.length||options.styles.some(s=>!osmShellStyles.some(r=>r.id===s?.id))||!Number.isFinite(options.fallbackHeight)||options.fallbackHeight<5||options.fallbackHeight>60||!Number.isFinite(options.ground)||Math.abs(options.ground)>5)fail('neplatné nastavení nebo výběr.');
  validateOsmRoofOptions(options.roof);
  validateOsmFacade(options.facade);
  validateOsmBuildingMatching(options.matching);
}
// Exterior shell only. Courtyard walls and roof holes remain explicit.
export function osmShellModel(item){
  validateOsmFacade(item?.facade);
  const style=osmShellStyles.find(s=>s.id===item?.style),polygon=item?.polygon;
  if(!style||!Array.isArray(polygon)||!polygon.length||polygon.length>32||polygon.some(r=>!Array.isArray(r)||r.length<3||r.length>256||r.some(p=>!Array.isArray(p)||p.length!==2||p.some(n=>!Number.isFinite(n)||Math.abs(n)>450)))||!Number.isFinite(item.height)||item.height<3||item.height>120||!Array.isArray(item.position)||item.position.length!==3||item.position.some(n=>!Number.isFinite(n)))fail('neplatná geometrie domu.');
  const fillTexture=item.facadeTexture??`maps/WB_OSMF_${style.id}.BMP`;
  if(item.facade&&!/^maps\/WB_OSMF_[A-Za-z0-9_-]{1,90}\.bmp$/i.test(fillTexture))fail('neplatná textura výplně fasády.');
  const textures=[...style.textures,...(item.facade?[fillTexture]:[])];
  const rings=polygon.map((r,i)=>{const copy=r.map(p=>[Math.fround(p[0]-item.position[0]),Math.fround(p[1]-item.position[2])]);if((signed(copy)>0)!==(i===0))copy.reverse();return copy;}),positions=[],normals=[],uv=[],faces=textures.map((_,i)=>({material:i+1,indices:[]}));
  function triangle(points,tex,material){
    points=points.map(p=>p.map(Math.fround));const[a,b,c]=points,u=b.map((n,i)=>n-a[i]),v=c.map((n,i)=>n-a[i]),n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],length=Math.hypot(...n);if(length<1e-8)fail('nulová plocha po převodu na nativní souřadnice.');
    if(positions.length/3+3>60000)fail('dům překračuje 60 000 vrcholů.');const at=positions.length/3;positions.push(...points.flat());normals.push(...Array(3).fill(n.map(x=>Math.fround(x/length))).flat());uv.push(...tex.flat().map(Math.fround));faces[material-1].indices.push(at,at+1,at+2);
  }
  const top=Math.fround(item.height),raised=item.roofPlan&&item.roofPlan.shape!=='flat',wallTop=raised?Math.fround(top-item.roofPlan.height):top,trim=Math.fround(wallTop-.25),ground=Math.fround(Math.min(style.groundHeight,trim-(item.facade?0:1)));
  for(const ring of item.facade?rings.map(osmFacadeRing):rings)for(const[a,i]of ring.map((p,i)=>[p,i])){
    const b=ring[(i+1)%ring.length],length=Math.hypot(b[0]-a[0],b[1]-a[1]);if(length<.001)fail('příliš krátká hrana.');
    if(item.facade){
      for(const panel of [...osmFacadePanels(length,ground,trim,style),{x0:0,x1:length,y0:trim,y1:wallTop,material:4,uv:[0,0,length,1]}]){
        const {x0,x1,y0,y1,material,uv:[u0,v0,u1,v1]}=panel,at=x=>[a[0]+(b[0]-a[0])*x/length,a[1]+(b[1]-a[1])*x/length],lo=at(x0),hi=at(x1),p=[[lo[0],y0,lo[1]],[lo[0],y1,lo[1]],[hi[0],y0,hi[1]],[hi[0],y1,hi[1]]],t=[[u0,v1],[u0,v0],[u1,v1],[u1,v0]];
        for(const ids of [[0,1,2],[2,1,3]])triangle(ids.map(j=>p[j]),ids.map(j=>t[j]),material);
      }
      continue;
    }
    for(const[lo,hi,material,tileWidth,tileHeight]of [[0,ground,1,style.groundWidth,style.groundHeight],[ground,trim,2,style.width,style.upperHeight],[trim,wallTop,4,1,.25]]){
      // Prefer whole texture bays when the adjustment stays within 15%; short
      // edges keep metric UVs instead of stretching a whole window across them.
      const raw=length/tileWidth,nearest=Math.round(raw),u=nearest>0&&Math.abs(nearest/raw-1)<=.15?nearest:raw,v=(hi-lo)/tileHeight;
      const p=[[a[0],lo,a[1]],[a[0],hi,a[1]],[b[0],lo,b[1]],[b[0],hi,b[1]]],t=[[0,v],[0,0],[u,v],[u,0]];
      for(const ids of [[0,1,2],[2,1,3]])triangle(ids.map(j=>p[j]),ids.map(j=>t[j]),material);
    }
  }
  const [fillWidth,fillHeight]=item.facade?osmFacadeTileSize(style):[1,1];
  if(raised)osmRaisedRoof(rings,item.roofPlan,top,style,item.facade?(p,t,m)=>triangle(p,m===2?t.map(([u,v])=>[u*style.width/fillWidth,v*style.upperHeight/fillHeight]):t,m===2?5:m):triangle);
  else{
    const vectors=rings.map(r=>r.map(p=>new Vector2(...p))),vertices=vectors.flat(),roof=ShapeUtils.triangulateShape(vectors[0],vectors.slice(1));
    if(!roof.length)fail('střechu nelze triangulovat.');
    for(let ids of roof){let p=ids.map(i=>vertices[i]);if((p[1].x-p[0].x)*(p[2].y-p[0].y)-(p[1].y-p[0].y)*(p[2].x-p[0].x)>0)p=[p[0],p[2],p[1]];triangle(p.map(p=>[p.x,top,p.y]),p.map(p=>[p.x/4,p.y/4]),3);}
  }
  const result={version:29,materials:textures.map(path=>({flags:0x00840001,ambient:[1,1,1],diffuse:[1,1,1],emission:[0,0,0],opacity:1,texture:path.slice(5)})),meshes:[{id:1,name:'OSM_HOUSE',type:1,visual:0,renderFlags:0,logicFlags:0x2a,culling:9,parent:0,position:[0,0,0],rotation:[1,0,0,0],scale:[1,1,1],lods:[{distance:0,vertices:positions.length/3,positions,normals,uv,faces}]}],animated:0};
  if(item.support){const foundation=osmBuildingFoundation(item.support,item.position);result.materials.push(...foundation.materials);result.meshes.push(...foundation.meshes.map(m=>({...m,id:2,lods:m.lods.map(l=>({...l,faces:l.faces.map(f=>({...f,material:textures.length+1}))}))})));}
  return result;
}
export function osmShellPlan(source,roads,surface,options,reserved={footprints:[],vertices:0,count:0}){
  settings(options);if(!Number.isFinite(source?.area?.size)||source.area.size<50||source.area.size>450)fail('neplatná oblast.');
  if(!Array.isArray(reserved?.footprints)||!Number.isSafeInteger(reserved.vertices)||reserved.vertices<0||reserved.vertices>60000||!Number.isSafeInteger(reserved.count)||reserved.count<0||reserved.count>64)fail('neplatná rezervace původních domů.');
  surface??=osmSurfaceModel(roads,source.area,osmSurfaceDefaults);
  const buildings=osmBuildingFootprints(source),placements=[],skipped=[],occupied=[...reserved.footprints],half=source.area.size/2,exclusions=[...surface.footprints.road,...surface.footprints.sidewalk];
  let budget=60000-reserved.vertices-new Set(surface.model.meshes.flatMap(m=>{const p=m.lods[0].positions;return Array.from({length:p.length/3},(_,i)=>p.slice(i*3,i*3+3).map(Math.fround).join('/'));})).size;
  for(const id of options.selected){
    const feature=buildings.find(b=>b.id===id);if(!feature||feature.suppressed)fail(`půdorys ${id} není v podkladu.`);
    const skip=reason=>skipped.push({way:id,name:feature.tags.name??String(id),reason});if(feature.reason){skip(feature.reason);continue;}
    const tags=feature.tags;
    if(['no','roof','ruins','church','cathedral','chapel','mosque','tower','bridge','construction'].includes(tags.building)||tags['building:part']&&tags['building:part']!=='no'||tags.min_height&&Number(tags.min_height)!==0||tags['building:min_level']&&tags['building:min_level']!=='0'||tags.layer&&tags.layer!=='0'){skip('Zvláštní typ stavby, části nebo výšková úroveň vyžaduje ruční model.');continue;}
    const match=options.matching?osmBuildingMatch(tags,options.fallbackHeight):null;
    if(match?.kind==='unsupported'){skip(match.note);continue;}
    const polygon=feature.polygons[0];if(polygon.some(r=>r.some(p=>p.some(n=>!Number.isFinite(n)||Math.abs(n)>half)))){skip('Budova přesahuje hranici oblasti; půdorys se neořezává.');continue;}
    if(area([polygon])<16){skip('Půdorys je příliš malý.');continue;}
    if(exclusions.length&&area(clipping.intersection(polygon,exclusions))>.0001||occupied.length&&area(clipping.intersection(polygon,occupied))>.0001){skip('Půdorys zasahuje do vozovky, chodníku nebo jiné budovy.');continue;}
    if(placements.length+reserved.count>=64){skip(reserved.count?'Limit společného importu je 64 domů.':'Limit importu je 64 půdorysných domů.');continue;}
    const ring=polygon[0],target=osmBuildingHeight(tags,match?.fallbackHeight??options.fallbackHeight),center=[0,1].map(k=>(Math.min(...ring.map(p=>p[k]))+Math.max(...ring.map(p=>p[k])))/2),key=String(id),seed=[...key].reduce((n,c)=>(n*31+c.charCodeAt(0))>>>0,0),style=options.styles[seed%options.styles.length].id;
    if(match&&match.fallbackHeight!==options.fallbackHeight&&target.heightSource==='ruční náhradní výška')target.heightSource=`odhad podle typu OSM: ${target.height} m (omezený náhradní výškou)`;
    const item={way:id,name:feature.relation?`OSM_R_${feature.relation}_${feature.component??1}`:`OSM_B_${id}`,label:tags.name??`Budova ${id}`,polygon:structuredClone(polygon),footprint:structuredClone(ring),style,position:[Math.fround(center[0]),options.ground,Math.fround(center[1])],rotation:[1,0,0,0],scale:[1,1,1],coverage:1,modelHeight:target.height,...target,roof:'flat',...(feature.relation?{relation:feature.relation,component:feature.component}:{}),notes:['Vnější plášť bez interiéru; plochá střecha je zjednodušení.']};
    const roof=osmRoofPlan(tags,polygon,target,options.roof);if(roof){Object.assign(item,roof);item.modelHeight=item.height;item.notes.unshift('Vnější plášť bez interiéru; tvar střechy je zjednodušení.');}
    if(options.facade){item.facade={...options.facade};item.notes.push('Celé bloky a řady oken; zbylá šířka/výška a štíty používají náhradní zdivo nebo omítku.');}
    if(item.height>120){skip('Odhad výšky přesahuje podporovaných 120 m.');continue;}
    if(surface.elevation){const support=osmBuildingSupport(surface,source.area,polygon,options.ground);if(support.reason){skip(support.reason);continue;}item.support=support;item.position[1]=support.ground;item.notes.push('Vodorovná základna se soklem podle celého terénního půdorysu; odhad bez terasování.');}
    const model=osmShellModel(item),vertices=new Set(model.meshes.flatMap(m=>{const lod=m.lods[0];return Array.from({length:lod.vertices},(_,i)=>lod.positions.slice(i*3,i*3+3).join('/'));})).size;
    if(vertices>budget){skip('Dům by překročil bezpečný limit vrcholů nativních kolizí.');continue;}budget-=vertices;
    item.triangles=model.meshes.reduce((s,m)=>s+m.lods[0].faces.reduce((n,f)=>n+f.indices.length/3,0),0);placements.push(item);occupied.push(polygon);
  }
  return {mode:'footprint',placements,skipped};
}
