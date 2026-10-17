import clipping from 'polygon-clipping';
import {ShapeUtils,Vector2} from 'three';
import {osmCrossingPlan} from './crossings.js';
import {osmNavigationElevation} from './navigation-elevation.js';
import {elevationCoordinate} from './elevation.js';

const fail=m=>{throw Error('OpenStreetMap · značení přechodů: '+m);};
export function validateOsmCrossingMarkings(settings){
  if(!settings||settings.version!==1||typeof settings.fallbackZebra!=='boolean')fail('neplatná verze nebo volba náhradního vzoru.');
}
const area=mp=>mp.reduce((sum,p)=>sum+p.reduce((s,r,i)=>s+(i?-1:1)*Math.abs(r.slice(1).reduce((n,b,j)=>n+r[j][0]*b[1]-b[0]*r[j][1],0))/2,0),0);
function pattern(tags,fallback){
  const marking=tags['crossing:markings'];
  if(tags['crossing:markings:colour']&&!['white','#ffffff','#fff'].includes(tags['crossing:markings:colour'].toLowerCase()))return {reason:'Nepodporovaná barva značení; generují se pouze bílé pruhy.'};
  if(marking==='no'||tags.crossing==='unmarked')return {reason:'Přechod je výslovně bez značení.'};
  if(marking==='zebra')return {source:'OSM crossing:markings=zebra'};
  if(marking!==undefined&&marking!=='yes')return {reason:`Nepodporovaný vzor crossing:markings=${marking}.`};
  if(!marking&&tags.crossing==='zebra')return {source:'OSM crossing=zebra'};
  return fallback?{source:'náhradní zebra: OSM neurčuje konkrétní vzor',estimated:true}:{reason:'OSM neurčuje zebru; náhradní vzor není povolený.'};
}
// Paint is independent of pedestrian spawning/navigation. Reuse the proven
// corridor checks, then clip bars to the actual road (never onto the kerbs).
export function osmCrossingMarkingPlan(source,roads,surface,settings,props=null){
  validateOsmCrossingMarkings(settings);if(!roads||!surface)fail('zapněte povrchy ulic a vyberte ulice.');
  const accepted=new Map(),skipped=[],placements=[],tags=new Map((source.pedestrianCrossings??[]).map(c=>[c.id,c.tags]));
  for(const c of source.pedestrianCrossings??[]){const p=pattern(c.tags,settings.fallbackZebra);if(p.reason)skipped.push({id:c.id,reason:p.reason});else accepted.set(c.id,p);}
  const corridors=osmCrossingPlan({...source,pedestrianCrossings:(source.pedestrianCrossings??[]).filter(c=>accepted.has(c.id))},roads,surface,props),terrain=osmNavigationElevation(surface);skipped.push(...corridors.skipped);
  let triangles=0;
  for(const c of corridors.placements){
    const footprint=clipping.intersection(c.polygons,surface.footprints.road),origin=[c.point[0],c.point[2]],d=c.direction,across=[-d[1],d[0]],projection=v=>(v[0]-origin[0])*d[0]+(v[1]-origin[1])*d[1],values=footprint.flat(2).map(projection),low=Math.min(...values)+.25,high=Math.max(...values)-.25;
    const barWidth=.5,gap=.5,count=Math.floor((high-low+gap)/(barWidth+gap)),length=count*barWidth+(count-1)*gap,start=(low+high-length)/2;
    if(count<2){skipped.push({id:c.id,reason:'Vozovka je příliš úzká pro dva pruhy a odstup od obrubníků.'});continue;}
    if(placements.some(p=>area(clipping.intersection(p.footprint,footprint))>1e-6)){skipped.push({id:c.id,reason:'Přechod se překrývá s jiným vytvořeným přechodem.'});continue;}
    const vertex=(u,v)=>[origin[0]+d[0]*u+across[0]*v,origin[1]+d[1]*u+across[1]*v],bars=[];
    for(let i=0;i<count;i++){const a=start+i*(barWidth+gap),b=a+barWidth;bars.push([ [vertex(a,-c.width/2),vertex(b,-c.width/2),vertex(b,c.width/2),vertex(a,c.width/2),vertex(a,-c.width/2)] ]);}
    const polygons=clipping.intersection(bars,footprint),position=[c.point[0],c.height,c.point[2]],item={id:c.id,name:`OSM_CROSSING_${c.id}`,way:c.way,position,width:c.width,widthSource:c.widthSource,direction:c.direction,directionSource:c.directionSource,patternSource:accepted.get(c.id).source,estimated:accepted.get(c.id).estimated??false,tags:tags.get(c.id),barWidth,gap,edgeInset:.25,heightOffset:.012,bars:count,level:c.level??c.height,polygons,footprint};
    const model=osmCrossingMarkingModel(item,terrain?.field);item.triangles=model.meshes[0].lods[0].faces[0].indices.length/3;triangles+=item.triangles;if(triangles>32000)fail('značení přesahuje 32 000 trojúhelníků; zmenšete oblast nebo rastr.');placements.push(item);
  }
  return {placements,skipped:skipped.sort((a,b)=>a.id-b.id),triangles,...(terrain?{elevation:terrain.field}:{})};
}
export function osmCrossingMarkingModel(item,field=null){
  const positions=[],normals=[],uv=[],indices=[];
  function append(polygons){for(const polygon of polygons){
    const rings=polygon.map(r=>r.slice(0,-1).map(v=>new Vector2(...v))),vertices=rings.flat();
    for(const ids of ShapeUtils.triangulateShape(rings[0],rings.slice(1))){
      let p=ids.map(i=>{const x=elevationCoordinate(vertices[i].x),z=elevationCoordinate(vertices[i].y);return [x,Math.fround((field?.heightAt(x,z)??0)+item.level+item.heightOffset),z];}),a=p[1].map((n,k)=>n-p[0][k]),b=p[2].map((n,k)=>n-p[0][k]),normal=[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
      if(Math.abs(normal[1])<1e-8)continue;if(normal[1]<0){p=[p[0],p[2],p[1]];normal=normal.map(n=>-n);}const length=Math.hypot(...normal),at=positions.length/3;if(at+3>60000)fail('jeden přechod přesahuje 60 000 vrcholů.');
      positions.push(...p.flatMap(v=>v.map((n,k)=>Math.fround(n-item.position[k]))));normals.push(...p.flatMap(()=>normal.map(n=>Math.fround(n/length))));uv.push(...p.flatMap(()=>[0,0]));indices.push(at,at+1,at+2);
    }
  }}
  if(field){
    const all=item.polygons.flat(2),lo=field.cell(elevationCoordinate(Math.min(...all.map(v=>v[0]))),elevationCoordinate(Math.min(...all.map(v=>v[1])))),hi=field.cell(elevationCoordinate(Math.max(...all.map(v=>v[0]))),elevationCoordinate(Math.max(...all.map(v=>v[1]))));
    for(let j=lo[1];j<=hi[1];j++)for(let i=lo[0];i<=hi[0];i++){const a=[field.x[i],field.z[j]],b=[field.x[i+1],field.z[j]],c=[field.x[i],field.z[j+1]],d=[field.x[i+1],field.z[j+1]];for(const t of [[a,c,b],[b,c,d]])append(clipping.intersection(item.polygons,[[...t,t[0]]]));}
  }else append(item.polygons);
  if(!indices.length)fail('přechod nemá platné plochy.');
  return {materials:[{flags:0x08800001,ambient:[1,1,1],diffuse:[.92,.92,.88],emission:[0,0,0],opacity:1,texture:''}],meshes:[{id:1,name:item.name,type:1,visual:0,renderFlags:0,logicFlags:0x2a,culling:9,parent:0,position:[0,0,0],rotation:[1,0,0,0],scale:[1,1,1],lods:[{distance:0,vertices:positions.length/3,positions,normals,uv,faces:[{material:1,indices}]}]}]};
}
