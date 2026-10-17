import test from 'node:test';
import assert from 'node:assert/strict';
import clipping from 'polygon-clipping';
import {osmSource,osmRoadPlan} from '../src/plugins/osm/area.js';
import {osmSurfaceModel,osmSurfaceDefaults} from '../src/plugins/osm/surface.js';
import {osmTerrainSurface} from '../src/plugins/osm/terrain.js';
import {osmWalkwayPlan,osmWalkwayModel,osmWalkwayDefaults,validateOsmWalkways} from '../src/plugins/osm/walkways.js';
import {osmPedestrianPlan,osmPedestrianBytes} from '../src/plugins/osm/pedestrians.js';
import {writeSurfaceModel} from '../src/core/surface-model.js';
import {parseFourDs} from '../src/core/fourds.js';
import {parseNavigation} from '../src/core/navigation.js';
const area={latitude:50,longitude:14,size:100};
const node=(id,x,z)=>({type:'node',id,lat:50+z/6371008.8*180/Math.PI,lon:14+x/6371008.8*180/Math.PI/Math.cos(50*Math.PI/180)});
const data={elements:[node(1,-60,0),node(2,60,0),node(3,0,4),node(4,0,45),node(5,-40,20),node(6,40,20),{type:'way',id:101,nodes:[1,2],tags:{highway:'residential'}},{type:'way',id:102,nodes:[3,4],tags:{highway:'footway',footway:'sidewalk',width:'3 m'}},{type:'way',id:103,nodes:[5,6],tags:{highway:'pedestrian',width:'6 ft'}}]};
const options={...osmWalkwayDefaults,selected:[102,103]};
const polygon=(x,z,w,h)=>[[[[x,z],[x+w,z],[x+w,z+h],[x,z+h],[x,z]]]];
function fixture(elevated=false,sidewalks='both'){
 const source=osmSource(data,area),roads=osmRoadPlan(source,[101]),settings={...osmSurfaceDefaults,sidewalks},surface=elevated?osmTerrainSurface(roads,area,settings,{version:1,area,columns:5,rows:5,base:2,samples:Array.from({length:36},(_,i)=>100+i%6+Math.abs(Math.floor(i/6)-2)*2),groundTexture:'maps/ground.bmp',groundTileSize:4}):osmSurfaceModel(roads,area,settings);
 return {source,roads,surface};
}
const areaOf=ps=>ps.reduce((sum,p)=>sum+p.reduce((sum,r,i)=>sum+(i?-1:1)*Math.abs(r.slice(1).reduce((sum,b,j)=>sum+r[j][0]*b[1]-b[0]*r[j][1],0)/2),0),0);
function triangles(model){return model.meshes.flatMap(m=>m.lods[0].faces.flatMap(f=>Array.from({length:f.indices.length/3},(_,i)=>f.indices.slice(i*3,i*3+3).map(n=>m.lods[0].positions.slice(n*3,n*3+3)))));}
test('standalone public paths merge without overlap and exclude streets, green and building footprints',()=>{
 const f=fixture(),before=structuredClone(f),green={placements:[{grass:polygon(-5,30,10,10),paths:[]}]},p=osmWalkwayPlan(f.source,f.surface,green,options),item=p.placements[0];
 assert(item.area>100);assert.equal(p.profiles[0].width,3);assert.equal(p.profiles[0].source,'OSM width');assert.equal(p.profiles[1].width,6*.3048);assert.equal(p.skipped.length,0);
 assert(areaOf(clipping.intersection(item.paths,[...f.surface.footprints.road,...f.surface.footprints.sidewalk,...green.placements[0].grass]))<1e-5);
 const model=parseFourDs(writeSurfaceModel(osmWalkwayModel(item)),true),tris=triangles(model);assert(tris.length>10);let sum=0;for(const[a,b,c]of tris){assert.equal(a[1],Math.fround(options.height));const signed=(b[2]-a[2])*(c[0]-a[0])-(b[0]-a[0])*(c[2]-a[2]);assert(signed>0);sum+=signed/2;}assert(Math.abs(sum-item.area)<.001);assert.deepEqual(f,before);
 const repeat=osmWalkwayPlan(f.source,f.surface,green,JSON.parse(JSON.stringify(options)));assert.deepEqual(writeSurfaceModel(osmWalkwayModel(repeat.placements[0])),writeSurfaceModel(osmWalkwayModel(item)));
 const source={...f.source,buildings:[{id:999,tags:{building:'yes'},polygons:polygon(-3,10,6,6)}]};const b=osmWalkwayPlan(source,f.surface,null,options);assert(areaOf(clipping.intersection(b.placements[0].paths,polygon(-3,10,6,6)))<1e-5);
});
test('standalone paths honor pedestrian access, distinct crossing controls, levels, widths and limits',()=>{
 const f=fixture();for(const [tags,reason]of [[{access:'private'},/Přístup/],[{foot:'no'},/Přístup/],[{'foot:conditional':'yes @ (Mo-Fr)'},/Přístup/],[{bridge:'yes'},/Most/],[{tunnel:'yes'},/Most/],[{layer:'1'},/Most/],[{area:'yes'},/area=yes/],[{footway:'crossing'},/Přechod/]]){const source={...f.source,ways:f.source.ways.map(w=>w.id===102?{...w,tags:{...w.tags,...tags}}:w)},p=osmWalkwayPlan(source,f.surface,null,{...options,selected:[102]});assert.equal(p.placements.length,0);assert.match(p.skipped[0].reason,reason);}
 const source={...f.source,ways:f.source.ways.map(w=>w.id===102?{...w,tags:{...w.tags,access:'private',foot:'yes',width:'wrong'}}:w)},p=osmWalkwayPlan(source,f.surface,null,{...options,selected:[102]});assert(p.placements.length);assert.equal(p.profiles[0].width,2);assert.match(p.profiles[0].note,/náhradní/);
 for(const patch of [{selected:[]},{selected:[102,102]},{selected:[-1]},{height:.05},{width:'2'},{tileSize:0},{texture:'maps/../x.bmp'},{textureHash:'bad'}])assert.throws(()=>validateOsmWalkways({...options,...patch}),/pěší cesty/);
 assert.throws(()=>osmWalkwayPlan(f.source,f.surface,null,{...options,selected:[999]}),/není v podkladu/);assert.throws(()=>osmWalkwayPlan(f.source,f.surface,null,options,60000),/60 000/);assert.throws(()=>osmWalkwayPlan(f.source,null,null,options),/povrchy/);
});
test('path meshes and entire pedestrian links share the triangular terrain; sidewalk joins remain grounded',()=>{
 for(const elevated of [false,true]){const f=fixture(elevated),p=osmWalkwayPlan(f.source,f.surface,null,options),item=p.placements[0],model=parseFourDs(writeSurfaceModel(osmWalkwayModel(item,p.elevation)),true),nav=osmPedestrianPlan(f.source,f.roads,f.surface,null,null,{},p),native=parseNavigation(osmPedestrianBytes(nav));assert(native.points.length>10);assert(nav.walkwayPoints>10);assert.equal(nav.components,2);assert.equal(nav.parkPoints,undefined);
 const floor=(x,z)=>(p.elevation?.heightAt(x,z)??0)+options.height;
 for(const tri of triangles(model))for(const u of [0,.25,.5,1]){const v=tri[0].map((n,i)=>n*(1-u)+tri[1][i]*u);assert(Math.abs(v[1]-floor(v[0],v[2]))<2e-5);}
 for(const [a,b]of nav.links){const x=nav.positions[a],y=nav.positions[b];assert(Math.hypot(...x.map((v,i)=>v-y[i]))<=4.0001);for(const t of [.01,.25,.5,.75,.99]){const v=x.map((n,i)=>n*(1-t)+y[i]*t),sq=polygon(v[0]-.001,v[2]-.001,.002,.002);assert(clipping.intersection(sq,[...f.surface.footprints.sidewalk,...item.paths]).length,'no links across missing ground');}}
 }
 const f=fixture(true,'none'),p=osmWalkwayPlan(f.source,f.surface,null,options),nav=osmPedestrianPlan(f.source,f.roads,f.surface,null,null,{},p);assert(nav.walkwayPoints>10);assert.equal(nav.components,1);
 const changed={...p,elevation:{...p.elevation}};assert.throws(()=>osmPedestrianPlan(f.source,f.roads,f.surface,null,null,{},changed),/společný|stejný/);
});
