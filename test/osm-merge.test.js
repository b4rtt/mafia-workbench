import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {mergeOsmInputs,osmMergeInfo,readOsmMergeFiles} from '../src/plugins/osm/merge.js';
import {osmSource,osmRoadPlan} from '../src/plugins/osm/area.js';
import {osmRoadBytes} from '../src/plugins/osm/mission.js';
import {parseRoads} from '../src/core/roads.js';
import {osmSurfaceModel,osmSurfaceDefaults} from '../src/plugins/osm/surface.js';
import {writeSurfaceModel} from '../src/core/surface-model.js';

const area={latitude:50,longitude:14,size:300},rad=Math.PI/180,earth=6371008.8;
const node=(id,x,z)=>({type:'node',id,lat:50+z/earth/rad,lon:14+x/earth/rad/Math.cos(50*rad)});
const way=(id,nodes,tags={})=>({type:'way',id,nodes,tags:{highway:'residential',...tags}});
const part=elements=>({version:.6,osm3s:{timestamp_osm_base:'2026-06-01T08:52:28Z'},elements});
const west=()=>part([node(1,-100,0),node(2,0,0),way(10,[1,2])]);
const east=()=>part([node(2,0,0),node(3,100,0),way(11,[2,3])]);
const complete=()=>part([node(1,-100,0),node(2,0,0),node(3,100,0),way(10,[1,2]),way(11,[2,3])]);

test('overlapping source parts share one native junction and produce the same streets as a complete source',()=>{
  const inputs=[west(),east()],before=structuredClone(inputs),merged=mergeOsmInputs(inputs,area);
  assert.deepEqual(merged.merge,{files:2,elements:5,duplicates:1,sameSnapshot:true});
  const plan=osmRoadPlan(merged.source,[10,11]),baseline=osmRoadPlan(osmSource(complete(),area),[10,11]);
  assert.deepEqual(plan,baseline);assert.equal(plan.crossings.filter(p=>p.id==='n2').length,1);
  assert.deepEqual(osmRoadBytes(plan),osmRoadBytes(baseline));
  const native=parseRoads(osmRoadBytes(plan)),center=native.crossings.find(c=>Math.hypot(...c.position)<.01);
  assert.equal(center.links.filter(n=>n!==65535).length,2);assert.deepEqual(native.warnings,[]);
  assert.deepEqual(writeSurfaceModel(osmSurfaceModel(plan,area,osmSurfaceDefaults).model),writeSurfaceModel(osmSurfaceModel(baseline,area,osmSurfaceDefaults).model));
  assert.deepEqual(inputs,before);
});
test('file order and object key order cannot change the merged data, provenance or native result',()=>{
  const left=west(),right=east();left.elements[0].tags={'custom:future':'preserved',name:'A'};
  const swapped=JSON.parse(JSON.stringify([right,left]),(_key,value)=>value&&!Array.isArray(value)&&typeof value==='object'?Object.fromEntries(Object.entries(value).reverse()):value);
  const a=mergeOsmInputs([left,right],area),b=mergeOsmInputs(swapped,area);
  assert.equal(JSON.stringify(a),JSON.stringify(b));assert.equal(a.data.elements[0].tags['custom:future'],'preserved');
  assert.equal(a.data.workbench_merge.inputs.length,2);assert(a.data.workbench_merge.inputs.every(i=>/^[a-f0-9]{64}$/.test(i.sha256)));
});
test('conflicting coordinates, tags, node sequences and unknown metadata reject rather than select a winner',()=>{
  const a=west();
  for(const alter of [b=>b.elements[0].lat+=.0001,b=>b.elements[0].tags={name:'different'},b=>b.elements[2].nodes.reverse(),b=>b.elements[2].tags.highway='service',b=>b.elements[0].version=2]){
    const b=structuredClone(a);alter(b);assert.throws(()=>mergeOsmInputs([a,b],area),/rozdílné verze/);assert.throws(()=>mergeOsmInputs([b,a],area),/rozdílné verze/);
  }
  assert.deepEqual(a,west());
});
test('coincident geometry with distinct OSM identities never invents a junction',()=>{
  const a=part([node(1,-100,0),node(2,100,0),way(10,[1,2])]),b=part([node(3,0,-100),node(4,0,100),way(11,[3,4])]);
  const result=mergeOsmInputs([a,b],area),plan=osmRoadPlan(result.source,[10,11]);
  assert.equal(result.merge.duplicates,0);assert.equal(plan.crossings.length,4);assert.equal(plan.roads.length,2);
});
test('multipolygon buildings retain members, holes and unknown attributes only once across overlapping parts',()=>{
  const shape=[node(20,-60,30),node(21,-20,30),node(22,-20,70),node(23,-60,70),node(24,-50,40),node(25,-30,40),node(26,-30,60),node(27,-50,60),
    {type:'way',id:30,nodes:[20,21,22,23,20]},{type:'way',id:31,nodes:[24,25,26,27,24]},
    {type:'relation',id:40,tags:{type:'multipolygon',building:'apartments','future:tag':'keep'},members:[{type:'way',ref:30,role:'outer'},{type:'way',ref:31,role:'inner'}]}];
  const a=part([...west().elements,...shape]),b=part([...east().elements,...structuredClone(shape)]),result=mergeOsmInputs([a,b],area);
  assert.equal(result.source.buildings.length,1);assert.equal(result.source.buildings[0].polygons[0].length,2);
  assert.equal(result.data.elements.filter(e=>e.type==='relation').length,1);assert.equal(result.data.elements.at(-1).tags['future:tag'],'keep');
  b.elements.at(-1).members.reverse();assert.throws(()=>mergeOsmInputs([a,b],area),/relation\/40.*rozdílné verze/);
});
test('one complete part cannot conceal timeout, duplicate identity or missing references in another',()=>{
  for(const broken of [{remark:'timeout',elements:[]},part([node(1,0,0),node(1,0,0)]),part([way(10,[1,2])]),part([{type:'way',id:50,nodes:[1,2]}]),part([{type:'relation',id:60,members:[{type:'way',ref:50,role:'outer'}],tags:{type:'multipolygon'}}])]){
    assert.throws(()=>mergeOsmInputs([complete(),broken],area));
  }
});
test('saved parts use one target projection without inheriting mission settings or claiming a common snapshot',()=>{
  const a={format:'mafia-workbench-osm-source',version:1,area:{...area,longitude:14.0005},data:west(),surface:{width:18},selected:[10],elevation:{invalid:'ignored'}},b=east();b.osm3s.timestamp_osm_base='2026-06-02T08:52:28Z';
  const result=mergeOsmInputs([a,b],area);assert.deepEqual(result.source.area,osmSource(complete(),area).area);assert.equal(result.merge.sameSnapshot,false);
  assert.equal(result.data.osm3s,undefined);assert.equal(result.surface,undefined);assert.equal(result.elevation,undefined);assert.equal(result.data.workbench_merge.inputs.length,2);
  assert.deepEqual(osmRoadPlan(result.source,[10,11]),osmRoadPlan(osmSource(complete(),area),[10,11]));
  const missing=west();delete missing.osm3s;assert.equal(mergeOsmInputs([missing,east()],area).merge.sameSnapshot,false);
  const roundtrip=JSON.parse(JSON.stringify(result.data));assert.deepEqual(osmMergeInfo(roundtrip),result.merge);assert.deepEqual(osmSource(roundtrip,area),result.source);
  roundtrip.workbench_merge.duplicates++;assert.throws(()=>osmMergeInfo(roundtrip),/evidence/);
  assert.equal(mergeOsmInputs([result.data,east()],area).source.ways.length,2);
});
test('file and element budgets remain bounded, and unsuccessful reads do not modify the inputs',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'mafia-osm-merge-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const filenames=[root+'/west.json',root+'/east.json'];await fs.writeFile(filenames[0],JSON.stringify(west()));await fs.writeFile(filenames[1],JSON.stringify(east()));
  const before=await Promise.all(filenames.map(f=>fs.readFile(f)));
  assert.deepEqual(await readOsmMergeFiles(filenames,area),mergeOsmInputs([west(),east()],area));
  for(const files of [[],[filenames[0]],Array(17).fill(filenames[0])])await assert.rejects(readOsmMergeFiles(files,area),/2–16/);
  await fs.writeFile(root+'/large.json',Buffer.alloc(8*1024*1024+1));await assert.rejects(readOsmMergeFiles([filenames[0],root+'/large.json'],area),/8 MB/);
  await assert.rejects(readOsmMergeFiles([filenames[0],root],area),/8 MB/);
  assert.deepEqual(await Promise.all(filenames.map(f=>fs.readFile(f))),before);
  const big=west();big.padding='x'.repeat(8*1024*1024);assert.throws(()=>mergeOsmInputs([big,east()],area),/8 MB/);
  const nodes=(start,count)=>part(Array.from({length:count},(_,i)=>node(start+i,0,0)));
  assert.throws(()=>mergeOsmInputs([nodes(1,30001),nodes(30002,30000)],area),/příliš velká/);
});
