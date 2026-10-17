import test from 'node:test';
import assert from 'node:assert/strict';
import {osmSurfaceDefaults} from '../src/plugins/osm/surface.js';
import {osmTerrainSurface} from '../src/plugins/osm/terrain.js';
import {osmTerrainRoadPlan,osmNavigationElevation} from '../src/plugins/osm/navigation-elevation.js';
import {osmTrafficPlan} from '../src/plugins/osm/traffic.js';
import {osmRoadBytes} from '../src/plugins/osm/mission.js';
import {osmTrafficPreview} from '../src/plugins/osm/traffic-preview.js';
import {parseRoads} from '../src/core/roads.js';
import {parseFourDs} from '../src/core/fourds.js';
import {writeSurfaceModel} from '../src/core/surface-model.js';
import {roadConnections} from '../src/shared/roads.js';

const options={version:3,density:1,speedKmh:30,cornerSpeedKmh:15,continuous:true,turnRadius:6,tableHash:'a'.repeat(64),models:[{path:'models/test10.4ds',table:'test',sha256:'b'.repeat(64),width:1.8,envelope:{min:[-.9,-2.3],max:[.9,2.3]}}]};
function fixture({size=140,angle=0,columns=7,rows=5,height=(x,z)=>200+x*.6+z+Math.abs(x-3)*.9}={}){
  const c=Math.cos(angle),s=Math.sin(angle),crossings=[[-35,-35],[35,-35],[35,35],[-35,35]].map(([x,z])=>({position:[x*c-z*s,0,x*s+z*c].map(Math.fround)})),flat={flat:true,crossings,roads:[[0,1],[1,2],[2,3],[3,0]].map(([from,to],i)=>({from,to,way:101+i,positions:[crossings[from].position.map((v,j)=>Math.fround((v+crossings[to].position[j])/2))],forward:true,reverse:true,tags:{highway:'residential'}}))},area={latitude:50,longitude:14,size},settings={version:1,area,columns,rows,base:2,samples:Array.from({length:(columns+1)*(rows+1)},(_,i)=>height(i%(columns+1),Math.floor(i/(columns+1)))),groundTexture:'maps/ground.bmp',groundTileSize:4},surface=osmTerrainSurface(flat,area,{...osmSurfaceDefaults,width:8,cornerRadius:2},settings);
  return {flat,area,settings,surface,plan:osmTerrainRoadPlan(flat,surface)};
}
const distance=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
function asphalt(model){
  const triangles=model.meshes.flatMap(m=>m.lods[0].faces.filter(f=>f.material===1).flatMap(f=>Array.from({length:f.indices.length/3},(_,i)=>f.indices.slice(i*3,i*3+3).map(n=>m.lods[0].positions.slice(n*3,n*3+3)))));
  return (x,z)=>{let result=-Infinity;for(const [a,b,c]of triangles){const dx=b[0]-a[0],dz=b[2]-a[2],ex=c[0]-a[0],ez=c[2]-a[2],det=dx*ez-dz*ex;if(Math.abs(det)<1e-10)continue;const u=((x-a[0])*ez-(z-a[2])*ex)/det,v=(dx*(z-a[2])-dz*(x-a[0]))/det;if(u>=-1e-7&&v>=-1e-7&&u+v<=1+1e-7)result=Math.max(result,a[1]+u*(b[1]-a[1])+v*(c[1]-a[1]));}return result;};
}
test('terrain turn axes and chords follow the actual native asphalt through grid edges and diagonals',()=>{
  for(const extra of [{},{angle:.37,size:143.456},{columns:3,rows:2,height:(x,z)=>200+x*z*2}]){
    const f=fixture(extra),before=structuredClone({plan:f.plan,flat:f.flat,settings:f.settings}),mesh=writeSurfaceModel(f.surface.model),t=osmTrafficPlan(f.plan,f.surface,options),n=parseRoads(osmRoadBytes(f.plan,t)),floor=asphalt(parseFourDs(mesh,true));
    assert.equal(t.turns.elevated,true);assert.equal(t.network.flat,false);assert.equal(t.network.elevated,true);assert.equal(t.turns.axes,8);assert.equal(t.turns.connectors,8);assert.deepEqual(n.warnings,[]);
    assert(new Set(n.nodes.map(v=>v.position[1])).size>100);
    for(const v of [...n.crossings,...n.nodes].map(n=>n.position))assert(Math.abs(v[1]-floor(v[0],v[2]))<2e-5,`native asphalt ${v}`);
    for(const r of t.network.roads){
      const link=roadConnections(n,r.from).find(l=>l.target===r.to),chain=[n.crossings[r.from].position,...link.nodes.map(ref=>n.nodes[ref&32767].position),n.crossings[r.to].position];
      for(let j=1;j<chain.length;j++){const a=chain[j-1],b=chain[j];assert(distance(a,b)<=2.000001);for(const u of [.25,.5,.75]){const p=a.map((v,k)=>v+(b[k]-v)*u);assert(Math.abs(p[1]-floor(p[0],p[2]))<2e-5,`triangle seam ${p}`);}}
    }
    assert.deepEqual({plan:f.plan,flat:f.flat,settings:f.settings},before);assert.deepEqual(writeSurfaceModel(f.surface.model),mesh);
    const copy=fixture({...extra});assert.deepEqual(osmRoadBytes(f.plan,t),osmRoadBytes(copy.plan,osmTrafficPlan(copy.plan,copy.surface,JSON.parse(JSON.stringify(options)))));
  }
});
test('height comes from the offset lane and preserves corner caps after terrain subdivision',()=>{
  const f=fixture({columns:4,rows:3,height:(x,z)=>200+x*3+z}),t=osmTrafficPlan(f.plan,f.surface,options),terrain=osmNavigationElevation(f.surface),cap=15/3.6;
  assert.equal(t.cornering.sites,8);assert.equal(osmTrafficPreview(f.plan,t).corners.length,8);
  const r=t.network.roads.find(r=>r.kind==='street'&&r.sourceRoad===0&&!r.sourceReverse),point=r.positions[Math.floor(r.positions.length/2)],centre=terrain.point([point[0],0,-35],.05);assert(Math.abs(point[1]-centre[1])>.01,'the offset lane must not reuse the mapped centreline height');
  for(const [i,r]of t.network.roads.entries())if(r.kind==='turn'){
    assert(t.roads[i].nodeSpeeds.every(v=>v===cap));for(const p of r.cornerPaths.flat())assert.deepEqual(p,terrain.point(p,.05));
  }
  const free=osmTrafficPlan(f.plan,f.surface,{...options,cornerSpeedKmh:undefined});assert.deepEqual(free.network,t.network);assert.equal(free.cornering,undefined);
});
test('terrain rounding retains reversed one-way directions and rejects missing shared elevation',()=>{
  const f=fixture();f.flat.roads.forEach(r=>{r.forward=false;r.reverse=true;});const p=osmTerrainRoadPlan(f.flat,f.surface),t=osmTrafficPlan(p,f.surface,options);
  assert.equal(t.turns.axes,4);assert.equal(t.turns.connectors,4);assert(t.network.roads.filter(r=>r.kind==='street').every(r=>r.sourceReverse));assert.deepEqual(parseRoads(osmRoadBytes(p,t)).warnings,[]);
  assert.throws(()=>osmTrafficPlan(f.flat,f.surface,options),/výškový podklad/);assert.throws(()=>osmTrafficPlan(p,{...f.surface,levels:undefined},options),/společný výškový podklad/);
  const changed={...f.surface,elevation:{...f.surface.elevation,x:[-10,10],z:[-10,10]}};assert.throws(()=>osmTrafficPlan(p,changed,options),/mimo výškový podklad/);
});
