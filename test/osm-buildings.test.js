import test from 'node:test';
import assert from 'node:assert/strict';
import clipping from 'polygon-clipping';
import {Vector3} from 'three';
import {osmSource} from '../src/plugins/osm/area.js';
import {osmBuildingPlan} from '../src/plugins/osm/buildings.js';
import {loadOsmBuildingModels} from '../src/plugins/osm/building-assets.js';
import {writeSurfaceModel} from '../src/core/surface-model.js';
import {parseFourDs} from '../src/core/fourds.js';
import {modelCollisionBox} from '../src/core/model-collision.js';
import {frameMatrix} from '../src/shared/scene-world.js';
import {hash} from '../src/core/files.js';
const model={path:'models/HOUSE.4ds',sha256:'a'.repeat(64),min:[-7,-.2,-3],max:[5,10,5],vertices:8};
const options={version:1,selected:[1],adjustScale:true,minCoverage:.35,fallbackHeight:10,ground:.2};
const roads={flat:true,crossings:[{position:[-90,0,-30]},{position:[90,0,-30]}],roads:[{from:0,to:1,positions:[]}]};
function way(id,ring,tags={}){return {id,tags:{building:'yes',...tags},nodes:[...ring.map((_,i)=>id*1000+i),id*1000],points:[...ring,ring[0]].map(([x,z])=>[x,0,z])};}
const ring=[[-8,-6],[8,-6],[8,6],[-8,6]],source=(ways=[way(1,ring)])=>({area:{size:200},ways});
const plan=(s=source(),o={},catalog=[model],surface=null)=>osmBuildingPlan(s,roads,surface,catalog,{...options,...o});
const polygonArea=mp=>mp.reduce((s,p)=>s+Math.abs(p[0].reduce((v,a,i)=>{const b=p[0][(i+1)%p[0].length];return v+a[0]*b[1]-b[0]*a[1];},0))/2,0);
test('OSM houses fit rotated outlines using native WXYZ and off-centre model bounds without distortion',()=>{
  for(const angle of [0,.4,1.2,2.6]){
    const c=Math.cos(angle),s=Math.sin(angle),r=ring.map(([x,z])=>[20+c*x-s*z,30+s*x+c*z]),input=source([way(1,r)]),before=structuredClone(input),result=plan(input),p=result.placements[0];assert.equal(result.placements.length,1);assert.deepEqual(input,before);
    assert(p.scale.every(n=>n===p.scale[0]));assert(p.scale[0]>=.85-1e-6&&p.scale[0]<=1.15+1e-6);
    const matrix=frameMatrix(p),corners=[[-7,-3],[5,-3],[5,5],[-7,5]].map(([x,z])=>new Vector3(x,0,z).applyMatrix4(matrix).toArray()).map(p=>[p[0],p[2]]);
    assert(polygonArea(clipping.difference([[...corners,corners[0]]],[r]))<1e-4);
    for(const corner of corners)assert(p.footprint.some(q=>Math.hypot(q[0]-corner[0],q[1]-corner[1])<1e-5));
    const box=modelCollisionBox({meshes:[{id:1,name:'House',type:1,lods:[{positions:[...model.min,...model.max],faces:[{indices:[0,1,0]}]}]}]},{...p,frameType:9,model:p.model},{objects:[{...p,frameType:9,model:p.model}]},{meshes:[]});
    assert(Math.abs(box.max[1]-10*p.scale[0]-.2)<1e-5);
  }
});
test('whole concave outline, street/sidewalk exclusions and occupied house footprints prevent overlaps',()=>{
  const large={...model,min:[-6,0,-6],max:[6,10,6]},concave=[[-10,-10],[10,-10],[10,10],[3,10],[3,-3],[-3,-3],[-3,10],[-10,10]];
  assert.equal(plan(source([way(1,concave)]),{adjustScale:false},[large]).placements.length,0);
  const all=[way(1,ring),way(2,ring)],result=plan(source(all),{selected:[1,2]});assert.equal(result.placements.length,1);assert.equal(result.skipped.length,1);
  const block={model:{meshes:[]},footprints:{road:[[[[-20,-20],[20,-20],[20,20],[-20,20],[-20,-20]]]],sidewalk:[]}};
  assert.equal(plan(source(),{},[model],block).placements.length,0);const across={...roads,crossings:roads.crossings.map(c=>({position:[c.position[0],0,0]}))};assert.equal(osmBuildingPlan(source(),across,null,[model],options).placements.length,0);block.footprints.sidewalk=block.footprints.road;block.footprints.road=[];assert.equal(plan(source(),{},[model],block).placements.length,0);
});
test('height matching rejects tall substitutes for low houses and labels estimated and explicit heights',()=>{
  const low={...model,path:'models/LOW.4ds',max:[5,6,5]},s=source([way(1,ring,{'building:levels':'1'})]),p=plan(s,{},[model,low]).placements[0];assert.equal(p.model,low.path);assert.equal(p.height,6);assert.equal(p.estimated,true);assert.match(p.heightSource,/odhad/);
  assert.equal(plan(s,{},[{...model,max:[5,20,5]}]).placements.length,0);
  const h=plan(source([way(1,ring,{height:'32.8 ft'})])).placements[0];assert.equal(h.estimated,false);assert(Math.abs(h.height-9.99744)<1e-5);
  const fallback=plan().placements[0];assert.equal(fallback.height,10);assert.equal(fallback.estimated,true);
});
test('special buildings, incomplete boundaries, floating parts and off-area houses require manual placement',()=>{
  for(const tags of [{building:'church'},{'building:part':'yes'},{min_height:'4'},{'building:min_level':'2'},{layer:'1'}])assert.equal(plan(source([way(1,ring,tags)])).placements.length,0);
  assert.equal(plan(source([way(1,ring.map(([x,z])=>[x+99,z]))])).placements.length,0);const open=source();open.ways[0].nodes.pop();open.ways[0].points.pop();assert.equal(plan(open).placements.length,0);
});
test('collision vertex budget is conservative and per-import house limits have explicit reasons',()=>{
  const dense={...model,vertices:40000},s=source([way(1,ring),way(2,ring.map(([x,z])=>[x+30,z]))]),result=plan(s,{selected:[1,2]},[dense]);assert.equal(result.placements.length,1);assert.match(result.skipped[0].reason,/vrcholů/);
  const many=Array.from({length:33},(_,i)=>way(i+1,ring.map(([x,z])=>[x+(i%6-2.5)*27,z+(Math.floor(i/6)-2.5)*27]))),max=osmBuildingPlan(source(many),{...roads,crossings:roads.crossings.map(c=>({position:[c.position[0],0,-99]}))},null,[model],{...options,selected:many.map(w=>w.id)});assert.equal(max.placements.length,32);assert.match(max.skipped[0].reason,/32/);
});
test('disabled scale adjustment preserves original dimensions; plans are deterministic and validate selections',()=>{
  const p=plan(source(),{adjustScale:false}).placements[0];assert.deepEqual(p.scale,[1,1,1]);assert.deepEqual(plan(),plan());
  for(const change of [{version:2},{selected:[1,1]},{selected:[2]},{selected:Array.from({length:129},(_,i)=>i+1)},{ground:NaN},{minCoverage:.1},{adjustScale:1},{fallbackHeight:100}])assert.throws(()=>plan(source(),change),/budovy/);
  assert.throws(()=>plan(source(),{},[{...model,vertices:0}]),/rozměry/);assert.throws(()=>plan(source(),{},[]),/nastavení/);
});
function boxBytes(){const positions=[-7,0,-3,5,0,-3,5,0,5,-7,0,5,-7,10,-3,5,10,-3,5,10,5,-7,10,5];return writeSurfaceModel({materials:[{flags:1,ambient:[1,1,1],diffuse:[1,1,1],emission:[0,0,0],opacity:1,texture:''}],meshes:[{name:'House',type:1,visual:0,renderFlags:0,logicFlags:0x2a,parent:0,position:[0,0,0],scale:[1,1,1],rotation:[1,0,0,0],culling:9,lods:[{distance:0,vertices:8,positions,normals:Array(24).fill(0),uv:Array(16).fill(0),faces:[{material:1,indices:[4,6,5,4,7,6,0,1,5,0,5,4,1,2,6,1,6,5,2,3,7,2,7,6,3,0,4,3,4,7]}]}]}]});}
test('project catalog inspects actual native geometry and hashes; rejects invalid paths and reports missing models',async()=>{
  const bytes=boxBytes(),project={asset:p=>{if(p.toLowerCase()!==model.path.toLowerCase())throw Error('missing');return {path:model.path};},read:async()=>bytes},result=await loadOsmBuildingModels(project,[model.path,'models/MISSING.4ds']);assert.equal(result.models.length,1);assert.equal(result.warnings.length,1);assert.equal(result.models[0].sha256,hash(bytes));assert.deepEqual(result.models[0].min,[-7,0,-3]);assert.deepEqual(result.models[0].max,[5,10,5]);assert.equal(result.models[0].vertices,8);assert.deepEqual(result.loaded.get(model.path.toLowerCase()),parseFourDs(bytes,true));
  for(const paths of [[],[model.path,model.path.toLowerCase()],['models/../bad.4ds'],['http://example.com/a.4ds']])await assert.rejects(loadOsmBuildingModels(project,paths),/vyberte/);
});

test('known multipolygon members are excluded so a standalone outer way cannot fill a courtyard',()=>{
  const data={elements:[...[[-8,-6],[8,-6],[8,6],[-8,6]].map(([x,z],i)=>({type:'node',id:i+1,lat:50+z/6371008.8*180/Math.PI,lon:14+x/6371008.8*180/Math.PI/Math.cos(50*Math.PI/180)})),{type:'way',id:1,nodes:[1,2,3,4,1],tags:{building:'yes','building:part':'no',min_height:'0','building:min_level':'0'}},{type:'relation',id:42,tags:{type:'multipolygon',building:'yes'},members:[{type:'way',ref:1,role:'outer'}]}]},s=osmSource(data,{latitude:50,longitude:14,size:200});assert.equal(s.ways[0].buildingRelation,true);assert.equal(s.ways[0].tags.min_height,'0');assert.equal(s.ways[0].tags['building:min_level'],'0');const result=plan(s);assert.equal(result.placements.length,0);assert.match(result.skipped[0].reason,/multipolygonu/);
});
