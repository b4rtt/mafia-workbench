import test from 'node:test';
import assert from 'node:assert/strict';
import clipping from 'polygon-clipping';
import {osmSource,osmRoadPlan} from '../src/plugins/osm/area.js';
import {osmSurfaceModel,osmSurfaceDefaults} from '../src/plugins/osm/surface.js';
import {osmTerrainSurface} from '../src/plugins/osm/terrain.js';
import {osmCrossingMarkingPlan,osmCrossingMarkingModel,validateOsmCrossingMarkings} from '../src/plugins/osm/crossing-markings.js';
import {osmPedestrianPlan,osmPedestrianBytes} from '../src/plugins/osm/pedestrians.js';
import {writeSurfaceModel} from '../src/core/surface-model.js';
import {parseFourDs} from '../src/core/fourds.js';
const area={latitude:50,longitude:14,size:100},settings={version:1,fallbackZebra:false};
function fixture({tags={},angle=0,elevated=false,sidewalks='both',diagonal=0}={}){
  const node=(id,x,z,tags)=>{const a=x*Math.cos(angle)-z*Math.sin(angle),b=x*Math.sin(angle)+z*Math.cos(angle);return {type:'node',id,lat:50+b/6371008.8*180/Math.PI,lon:14+a/6371008.8*180/Math.PI/Math.cos(50*Math.PI/180),...(tags?{tags}:{})};},elements=[node(1,-80,0),node(2,0,0,{highway:'crossing',crossing:'uncontrolled','crossing:markings':'zebra',...tags}),node(3,80,0),{type:'way',id:101,nodes:[1,2,3],tags:{highway:'residential'}}];
  if(diagonal){elements.push(node(4,-diagonal*8,-8),node(5,diagonal*8,8),{type:'way',id:102,nodes:[4,2,5],tags:{highway:'footway',footway:'crossing'}});}
  const source=osmSource({elements},area),roads=osmRoadPlan(source,[101]),options={...osmSurfaceDefaults,sidewalks},surface=elevated?osmTerrainSurface(roads,area,options,{version:1,area,columns:10,rows:10,base:2,samples:Array.from({length:121},(_,i)=>100+(i%11)*.2+Math.abs(Math.floor(i/11)-5)*.6),groundTexture:'maps/ground.bmp',groundTileSize:4}):osmSurfaceModel(roads,area,options);
  return {source,roads,surface};
}
const plan=(f,s=settings,props=null)=>osmCrossingMarkingPlan(f.source,f.roads,f.surface,s,props);
function triangles(model,position){return model.meshes.flatMap(m=>m.lods[0].faces.flatMap(f=>Array.from({length:f.indices.length/3},(_,i)=>f.indices.slice(i*3,i*3+3).map(n=>m.lods[0].positions.slice(n*3,n*3+3).map((v,k)=>v+position[k])))));}
test('native zebra bars stay on the road, face upward and remain deterministic at rotated and diagonal crossings',()=>{
  for(const options of [{},{angle:.61},{diagonal:.3},{angle:.61,diagonal:.3}]){
    const f=fixture(options),before=structuredClone(f),p=plan(f),c=p.placements[0];assert.equal(p.placements.length,1);assert.equal(p.skipped.length,0);assert(c.bars>=4);assert.equal(c.estimated,false);assert.match(c.patternSource,/crossing:markings=zebra/);
    const bytes=writeSurfaceModel(osmCrossingMarkingModel(c)),native=parseFourDs(bytes,true),tris=triangles(native,c.position);assert.equal(tris.length,c.triangles);assert.equal(native.materials[0].texture,'');assert.equal(native.materials[0].opacity,1);
    for(const [a,b,d]of tris){assert((b[2]-a[2])*(d[0]-a[0])-(b[0]-a[0])*(d[2]-a[2])>0);assert(Math.abs(a[1]-.062)<1e-6);for(const v of [a,b,d])assert(Math.abs(clipping.intersection([[[[v[0]-.001,v[2]-.001],[v[0]+.001,v[2]-.001],[v[0]+.001,v[2]+.001],[v[0]-.001,v[2]+.001],[v[0]-.001,v[2]-.001]]]],f.surface.footprints.road).length)>0);}
    assert.deepEqual(f,before);assert.deepEqual(writeSurfaceModel(osmCrossingMarkingModel(plan(f).placements[0])),bytes);
  }
});
test('unknown patterns require explicit fallback and explicit absent/other styles are never painted',()=>{
  for(const tags of [{'crossing:markings':'yes'},{'crossing:markings':undefined}]){const f=fixture();if(tags['crossing:markings']===undefined)delete f.source.pedestrianCrossings[0].tags['crossing:markings'];else Object.assign(f.source.pedestrianCrossings[0].tags,tags);assert.equal(plan(f).placements.length,0);const c=plan(f,{...settings,fallbackZebra:true}).placements[0];assert(c.estimated);assert.match(c.patternSource,/náhradní/);}
  for(const tags of [{'crossing:markings':'no'},{'crossing:markings':'lines'},{'crossing:markings':'zebra:double'},{'crossing:markings':'surface'},{'crossing:markings:colour':'yellow'},{'crossing:markings':'zebra;lines'},{crossing:'unmarked'}]){const p=plan(fixture({tags}),{...settings,fallbackZebra:true});assert.equal(p.placements.length,0,JSON.stringify(tags));assert.equal(p.skipped.length,1);}
  const f=fixture({tags:{crossing:'zebra'}});delete f.source.pedestrianCrossings[0].tags['crossing:markings'];assert.match(plan(f).placements[0].patternSource,/OSM crossing=zebra/);
});
test('unsupported controllers, missing sidewalks, inaccessible crossings and blockers remain unpainted',()=>{
  for(const options of [{tags:{crossing:'traffic_signals'}},{tags:{'crossing:signals':'yes'}},{tags:{'crossing:island':'yes'}},{tags:{foot:'no'}},{tags:{layer:'1'}},{sidewalks:'left'}]){const p=plan(fixture(options));assert.equal(p.placements.length,0);assert.equal(p.skipped.length,1);}
  const f=fixture(),p=plan(f,settings,{placements:[{footprint:[[-1,-1],[1,-1],[1,1],[-1,1],[-1,-1]]}]});assert.equal(p.placements.length,0);assert.match(p.skipped[0].reason,/mobiliář/);
});
test('paint triangles follow the shared terrain even inside grid diagonals and ridges',()=>{
  const f=fixture({angle:.61,elevated:true,diagonal:.3}),p=plan(f),c=p.placements[0],model=parseFourDs(writeSurfaceModel(osmCrossingMarkingModel(c,p.elevation)),true);assert(c);assert(c.triangles>c.bars*2);
  for(const tri of triangles(model,c.position))for(const weights of [[1,0,0],[0,1,0],[0,0,1],[.2,.3,.5],[.5,.5,0]]){const v=[0,1,2].map(k=>tri.reduce((n,p,i)=>n+p[k]*weights[i],0)),height=p.elevation.heightAt(v[0],v[2])+c.level+c.heightOffset;assert(Math.abs(v[1]-height)<1e-5,`shared triangular plane ${v}`);}
});
test('marking generation leaves existing native pedestrian data unchanged and duplicate corridors are not overdrawn',()=>{
  const f=fixture(),before=osmPedestrianBytes(osmPedestrianPlan(f.source,f.roads,f.surface));plan(f);assert.deepEqual(osmPedestrianBytes(osmPedestrianPlan(f.source,f.roads,f.surface)),before);
  const duplicate=structuredClone(f.source.pedestrianCrossings[0]);duplicate.id=4;f.source.pedestrianCrossings.push(duplicate);f.source.ways[0].nodes.splice(2,0,4);const p=plan(f);assert.equal(p.placements.length,1);assert.match(p.skipped[0].reason,/překrývá/);
});
test('invalid settings and missing road surfaces fail before generation',()=>{
  for(const value of [null,false,{}, {version:2,fallbackZebra:false},{version:1,fallbackZebra:1}])assert.throws(()=>validateOsmCrossingMarkings(value),/značení přechodů/);
  const f=fixture();assert.throws(()=>osmCrossingMarkingPlan(f.source,f.roads,null,settings),/povrchy ulic/);
});
