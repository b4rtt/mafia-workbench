import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {osmArea,osmMapLocation,osmSource,osmRoadPlan} from '../src/plugins/osm/area.js';
import {osmRoadBytes} from '../src/plugins/osm/mission.js';
import {downloadOsm,osmQuery} from '../src/plugins/osm/download.js';
import {parseRoads} from '../src/core/roads.js';
import {ModProject} from '../src/core/project.js';
import {writeSafe} from '../src/core/files.js';
const area={latitude:50,longitude:14,size:200},r=6371008.8,rad=Math.PI/180;
const node=(id,x,z)=>({type:'node',id,lat:50+z/r/rad,lon:14+x/r/rad/Math.cos(50*rad)});
const way=(id,nodes,tags={})=>({type:'way',id,nodes,tags:{highway:'residential',...tags}});
const data={elements:[node(1,-150,0),node(2,0,0),node(3,150,0),node(4,0,-150),node(5,0,150),way(10,[1,2,3]),way(11,[4,2,5],{oneway:'yes'})]};
test('OSM projection uses metres, north is positive Z, and bounding box clips roads with one shared native junction',()=>{
  const source=osmSource(data,area),plan=osmRoadPlan(source,[10,11]);assert.equal(plan.crossings.length,5);assert.equal(plan.roads.length,4);
  assert.ok(Math.abs(source.ways[0].points[0][0]+150)<1e-6);assert.ok(source.ways[1].points.at(-1)[2]>149.99);
  assert.equal(plan.crossings.filter(c=>c.id==='n2').length,1);assert.ok(plan.crossings.every(c=>c.position.every(n=>Math.abs(n)<=100)));
  const file=parseRoads(osmRoadBytes(plan));assert.equal(file.crossings.length,5);assert.equal(file.nodes.length,4);assert.deepEqual(file.warnings,[]);
  const center=file.crossings.find(c=>Math.hypot(...c.position)<.01);assert.equal(center.links.filter(n=>n!==65535).length,4);
  assert.equal(file.crossings.flatMap(c=>c.directions).filter(d=>d.target!==65535).length,6);
});
test('crossing geometry alone never invents a junction, bridges and access restrictions remain excluded',()=>{
  const input={elements:[node(1,-80,0),node(2,80,0),node(3,0,-80),node(4,0,80),way(10,[1,2]),way(11,[3,4]),way(12,[1,2],{bridge:'yes'}),way(13,[1,2],{access:'private'}),way(14,[1,2],{highway:'footway'}),way(15,[1,2],{oneway:'reversible'})]};
  const source=osmSource(input,area),plan=osmRoadPlan(source,[10,11]);assert.equal(plan.crossings.length,4);assert.equal(plan.roads.length,2);for(const id of [12,13,14,15])assert.throws(()=>osmRoadPlan(source,[id]),/připravená/);
});
test('oneway reverse, roundabouts and motorway implicit direction compile to correct directed routes',()=>{
  for(const[tags,forward,reverse]of [[{oneway:'-1'},false,true],[{junction:'roundabout'},true,false],[{highway:'motorway'},true,false],[{highway:'motorway',oneway:'no'},true,true]]){
    const plan=osmRoadPlan(osmSource({elements:[node(1,-50,0),node(2,50,0),way(10,[1,2],tags)]},area),[10]);assert.equal(plan.roads[0].forward,forward);assert.equal(plan.roads[0].reverse,reverse);const file=parseRoads(osmRoadBytes(plan));assert.equal(file.crossings[0].directions.some(d=>d.target===1),forward);assert.equal(file.crossings[1].directions.some(d=>d.target===0),reverse);
  }
  const ring=osmRoadPlan(osmSource({elements:[node(1,-30,-30),node(2,30,-30),node(3,0,30),way(10,[1,2,3,1],{junction:'roundabout'})]},area),[10]);assert.equal(ring.crossings.length,3);assert.equal(ring.roads.length,3);assert.equal(parseRoads(osmRoadBytes(ring)).crossings.flatMap(c=>c.directions).filter(d=>d.target!==65535).length,3);
});
test('parallel ways are split without losing directions, unsupported degree and partial data reject',()=>{
  const source=osmSource({elements:[node(1,-40,0),node(2,40,0),node(3,0,30),way(10,[1,2]),way(11,[1,3,2],{oneway:'-1'})]},area),plan=osmRoadPlan(source,[10,11]);assert.equal(plan.roads.length,3);assert.equal(plan.crossings.length,3);assert.deepEqual(parseRoads(osmRoadBytes(plan)).warnings,[]);
  const elements=[node(1,0,0),...Array.from({length:5},(_,i)=>node(i+2,80*Math.cos(i*1.2),80*Math.sin(i*1.2))),...Array.from({length:5},(_,i)=>way(10+i,[1,2+i]))];assert.throws(()=>osmRoadPlan(osmSource({elements},area),[10,11,12,13,14]),/čtyři/);
  for(const input of [{remark:'timeout',elements:[]},{elements:[way(10,[1,2])]},{elements:[node(1,0,0),node(1,0,0)]},{elements:[node(1,NaN,0)]}])assert.throws(()=>osmSource(input,area));
  for(const ids of [[],[10,10],[NaN]])assert.throws(()=>osmRoadPlan(source,ids));
});
test('map links and bounded queries reject foreign URLs and invalid regions',()=>{
  assert.deepEqual(osmMapLocation('https://www.openstreetmap.org/#map=18/50/14&layers=N'),{latitude:50,longitude:14});
  for(const text of ['https://example.com/#map=18/50/14','http://openstreetmap.org/#map=18/50/14','https://openstreetmap.org/#map=18/90/14'])assert.throws(()=>osmMapLocation(text));
  for(const value of [{...area,size:451},{...area,latitude:'50'},{...area,longitude:NaN}])assert.throws(()=>osmArea(value));
  assert.match(osmQuery(area),/rel\(bw.seed\)\["building"\]/);assert.match(osmQuery(area),/\(\._;>;\);out body qt;/);
});
test('downloads validate before caching, reuse offline cache, bound responses and never retry a failed request',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'mafia-osm-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));let calls=0,time=Date.now()+1e8;
  const fetcher=async(url,options)=>{calls++;assert.equal(url,'https://overpass-api.de/api/interpreter');assert.equal(options.redirect,'error');assert.ok(options.signal);return new Response(JSON.stringify(data));};
  const first=await downloadOsm(area,{cacheRoot:root,fetcher,now:()=>time});assert.equal(first.cached,false);assert.equal(calls,1);
  // Real file timestamps must be within the fake clock's cache window.
  for(const file of await fs.readdir(root))await fs.utimes(path.join(root,file),new Date(time),new Date(time));
  const second=await downloadOsm(area,{cacheRoot:root,fetcher:()=>{throw Error('network must not run');},now:()=>time+1});assert.equal(second.cached,true);
  await assert.rejects(downloadOsm(area,{fetcher,now:()=>time+2}),/30 sekund/);
  time+=40000;await assert.rejects(downloadOsm(area,{fetcher:async()=>{calls++;return new Response('busy',{status:429});},now:()=>time}),/429/);assert.equal(calls,2);
  time+=40000;await assert.rejects(downloadOsm(area,{fetcher:async()=>{calls++;return new Response('<html>All query workers are busy and the request queue is full.</html>',{status:502});},now:()=>time}),error=>{assert.match(error.message,/HTTP 502.*přetížený.*fronta/);assert.doesNotMatch(error.message,/<html>/);return true;});assert.equal(calls,3);
  let cancelled=false,pulls=0;const stream=new ReadableStream({pull(controller){pulls++;controller.enqueue(new Uint8Array(4096));},cancel(){cancelled=true;}});
  time+=40000;await assert.rejects(downloadOsm(area,{fetcher:async()=>new Response(stream,{status:504}),now:()=>time}),/HTTP 504.*Brána/);assert.equal(cancelled,true);assert.ok(pulls<=2);
  time+=40000;await assert.rejects(downloadOsm(area,{fetcher:async()=>new Response(JSON.stringify({remark:'timeout',elements:[]})),now:()=>time}),/neúplná/);
  time+=40000;await assert.rejects(downloadOsm(area,{fetcher:async()=>new Response(Buffer.alloc(8*1024*1024+1)),now:()=>time}),/8 MB/);
  await assert.rejects(downloadOsm(area,{provider:'https://untrusted.example',fetcher}),/poskytovatel/);
});
test('native OSM road bytes remain editable and survive project export, reopen and undo',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'mafia-osm-roads-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));await writeSafe(root,'workbench.json',JSON.stringify({format:'mafia-workbench',version:1,name:'OSM audit',assets:[],history:[]}));const project=await ModProject.open(root),bytes=osmRoadBytes(osmRoadPlan(osmSource(data,area),[10,11])),name='missions/OSM_TEST/road.bin';
  await project.createFiles([{path:name,data:bytes}]);const file=await project.inspect(name);assert.equal(file.type,'roads');const before=await project.read(name);const {hash}=await import('../src/core/files.js');await project.changeRoadTopology(name,{action:'create-crossing',position:[80,0,80]},hash(before));assert.equal((await project.inspect(name)).crossings.length,6);
  const reopened=await ModProject.open(root);await reopened.export(root+'/export');assert.deepEqual(await fs.readFile(root+'/export/'+name),await project.read(name));await reopened.undo();assert.deepEqual(await reopened.read(name),before);await reopened.undo();assert.throws(()=>reopened.asset(name));
});
