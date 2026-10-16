import {elevationCoordinate} from './elevation.js';

const fail=m=>{throw Error('OpenStreetMap · výšková navigace: '+m);};
const distance=(a,b)=>Math.hypot(...a.map((n,i)=>n-b[i]));

// The field is the same immutable triangular surface used by terrain.js.
// No sampling of a separate DEM or interpolation across a grid ridge.
export function osmNavigationElevation(surface){
  if(!surface?.elevation)return null;
  const field=surface.elevation,levels=surface.levels;
  if(field.version!==1||typeof field.heightAt!=='function'||typeof field.splitEdge!=='function'||!Array.isArray(field.x)||!Array.isArray(field.z)||!levels||!['road','sidewalk','ground'].every(k=>typeof levels[k]==='number'&&Number.isFinite(levels[k]))||levels.road!==.05||levels.ground!==0||levels.sidewalk<.1||levels.sidewalk>.451)fail('chybí společný výškový podklad a úrovně povrchů.');
  function coordinate(n,axis){
    if(typeof n!=='number'||!Number.isFinite(n))fail('neplatná souřadnice bodu.');
    const value=elevationCoordinate(n),clipped=Math.max(axis[0],Math.min(axis.at(-1),value));
    // The old road planner serializes float32 before the terrain's micron
    // quantization. Accept only that rounding difference at the area edge.
    if(Math.abs(value-clipped)>Math.max(1e-6,Math.abs(value)*2**-23))fail('bod leží mimo výškový podklad.');
    return clipped;
  }
  const xz=p=>[coordinate(p[0],field.x),coordinate(p[2],field.z)];
  function point(p,level){
    if(typeof level!=='number'||!Number.isFinite(level))fail('neplatná úroveň povrchu.');
    const [x,z]=xz(p);return [x,Math.fround(field.heightAt(x,z)+level),z];
  }
  function split(a,b,levelAt,maxLength,compact=false){
    if(typeof levelAt!=='function'||!Number.isFinite(maxLength)||maxLength<.25||maxLength>4)fail('neplatné dělení spojení.');
    const project=p=>point([p[0],0,p[1]],levelAt(p)),cuts=field.splitEdge(xz(a),xz(b)).map(c=>project(c.point)),result=[cuts[0]];
    function append(p,q,depth=0){
      if(distance(p,q)<=maxLength){if(q.some((n,i)=>n!==result.at(-1)[i]))result.push(q);if(result.length>8192)fail('jedno spojení překračuje 8192 bodů; zmenšete sklon nebo oblast.');return;}
      if(depth>=24)fail('spojení nelze bezpečně rozdělit.');
      const mid=project([(p[0]+q[0])/2,(p[2]+q[2])/2]);
      if([p,q].some(v=>v[0]===mid[0]&&v[2]===mid[2]))fail('výškový skok nelze reprezentovat pěší nebo jízdní trasou.');
      append(p,mid,depth+1);append(mid,q,depth+1);
    }
    // In pedestrian corridors, discard redundant cuts only within one level
    // and at <=1 micrometre vertical error over every original terrain span.
    // Ridges remain explicit; the native length bound is applied afterwards.
    function simplify(first,last){
      let worst=1e-6,at=-1;const a=cuts[first],b=cuts[last],dx=b[0]-a[0],dz=b[2]-a[2],length=dx*dx+dz*dz;
      for(let i=first+1;i<last;i++){const p=cuts[i],t=((p[0]-a[0])*dx+(p[2]-a[2])*dz)/length,error=Math.abs(p[1]-a[1]-(b[1]-a[1])*t);if(error>worst){worst=error;at=i;}}
      if(at===-1)append(a,b);else{simplify(first,at);simplify(at,last);}
    }
    if(compact&&cuts.every(p=>levelAt([p[0],p[2]])===levelAt([cuts[0][0],cuts[0][2]])))simplify(0,cuts.length-1);
    else for(let i=1;i<cuts.length;i++)append(cuts[i-1],cuts[i]);return result;
  }
  return {field,levels,point,split};
}

// This plan feeds the existing road.bin writer and optional traffic planner;
// the original flat plan remains the input for street footprint generation.
export function osmTerrainRoadPlan(plan,surface){
  const terrain=osmNavigationElevation(surface);if(!terrain)fail('nejdřív vytvořte výškový povrch ulic.');
  if(!plan?.flat||!Array.isArray(plan.crossings)||!Array.isArray(plan.roads)||surface.profiles?.length!==plan.roads.length)fail('očekávám původní rovinný plán stejných ulic.');
  const crossings=plan.crossings.map(c=>({...c,position:terrain.point(c.position,terrain.levels.road)}));
  const roads=plan.roads.map(road=>{
    const chain=[plan.crossings[road.from].position,...road.positions,plan.crossings[road.to].position],points=[];
    for(let i=1;i<chain.length;i++){
      if(chain[i-1][1]!==0||chain[i][1]!==0)fail('původní plán musí mít nulové výšky.');
      const part=terrain.split(chain[i-1],chain[i],()=>terrain.levels.road,2);points.push(...part.slice(i===1?0:1));
    }
    // Native roads require at least one intermediate node even on a short
    // link wholly inside one grid triangle.
    if(points.length===2)points.splice(1,0,terrain.point(points[0].map((n,k)=>(n+points[1][k])/2),terrain.levels.road));
    const positions=points.slice(1,-1);return {...road,positions};
  });
  if(roads.reduce((n,r)=>n+r.positions.length,0)>4096)fail('silniční síť přesahuje 4096 jízdních bodů; zmenšete oblast nebo výběr ulic.');
  return {...plan,crossings,roads,flat:false,elevated:true};
}
