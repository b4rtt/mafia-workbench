import test from 'node:test';
import assert from 'node:assert/strict';
import {osmCollisionBudget,osmCollisionUsage,checkOsmCollisionBudget} from '../src/plugins/osm/collision-policy.js';
import {osmBuildingPlan} from '../src/plugins/osm/buildings.js';
import {osmHybridPlan} from '../src/plugins/osm/building-hybrid.js';
import {osmWalkwayPlan,osmWalkwayDefaults} from '../src/plugins/osm/walkways.js';

const frame={version:1,storage:'frame'};
test('collision storage is explicit and older saved imports retain their original budget',()=>{
  assert.deepEqual(osmCollisionBudget(),{vertices:60000});
  assert.deepEqual(osmCollisionBudget(JSON.parse(JSON.stringify(frame))),{vertices:240000,triangles:240000,bufferVertices:960000});
  for(const value of [null,{},false,{version:2,storage:'frame'},{version:1,storage:'world'},{...frame,unknown:true}])assert.throws(()=>osmCollisionBudget(value),/neplatný/);
});
test('points are welded only within an owner while native buffers and reverse faces have independent costs',()=>{
  const a={name:'A',positions:[0,0,0,1,0,0,0,0,1,99,0,99],indices:[0,1,2]},b={...a,positions:[0,0,0,1,0,0,0,0,1],doubleSided:true};
  assert.deepEqual(osmCollisionUsage([a,b,{...a,name:'B'}]),{vertices:6,triangles:4,bufferVertices:11});
  assert.deepEqual(checkOsmCollisionBudget([a,b],frame),{vertices:3,triangles:3,bufferVertices:7});
  const triangles={...b,indices:Array(120001*3).fill(0)};
  assert.throws(()=>checkOsmCollisionBudget([triangles],frame),/rozpočet/);
  const buffer={...a,positions:Array(65536*3).fill(0)};
  assert.throws(()=>checkOsmCollisionBudget(Array(15).fill(buffer),frame),/rozpočet/);
  const points={...a,positions:Array.from({length:60001},(_,i)=>[i,0,0]).flat(),indices:Array.from({length:60001},(_,i)=>i)};
  assert.throws(()=>checkOsmCollisionBudget(Array.from({length:4},(_,i)=>({...points,name:String(i)})),frame),/rozpočet/);
});
const rect=x=>[[x-7,-7],[x+7,-7],[x+7,7],[x-7,7]];
const source={area:{size:200},ways:[],buildings:[-25,25].map((x,i)=>({id:i+1,tags:{building:'house',height:'10'},polygons:[[rect(x)]]}))};
const roads={flat:true,crossings:[{position:[-90,0,-80]},{position:[90,0,-80]}],roads:[{from:0,to:1,positions:[]}]};
const empty={model:{meshes:[]},footprints:{road:[],sidewalk:[]}};
const catalog=[{path:'models/#rad016.4ds',sha256:'a'.repeat(64),kind:'house',min:[-5,0,-5],max:[5,10,5],vertices:30752}];
const settings={version:1,selected:[1,2],models:catalog.map(({path,sha256})=>({path,sha256})),adjustScale:false,minCoverage:.35,fallbackHeight:10,ground:.2};
test('original and mixed house planners share the explicitly enlarged budget without relaxing per-model limits',()=>{
  assert.equal(osmBuildingPlan(source,roads,empty,catalog,settings).placements.length,1);
  const planned=osmBuildingPlan(source,roads,empty,catalog,settings,frame);assert.equal(planned.placements.length,2);
  const hybrid={...settings,mode:'hybrid',styles:[{id:'brick'}],matching:{version:1}};
  assert.equal(osmHybridPlan(source,roads,empty,catalog,hybrid,frame).placements.filter(p=>p.method==='original').length,2);
  assert.throws(()=>osmBuildingPlan(source,roads,empty,[{...catalog[0],vertices:60001}],settings,frame),/rozměry/);
});
test('standalone paths reserve space in the same selected budget as houses and streets',()=>{
  const s={area:{size:200},ways:[{id:1,tags:{highway:'footway'},points:[[-80,0,40],[80,0,40]]}]},o={...osmWalkwayDefaults,selected:[1]};
  assert.throws(()=>osmWalkwayPlan(s,empty,null,o,61504),/60 000/);
  assert.equal(osmWalkwayPlan(s,empty,null,o,61504,frame).placements.length,1);
  assert.throws(()=>osmWalkwayPlan(s,empty,null,o,240000,frame),/240 000/);
});
