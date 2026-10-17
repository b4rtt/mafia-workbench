import test from 'node:test';
import assert from 'node:assert/strict';
import {osmBuildingPlan} from '../src/plugins/osm/buildings.js';
import {osmBuildingProfiles,osmBuildingProfile} from '../src/plugins/osm/building-selection.js';
import {osmBuildingModelPaths,loadOsmBuildingModels} from '../src/plugins/osm/building-assets.js';
import {writeSurfaceModel} from '../src/core/surface-model.js';
const roads={crossings:[{position:[-100,0,-70]},{position:[100,0,-70]}],roads:[{from:0,to:1,positions:[]}]},surface={model:{meshes:[]},footprints:{road:[],sidewalk:[]}};
const house=(path,height=9)=>({path,sha256:'a'.repeat(64),min:[-5,0,-5],max:[5,height,5],vertices:8}),catalog=[house('models/3rad06.4ds'),house('models/#rad016.4ds'),house('models/#rad018.4ds')];
const feature=(id,building='yes',extra={})=>({id,tags:{building,...extra},polygons:[[[[-7+(id%4)*30,-7+Math.floor(id/4)*30],[7+(id%4)*30,-7+Math.floor(id/4)*30],[7+(id%4)*30,7+Math.floor(id/4)*30],[-7+(id%4)*30,7+Math.floor(id/4)*30]]]]});
const options={version:1,selected:[1],adjustScale:false,minCoverage:.35,fallbackHeight:15,ground:.2,matching:{version:1}};
const plan=(features=[feature(1)],models=catalog,change={})=>osmBuildingPlan({area:{size:450},ways:[],buildings:features},roads,surface,models,{...options,selected:features.map(f=>f.id),...change});

test('audited matching separates family and urban forms, preserves exact heights and reports missing or unsupported model kinds',()=>{
  for(const type of ['house','detached','semidetached_house','bungalow']){
    const r=plan([feature(1,type,{height:'9 m'})]);assert.equal(r.placements.length,1);assert.equal(osmBuildingProfile(r.placements[0].model).kind,'house');assert.equal(r.placements[0].height,9);assert.equal(r.placements[0].estimated,false);
  }
  for(const type of ['apartments','office','commercial','retail','hotel','terrace']){const p=plan([feature(1,type,{height:'9'})]).placements[0];assert.equal(p.model,catalog[0].path);assert.equal(p.matching.kind,'urban');}
  for(const type of ['industrial','warehouse','barn','garage','school','made_up']){const p=plan([feature(1,type)]);assert.equal(p.placements.length,0);assert.match(p.skipped[0].reason,/ověřený vhodný model/);}
  const p=plan([feature(1,'house')],[catalog[0]]);assert.equal(p.placements.length,0);assert.match(p.skipped[0].reason,/odpovídající typu/);
  assert.equal(plan([feature(1,'apartments')],[catalog[1]]).placements.length,0);
  // Arbitrary project metadata cannot turn an unaudited object into a house.
  assert.equal(plan([feature(1,'house')],[{...catalog[0],path:'models/CAR.4ds',kind:'house'}]).placements.length,0);
  assert.equal(plan([feature(1,'house',{height:'40'})]).placements.length,0);
});
test('missing family heights are explicitly estimated, while generic residential does not invent a known architectural form',()=>{
  const p=plan([feature(1,'house')]).placements[0];assert.equal(p.height,9);assert.equal(p.estimated,true);assert.match(p.heightSource,/odhad podle typu OSM/);
  const bungalow=plan([feature(1,'bungalow')],[house(catalog[1].path,6)]).placements[0];assert.equal(bungalow.height,6);
  const lower=plan([feature(1,'house')],[house(catalog[1].path,5)],{fallbackHeight:5}).placements[0];assert.equal(lower.height,5);
  const levels=plan([feature(1,'house',{'building:levels':'3'})],[house(catalog[1].path,12)]).placements[0];assert.equal(levels.height,12);assert.match(levels.heightSource,/building:levels/);
  for(const type of ['yes','residential']){const q=plan([feature(1,type)],[house(catalog[0].path,15)]).placements[0];assert.equal(q.height,15);assert.equal(q.matching.kind,'mixed');assert.match(q.matching.note,/neurčuje/);}
});
test('equally suitable original houses vary reproducibly without changing their transforms or geometry constraints',()=>{
  const features=Array.from({length:12},(_,i)=>feature(i+1,'house',{height:'9'})),models=catalog.slice(1),r=plan(features,models),counts=new Map();assert.equal(r.placements.length,12);
  for(const p of r.placements){assert.deepEqual(p.scale,[1,1,1]);assert(p.coverage>=.35&&p.coverage<=1);counts.set(p.model,(counts.get(p.model)??0)+1);}
  assert.deepEqual([...counts.values()].sort(),[6,6]);assert.deepEqual(r,plan(JSON.parse(JSON.stringify(features)),JSON.parse(JSON.stringify(models))));assert.deepEqual(r,plan(features,[...models].reverse()));
  const before=structuredClone(features);plan(features);assert.deepEqual(features,before);
});
test('legacy plans have no new metadata or type restrictions, and invalid matching is rejected before generation',()=>{
  const unknown=house('models/UNKNOWN.4ds',15),s=[feature(1,'industrial')],r=plan(s,[unknown],{matching:undefined});assert.equal(r.placements.length,1);assert.equal(r.placements[0].matching,undefined);assert.equal(r.placements[0].height,15);
  for(const matching of [null,false,{},1,{version:2},{version:1,extra:true}])assert.throws(()=>plan(s,[unknown],{matching}),/pravidla výběru/);
});
test('expanded original catalogue has 24 distinct audited models and exposes categories only for known names',async()=>{
  assert.equal(osmBuildingModelPaths.length,24);assert.equal(new Set(osmBuildingModelPaths.map(p=>p.toLowerCase())).size,24);assert.equal(osmBuildingProfiles.filter(p=>p.kind==='house').length,9);assert.equal(osmBuildingProfile('MODELS/#RAD016.4DS').kind,'house');assert.equal(osmBuildingProfile('models/CAR.4ds'),undefined);
  const positions=[-5,0,-5,5,0,-5,0,9,5],bytes=writeSurfaceModel({materials:[{flags:1,ambient:[1,1,1],diffuse:[1,1,1],emission:[0,0,0],opacity:1,texture:''}],meshes:[{id:1,name:'House',type:1,visual:0,renderFlags:0,logicFlags:0x2a,parent:0,position:[0,0,0],scale:[1,1,1],rotation:[1,0,0,0],culling:9,lods:[{distance:0,vertices:3,positions,normals:Array(9).fill(0),uv:Array(6).fill(0),faces:[{material:1,indices:[0,1,2]}]}]}]}),project={asset:p=>({path:p}),read:async()=>bytes};
  const result=await loadOsmBuildingModels(project);assert.equal(result.models.length,24);assert.equal(result.warnings.length,0);assert.equal(result.models.find(p=>p.path==='models/#rad016.4ds').kind,'house');
  await assert.rejects(loadOsmBuildingModels(project,Array.from({length:33},(_,i)=>`models/house${i}.4ds`)),/1–32/);
});
