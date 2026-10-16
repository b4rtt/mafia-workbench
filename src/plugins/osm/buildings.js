import clipping from 'polygon-clipping';
import {osmSurfaceModel,osmSurfaceDefaults} from './surface.js';
import {osmBuildingFootprints} from './footprints.js';
const fail=message=>{throw Error(`OpenStreetMap · budovy: ${message}`);};
const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
const area=ring=>Math.abs(ring.reduce((s,a,i)=>{const b=ring[(i+1)%ring.length];return s+a[0]*b[1]-b[0]*a[1];},0))/2;
const polygonArea=polygons=>polygons.reduce((s,p)=>s+area(p[0])-p.slice(1).reduce((n,r)=>n+area(r),0),0);
function inside(p,ring){let yes=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){
  const a=ring[j],b=ring[i];if(Math.abs(cross(a,b,p))<1e-6&&p[0]>=Math.min(a[0],b[0])-1e-6&&p[0]<=Math.max(a[0],b[0])+1e-6&&p[1]>=Math.min(a[1],b[1])-1e-6&&p[1]<=Math.max(a[1],b[1])+1e-6)return true;
  if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])yes=!yes;
}return yes;}
function crosses(a,b,c,d){return cross(a,b,c)*cross(a,b,d)<-1e-10&&cross(c,d,a)*cross(c,d,b)<-1e-10;}
function contained(rect,ring){return rect.every(p=>inside(p,ring))&&!rect.some((a,i)=>ring.some((c,j)=>crosses(a,rect[(i+1)%4],c,ring[(j+1)%ring.length])));}
function targetHeight(tags,fallback){
  const h=/^(\d+(?:\.\d+)?)(?: (m|ft))?$/.exec(tags.height??'');
  if(h){const n=Number(h[1])*(h[2]==='ft'?.3048:1);if(n>=3&&n<=120)return {height:n,heightSource:'OSM height',estimated:false};}
  if(/^[1-9]\d?$/.test(tags['building:levels']??''))return {height:Number(tags['building:levels'])*3+3,heightSource:'odhad: OSM building:levels × 3 m + 3 m střecha',estimated:true};
  return {height:fallback,heightSource:'ruční náhradní výška',estimated:true};
}
// The original model is a substitute, never a reconstruction of a landmark.
// Its entire conservative XZ bounds must fit the actual closed OSM outline.
export function osmBuildingPlan(source,roads,surface,catalog,options){
  if(!source?.area||!Array.isArray(source.ways)||!Array.isArray(catalog)||!catalog.length||catalog.length>16||!options||options.version!==1||!Array.isArray(options.selected)||options.selected.length>128||new Set(options.selected).size!==options.selected.length||options.selected.some(id=>!(Number.isSafeInteger(id)&&id>0)&&!(typeof id==='string'&&/^relation\/[1-9]\d*\/[1-9]\d*$/.test(id)))||typeof options.adjustScale!=='boolean'||typeof options.minCoverage!=='number'||!Number.isFinite(options.minCoverage)||options.minCoverage<.25||options.minCoverage>.9||typeof options.fallbackHeight!=='number'||!Number.isFinite(options.fallbackHeight)||options.fallbackHeight<5||options.fallbackHeight>60||typeof options.ground!=='number'||!Number.isFinite(options.ground)||Math.abs(options.ground)>5)fail('neplatné nastavení nebo výběr.');
  for(const m of catalog)if(typeof m.path!=='string'||typeof m.sha256!=='string'||[m.min,m.max].some(a=>!Array.isArray(a)||a.length!==3||a.some(n=>!Number.isFinite(n)||Math.abs(n)>1000))||m.min.some((n,i)=>n>=m.max[i])||!Number.isSafeInteger(m.vertices)||m.vertices<3||m.vertices>60000)fail('neplatné rozměry modelu.');
  // Even a network-only import reserves the default road/pavement corridor.
  surface??=osmSurfaceModel(roads,source.area,osmSurfaceDefaults);
  const footprints=osmBuildingFootprints(source),placements=[],skipped=[],half=source.area.size/2,occupied=[],chains=roads.roads.map(r=>[roads.crossings[r.from].position,...r.positions,roads.crossings[r.to].position]);
  const streetVertices=new Set(surface?.model.meshes.flatMap(m=>{const p=m.lods[0].positions;return Array.from({length:p.length/3},(_,i)=>p.slice(i*3,i*3+3).map(Math.fround).join('/'));})??[]);let vertexBudget=60000-streetVertices.size;
  const exclusions=[...(surface?.footprints.road??[]),...(surface?.footprints.sidewalk??[])];
  for(const id of options.selected){
    const way=footprints.find(w=>w.id===id);if(!way?.tags.building&&!way?.relation)fail(`půdorys ${id} není v podkladu.`);
    const skip=reason=>skipped.push({way:id,name:way.tags.name??String(id),reason});
    if(way.reason){skip(way.reason);continue;}
    if(['no','roof','ruins','church','cathedral','chapel','mosque','tower','bridge','construction'].includes(way.tags.building)||way.tags['building:part']&&way.tags['building:part']!=='no'||way.tags.min_height&&Number(way.tags.min_height)!==0||way.tags['building:min_level']&&way.tags['building:min_level']!=='0'||way.tags.layer&&way.tags.layer!=='0'){skip('Zvláštní typ stavby, části nebo výšková úroveň vyžaduje ruční model.');continue;}
    const polygon=way.polygons[0],ring=polygon[0],size=polygonArea([polygon]);
    if(polygon.some(r=>r.some(p=>p.some(n=>!Number.isFinite(n)||Math.abs(n)>half)))){skip('Budova přesahuje hranici oblasti; půdorys se neořezává.');continue;}
    if(size<16||ring.some((a,i)=>ring.some((c,j)=>i!==j&&(i+1)%ring.length!==j&&(j+1)%ring.length!==i&&crosses(a,ring[(i+1)%ring.length],c,ring[(j+1)%ring.length])))){skip('Půdorys je příliš malý nebo se protíná.');continue;}
    const angles=polygon.flatMap(ring=>ring.map((a,i)=>{const b=ring[(i+1)%ring.length];return {angle:Math.atan2(b[1]-a[1],b[0]-a[0]),length:Math.hypot(b[1]-a[1],b[0]-a[0])};})).sort((a,b)=>b.length-a.length),unique=[];
    for(const {angle,length}of angles){if(length<1)continue;const value=(angle%Math.PI+Math.PI)%Math.PI;if(!unique.some(a=>Math.abs(Math.sin(a-value))<.03))unique.push(value);if(unique.length===8)break;}
    const target=targetHeight(way.tags,options.fallbackHeight),candidates=[];
    for(const axis of unique)for(const turn of [0,Math.PI/2]){
      const angle=axis+turn,c=Math.cos(angle),s=Math.sin(angle),local=ring.map(([x,z])=>[c*x+s*z,-s*x+c*z]),lo=[0,1].map(i=>Math.min(...local.map(p=>p[i]))),hi=[0,1].map(i=>Math.max(...local.map(p=>p[i]))),center=lo.map((n,i)=>(n+hi[i])/2);
      for(const m of catalog){
        const width=m.max[0]-m.min[0],depth=m.max[2]-m.min[2],maxScale=options.adjustScale?Math.min(1.15,(hi[0]-lo[0])/width,(hi[1]-lo[1])/depth):1;
        for(const scale of options.adjustScale?[maxScale,maxScale-.075,maxScale-.15,maxScale-.225].filter(n=>n>=.85):[1]){
          const coverage=width*depth*scale*scale/size;if(coverage<options.minCoverage||coverage>1.00001)continue;
          const dx=(hi[0]-lo[0]-width*scale)/2,dz=(hi[1]-lo[1]-depth*scale)/2;if(dx< -1e-6||dz< -1e-6)continue;
          for(const ox of polygon.length>1?[0,-.9,.9,-.45,.45]:[0,-.9,.9])for(const oz of polygon.length>1?[0,-.9,.9,-.45,.45]:[0,-.9,.9]){
            const x=center[0]+ox*dx,z=center[1]+oz*dz,points=[[-1,-1],[1,-1],[1,1],[-1,1]].map(([a,b])=>{const u=x+a*width*scale/2,v=z+b*depth*scale/2;return [c*u-s*v,s*u+c*v];});
            if(!contained(points,ring))continue;
            const height=m.max[1]*scale;if(height<target.height*.65||height>target.height*1.45)continue;const score=coverage-.18*Math.abs(Math.log(height/target.height))-.15*Math.abs(scale-1);
            candidates.push({model:m,angle,scale,footprint:points,center:[c*x-s*z,s*x+c*z],coverage,height,score});
          }
        }
      }
    }
    candidates.sort((a,b)=>b.score-a.score||a.model.path.localeCompare(b.model.path,'en'));
    const best=candidates.find(p=>{
      const poly=[[...p.footprint,p.footprint[0]]];
      // Verify the full polygon as well as corners; concave bays are not filled.
      return polygonArea(clipping.difference(poly,polygon))<.0001&&(!exclusions.length||polygonArea(clipping.intersection(poly,exclusions))<.0001)&&(!occupied.length||polygonArea(clipping.intersection(poly,occupied))<.0001);
    });
    if(!best){skip('Žádný model neodpovídá rozměrům a výšce bez zásahu do půdorysu, ulice či jiné budovy.');continue;}
    if(placements.length>=32){skip('Limit ukázky je 32 samostatných domů.');continue;}
    if(best.model.vertices>vertexBudget){skip('Dům by překročil bezpečný limit vrcholů nativních kolizí.');continue;}vertexBudget-=best.model.vertices;
    // Choose between opposite facings by the nearest road centerline. Front is
    // the catalogue model's local -Z side; the heading remains editable.
    let nearest=null,distance=Infinity;for(const chain of chains)for(let i=1;i<chain.length;i++){const a=chain[i-1],b=chain[i],dx=b[0]-a[0],dz=b[2]-a[2],t=Math.max(0,Math.min(1,((best.center[0]-a[0])*dx+(best.center[1]-a[2])*dz)/(dx*dx+dz*dz))),p=[a[0]+t*dx,a[2]+t*dz],d=Math.hypot(p[0]-best.center[0],p[1]-best.center[1]);if(d<distance){distance=d;nearest=p;}}
    let angle=best.angle;if(nearest&&Math.sin(angle)*(nearest[0]-best.center[0])-Math.cos(angle)*(nearest[1]-best.center[1])<0)angle+=Math.PI;
    const c=Math.cos(angle),s=Math.sin(angle),m=best.model,scale=best.scale,cx=(m.min[0]+m.max[0])/2*scale,cz=(m.min[2]+m.max[2])/2*scale;
    const item={way:id,name:way.relation?`OSM_R_${way.relation}_${way.component??1}`:`OSM_B_${id}`,label:way.tags.name??`Budova ${id}`,...(way.relation?{relation:way.relation,component:way.component,components:way.components}:{}),model:m.path,modelHash:m.sha256,position:[best.center[0]-c*cx+s*cz,options.ground,best.center[1]-s*cx-c*cz].map(Math.fround),rotation:[Math.cos(angle/2),0,Math.sin(angle/2),0].map(Math.fround),scale:[scale,scale,scale].map(Math.fround),footprint:best.footprint,coverage:best.coverage,modelHeight:best.height,...target};
    placements.push(item);occupied.push([[...best.footprint,best.footprint[0]]]);
  }
  return {placements,skipped};
}
