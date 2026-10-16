import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import clipping from 'polygon-clipping';
import {ShapeUtils,Vector2,Ray,Vector3} from 'three';
import {convexPedestrianCells} from '../src/plugins/osm/pedestrian-cells.js';
import {compactPedestrianLinks} from '../src/plugins/osm/pedestrian-compact.js';
import {osmElevationGrid} from '../src/plugins/osm/elevation.js';
import {osmNavigationElevation} from '../src/plugins/osm/navigation-elevation.js';
import {osmSource,osmRoadPlan} from '../src/plugins/osm/area.js';
import {osmTerrainSurface} from '../src/plugins/osm/terrain.js';
import {osmSurfaceModel,osmSurfaceDefaults} from '../src/plugins/osm/surface.js';
import {osmGreenPlan,osmGreenDefaults,osmGreenModel} from '../src/plugins/osm/green-areas.js';
import {osmPedestrianPlan,osmPedestrianBytes} from '../src/plugins/osm/pedestrians.js';
import {parseNavigation} from '../src/core/navigation.js';

const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-b[1])-(b[1]-a[1])*(c[0]-b[0]);
const ringArea=r=>Math.abs(r.reduce((n,a,i)=>{const b=r[(i+1)%r.length];return n+a[0]*b[1]-a[1]*b[0];},0))/2;
const area=polygons=>polygons.reduce((n,p)=>n+ringArea(p[0])-p.slice(1).reduce((s,r)=>s+ringArea(r),0),0);
const distance=(a,b)=>Math.hypot(...a.map((n,k)=>n-b[k]));
const inRing=(r,p)=>{let hit=false;for(let i=0,j=r.length-1;i<r.length;j=i++){const a=r[i],b=r[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])hit=!hit;}return hit;};
const inside=(polygons,p)=>polygons.some(r=>inRing(r[0],p)&&!r.slice(1).some(h=>inRing(h,p)));
function fixtures({dense=false,steep=false,gap=0}={}){
  const area={latitude:50,longitude:14,size:200},elements=[],node=(x,z)=>{const id=elements.length+1;elements.push({type:'node',id,lat:50+z/6371008.8*180/Math.PI,lon:14+x/6371008.8*180/Math.PI/Math.cos(50*Math.PI/180)});return id;},road=[node(-110,0),node(110,0)],park=[node(-60,5+gap),node(60,5+gap),node(60,65),node(-60,65)];
  for(let i=dense?-4:0;i<=(dense?4:0);i++){
    const vertical=[node(i*12+.00017,2),node(i*12+.00023,60)],horizontal=[node(-55,i*6+35.00019),node(55,i*6+35.00023)];elements.push({type:'way',id:200+i*2+10,nodes:vertical,tags:{highway:'footway',width:'3'}},{type:'way',id:201+i*2+10,nodes:horizontal,tags:{highway:'footway',width:'3'}});
  }
  elements.push({type:'way',id:101,nodes:road,tags:{highway:'residential'}},{type:'way',id:102,nodes:[...park,park[0]],tags:{landuse:'grass'}});
  const source=osmSource({elements},area),roads=osmRoadPlan(source,[101]),options={...osmSurfaceDefaults,width:6},settings={version:1,area,columns:64,rows:64,base:2,samples:Array.from({length:65*65},(_,n)=>200+n%65*.1+Math.floor(n/65)*.05+(steep&&n%2?50:0)),groundTexture:'maps/ground.bmp',groundTileSize:4},surface=osmTerrainSurface(roads,area,options,settings),greenOptions={...osmGreenDefaults,selected:[102]},green=osmGreenPlan(source,surface,greenOptions);return {source,roads,options,surface,green,greenOptions};
}
function components(p){const adj=p.positions.map(()=>[]);for(const[a,b]of p.links){adj[a].push(b);adj[b].push(a);}const groups=[],seen=new Set();for(let i=0;i<adj.length;i++)if(!seen.has(i)){const group=[],todo=[i];seen.add(i);while(todo.length){const v=todo.pop();group.push(v);for(const j of adj[v])if(!seen.has(j)){seen.add(j);todo.push(j);}}groups.push(group);}return groups;}
function groundIndex(models){
  const bins=new Map();for(const model of models)for(const mesh of model.meshes){const lod=mesh.lods[0];for(const f of lod.faces){if(![1,2].includes(f.material))continue;for(let i=0;i<f.indices.length;i+=3){const p=f.indices.slice(i,i+3).map(n=>new Vector3(...lod.positions.slice(n*3,n*3+3)));for(let x=Math.floor(Math.min(...p.map(v=>v.x))/10);x<=Math.floor(Math.max(...p.map(v=>v.x))/10);x++)for(let z=Math.floor(Math.min(...p.map(v=>v.z))/10);z<=Math.floor(Math.max(...p.map(v=>v.z))/10);z++){const key=x+'/'+z;if(!bins.has(key))bins.set(key,[]);bins.get(key).push(p);}}}}
  return (x,z)=>{let y=-Infinity;const ray=new Ray(new Vector3(x,1000,z),new Vector3(0,-1,0));for(const t of bins.get(Math.floor(x/10)+'/'+Math.floor(z/10))??[]){const hit=ray.intersectTriangle(...t,true,new Vector3());if(hit)y=Math.max(y,hit.y);}return y;};
}
const pointDistance=(p,a,b)=>{const dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dz)/(dx*dx+dz*dz)));return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dz);};
function segmentDistance(a,b,c,d){if(cross(a,b,c)*cross(a,b,d)<0&&cross(c,d,a)*cross(c,d,b)<0)return 0;return Math.min(pointDistance(a,c,d),pointDistance(b,c,d),pointDistance(c,a,b),pointDistance(d,a,b));}

test('convex cells preserve concave boundaries, holes, exact area and deterministic bounded decomposition',()=>{
  const circle=(x,z,r,n)=>Array.from({length:n},(_,i)=>[x+Math.cos(i/n*Math.PI*2)*r,z+Math.sin(i/n*Math.PI*2)*r]);
  for(const rings of [[circle(0,0,30,256),circle(0,0,10,48).reverse()],[[[0,0],[60,0],[60,60],[45,60],[45,20],[15,20],[15,60],[0,60]],[[3,3],[3,8],[8,8],[8,3]]]]){
    const vectors=rings.map(r=>r.map(p=>new Vector2(...p))),vertices=vectors.flat(),triangles=ShapeUtils.triangulateShape(vectors[0],vectors.slice(1)),before=JSON.stringify({vertices,triangles}),cells=convexPedestrianCells(vertices,triangles),polygons=cells.map(ids=>[ids.map(i=>vertices[i].toArray())]);
    assert(cells.length<triangles.length/2);assert.deepEqual(cells,convexPedestrianCells(vertices,triangles));assert.equal(JSON.stringify({vertices,triangles}),before);
    for(const ids of cells){assert(ids.length>=3&&ids.length<=128);for(let i=0;i<ids.length;i++)assert(cross(...[i,(i+1)%ids.length,(i+2)%ids.length].map(n=>vertices[ids[n]].toArray()))>=0);}
    assert(Math.abs(area(polygons)-area([rings]))<1e-8);assert(area(clipping.difference(polygons,[rings]))<1e-8);assert(area(clipping.difference([rings],polygons))<1e-8);
  }
  const vertices=[[0,0],[5,0],[5,5],[0,5]].map(p=>new Vector2(...p));assert.equal(convexPedestrianCells(vertices,[[0,2,1],[0,3,2],[0,0,0]]).length,1);
});

test('compact terrain chains omit redundant cuts but retain ridges, length bounds and level transitions',()=>{
  const area={latitude:50,longitude:14,size:100},settings={version:1,area,columns:128,rows:128,base:2,samples:Array(129*129).fill(200)},levels={road:.05,sidewalk:.2,ground:0},a=[-49,0,-3],b=[49,0,3];
  for(const samples of [settings.samples,settings.samples.map((n,i)=>n+Math.abs(i%129-64)*.25),settings.samples.map((n,i)=>n+Math.sin(i%129*.4)*2)]){
    const field=osmElevationGrid({...settings,samples},area),terrain=osmNavigationElevation({elevation:field,levels}),legacy=terrain.split(a,b,()=>.2,4),compact=terrain.split(a,b,()=>.2,4,true);assert(compact.length<=legacy.length);assert.deepEqual(compact[0],legacy[0]);assert.deepEqual(compact.at(-1),legacy.at(-1));
    for(let i=1;i<compact.length;i++){const p=compact[i-1],q=compact[i];assert(distance(p,q)<=4.000001);for(const cut of field.splitEdge([p[0],p[2]],[q[0],q[2]])){const height=p[1]+(q[1]-p[1])*cut.t;assert(Math.abs(height-field.heightAt(...cut.point)-.2)<4e-6,'whole native span matches the actual terrain planes');}}
    if(samples===settings.samples)assert(compact.length<legacy.length/3);
    const step=p=>p[0]<0?.03:.2;assert.deepEqual(terrain.split(a,b,step,4,true),terrain.split(a,b,step,4));
  }
});

test('dense elevated park corridors fit the original native budget without losing body clearance or connectivity',()=>{
  const f=fixtures({dense:true}),props={placements:[{footprint:[[-2,30],[2,30],[2,32],[-2,32],[-2,30]]}]},p=osmPedestrianPlan(f.source,f.roads,f.surface,props,f.green),bytes=osmPedestrianBytes(p),native=parseNavigation(bytes),floor=groundIndex([f.surface.model,...f.green.placements.map(item=>osmGreenModel(item,f.green.elevation))]);
  // The pre-compaction planner at c7232b1 rejected this same 64-cell fixture
  // at 8192 points, even without the furniture obstacle.
  assert(p.positions.length<4000);assert(p.positions.length>100);assert.equal(p.components,2);assert.equal(components(p).length,2);assert.deepEqual(native.warnings,[]);assert.equal(native.linkCount,p.links.length*2);assert(native.points.every(n=>n.links.length>0&&n.links.length<=255));assert.deepEqual(osmPedestrianBytes(osmPedestrianPlan(f.source,f.roads,f.surface,props,f.green)),bytes);
  const walkable=clipping.difference(clipping.union(f.surface.footprints.sidewalk,...f.green.placements.map(i=>i.paths)),props.placements.map(i=>[i.footprint])),edges=walkable.flatMap(p=>p.flatMap(r=>r.slice(1).map((b,i)=>[r[i],b])));
  for(const v of p.positions)assert(Math.abs(v[1]-floor(v[0],v[2]))<6e-6);
  for(const[a,b]of p.links){const v=p.positions[a],w=p.positions[b],q=[v[0],v[2]],r=[w[0],w[2]];assert(distance(v,w)<=4.000001);assert(inside(walkable,q.map((n,k)=>(n+r[k])/2)));for(const[c,d]of edges){if(Math.max(c[0],d[0])<Math.min(q[0],r[0])-.4||Math.min(c[0],d[0])>Math.max(q[0],r[0])+.4||Math.max(c[1],d[1])<Math.min(q[1],r[1])-.4||Math.min(c[1],d[1])>Math.max(q[1],r[1])+.4)continue;assert(segmentDistance(q,r,c,d)>=.398,'entire body-wide link clears holes and boundaries');}}
});

test('convex islands, distant dead ends and small entrance gaps remain represented',()=>{
  const f=fixtures(),plain={...f.surface,footprints:{...f.surface.footprints,sidewalk:[[[[-30,-10],[30,-10],[30,-8],[-30,-8],[-30,-10]]]]}},island=osmPedestrianPlan(f.source,{...f.roads,roads:[]},plain);assert.equal(island.components,1);assert(Math.min(...island.positions.map(p=>p[0]))<-25);assert(Math.max(...island.positions.map(p=>p[0]))>25);
  const joined=osmPedestrianPlan(f.source,f.roads,f.surface,null,f.green),park=joined.positions.findIndex(v=>v[2]>55),north=joined.positions.findIndex(v=>v[0]<-20&&v[2]>3&&v[2]<5);assert(park>=0&&north>=0);assert(components(joined).some(c=>c.includes(park)&&c.includes(north)));
  const gap=fixtures({gap:.02}),separate=osmPedestrianPlan(gap.source,gap.roads,gap.surface,null,gap.green);assert.equal(separate.components,3);
});

test('terrain node overflow is still refused and legacy planar navigation bytes stay exact',()=>{
  const steep=fixtures({dense:true,steep:true});assert.throws(()=>osmPedestrianPlan(steep.source,steep.roads,steep.surface,null,steep.green),/8192/);
  const f=fixtures(),flat=osmSurfaceModel(f.roads,f.source.area,f.options),green=osmGreenPlan(f.source,flat,f.greenOptions),bytes=osmPedestrianBytes(osmPedestrianPlan(f.source,f.roads,flat,null,green));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),'cc9918ceacb80a7afe1bc5a3b34cea70caa39442d9453546ead45ef5cfb01f01');
});

// A shallow curve with many vertices catches accumulated corner cutting,
// which checking only the most recently removed point would miss.
test('link contraction preserves complete curve witnesses, pinned landings and genuine height ridges',()=>{
  const area={latitude:50,longitude:14,size:100},settings={version:1,area,columns:2,rows:2,base:2,samples:Array(9).fill(200)},field=osmElevationGrid(settings,area),terrain=osmNavigationElevation({elevation:field,levels:{road:.05,sidewalk:.2,ground:0}}),points=Array.from({length:201},(_,i)=>terrain.point([-4+i*.04,0,1.2*Math.sin(i/200*Math.PI)],.2)),links=points.slice(1).map((_,i)=>[i,i+1]),walkable=[[[[-10,-10],[10,-10],[10,10],[-10,10],[-10,-10]]]],result=compactPedestrianLinks(points,links,{walkable,levels:[],terrain,levelAt:()=>.2,pinned:new Set([100])}),live=new Set(result.flat());
  assert(live.size<30);for(const i of [0,100,200])assert(live.has(i));for(const p of points)assert(Math.min(...result.map(([a,b])=>pointDistance([p[0],p[2]],[points[a][0],points[a][2]],[points[b][0],points[b][2]])))<=.050001);
  const ridge=osmElevationGrid({...settings,samples:[200,201,200,200,201,200,200,201,200]},area),raised=osmNavigationElevation({elevation:ridge,levels:terrain.levels}),row=Array.from({length:81},(_,i)=>raised.point([-4+i*.1,0,0],.2)),edges=compactPedestrianLinks(row,row.slice(1).map((_,i)=>[i,i+1]),{walkable,levels:[],terrain:raised,levelAt:()=>.2});
  assert(new Set(edges.flat()).has(40),'the actual ridge survives');for(const[a,b]of edges)for(const c of ridge.splitEdge([row[a][0],row[a][2]],[row[b][0],row[b][2]]))assert(Math.abs(row[a][1]+(row[b][1]-row[a][1])*c.t-ridge.heightAt(...c.point)-.2)<2e-6);
});
