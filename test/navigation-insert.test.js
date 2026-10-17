import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { changeNavigationPoint, changeNavigationConnection, parseNavigation } from '../src/core/navigation.js';
import { parseSegments } from '../src/core/segments.js';
import { findNavigationRoute } from '../src/shared/navigation-route.js';
import { ModProject } from '../src/core/project.js';
import { hash, writeSafe } from '../src/core/files.js';

function fixture(direction='both') {
  let data=Buffer.alloc(98,0xac);data.writeUInt32LE(0x01abcedf);data.writeUInt32LE(3,4);
  for(let i=0;i<3;i++){const p=8+i*30;[i*10,0,0].forEach((v,j)=>data.writeFloatLE(v,p+j*4));data.writeUInt16LE(2,p+12);data.writeUInt16LE(77,p+14);data[p+28]=data[p+29]=0;}
  data=changeNavigationConnection(data,{action:'connect',from:0,to:2,direction});data=changeNavigationConnection(data,{action:'connect',from:0,to:1});
  const parsed=parseNavigation(data);for(const point of parsed.points)for(const link of point.links){const offset=98+link.index*8;data.writeUInt16LE(link.type|0x40,offset+2);data.writeUInt32LE(0x7fc00055,offset+4);}
  return data;
}
const route=(data,a,b)=>{const p=parseNavigation(data);return findNavigationRoute({positions:p.points.map(p=>p.position),edges:p.points.flatMap(p=>p.links.map(l=>[p.index,l.target])),types:p.points.flatMap(p=>p.links.map(l=>l.type))},a,b,2);};
test('inserting a navigation point splits both raw directions, preserves unrelated bytes and maps repeated IDs by index',()=>{
  const source=fixture('forward'),before=parseNavigation(source),result=changeNavigationPoint(source,{action:'insert',from:0,to:2,position:[15,4,3]}),after=parseNavigation(result.data),start=8+after.points.length*30;
  assert.equal(result.index,2);assert.deepEqual(result.mapping,[0,1,3]);assert.equal(after.points[2].id,0);assert.equal(after.points[2].type,2);assert.equal(after.points[2].areaSize,50);assert.equal(after.linkCount,before.linkCount+2);
  for(const old of before.points){const next=after.points[result.mapping[old.index]];assert.deepEqual(result.data.subarray(8+next.index*30,38+next.index*30),source.subarray(8+old.index*30,38+old.index*30));for(const link of old.links){const split=old.index===0&&link.target===2||old.index===2&&link.target===0,nextLink=next.links.find(l=>l.target===(split?result.index:result.mapping[link.target]));assert(nextLink);assert.equal(nextLink.type,link.type);if(!split)assert.deepEqual(result.data.subarray(start+nextLink.index*8+2,start+nextLink.index*8+8),source.subarray(98+link.index*8+2,98+link.index*8+8));}}
  const links=after.points[2].links;assert.equal(links.find(l=>l.target===3).type,0x42);assert.equal(links.find(l=>l.target===0).type,0xc2);
  for(const point of after.points)for(const link of point.links)if(point.index===2||link.target===2)assert.equal(result.data.readFloatLE(start+link.index*8+4),Math.fround(Math.hypot(...point.position.map((v,i)=>v-after.points[link.target].position[i]))));
  assert.deepEqual(route(result.data,0,3).indices,[0,2,3]);assert.deepEqual(route(result.data,3,0).indices,[]);assert.deepEqual(source,fixture('forward'));
});
test('asymmetric paths stay asymmetric and insertion before/after/equal X rebases every target correctly',()=>{
  const both=fixture(),parsed=parseNavigation(both),records=parsed.points.flatMap(p=>p.links.filter(l=>!(p.index===2&&l.target===0)).map(l=>both.subarray(98+l.index*8,106+l.index*8))),source=Buffer.concat([both.subarray(0,98),...records]);source[96]=source[97]=0;
  for(const position of [[-5,0,5],[10,2,0],[25,0,5]]){const r=changeNavigationPoint(source,{action:'insert',from:2,to:0,position}),p=parseNavigation(r.data);assert.equal(p.points[r.index].links.length,1);assert.equal(p.points[r.mapping[2]].links.length,0);assert.deepEqual(route(r.data,r.mapping[0],r.mapping[2]).indices,[r.mapping[0],r.index,r.mapping[2]]);assert.deepEqual(route(r.data,r.mapping[2],r.mapping[0]).indices,[]);assert(p.points.every((v,i)=>!i||v.position[0]>=p.points[i-1].position[0]));}
});
test('insert refuses absent/ambiguous links, collapsed float32 positions, bad categories, overflow and unsorted sources',()=>{
  const source=fixture();for(const request of [{from:0,to:0},{from:-1,to:2},{from:0,to:1.5},{from:1,to:2},{from:0,to:2,position:[0,0,0]},{from:0,to:2,position:[20+1e-9,0,0]},{from:0,to:2,position:[NaN,0,0]},{from:0,to:2,position:[3e38,3e38,3e38]}])assert.throws(()=>changeNavigationPoint(source,{action:'insert',position:[5,0,1],...request}));
  const bad=Buffer.from(source);bad.writeUInt16LE(4,80);assert.throws(()=>changeNavigationPoint(bad,{action:'insert',from:0,to:2,position:[5,0,0]}),/kategorií/);
  const unsorted=Buffer.from(source);unsorted.writeFloatLE(-1,38);assert.throws(()=>changeNavigationPoint(unsorted,{action:'insert',from:0,to:2,position:[5,0,1]}),/seřazené/);
  const duplicate=Buffer.from(source);duplicate.writeUInt16LE(2,106);assert.throws(()=>changeNavigationPoint(duplicate,{action:'insert',from:0,to:2,position:[5,0,1]}),/opakované/);
});
function segments(){const b=Buffer.alloc(20+24+12+16,0xab);b.fill(0,0,20);b.write('AISEG-V1.1-JIPO');b.writeUInt32LE(1,16);b.writeUInt32LE(4,20);b.writeUInt32LE(3,40);[0,1,2].forEach((v,i)=>b.writeUInt32LE(v,44+i*4));return b;}
test('project insertion remaps companion segments atomically with hash protection, export/reopen and exact undo',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'mafia-nav-insert-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));await writeSafe(root,'workbench.json',JSON.stringify({format:'mafia-workbench',version:2,name:'Insert',assets:[],history:[]}));
  const p=await ModProject.open(root),nav='missions/TEST/check.bin',seg='missions/TEST/clusters.seg',source=fixture(),oldSegments=segments(),request={action:'insert',from:0,to:2,position:[15,2,5]};await p.createFiles([{path:nav,data:source},{path:seg,data:oldSegments}]);
  const baseline=p.manifest.history.length;await assert.rejects(p.changeNavigationPoint(nav,request,'0'.repeat(64)),/změnil/);
  const save=p.saveManifest;p.saveManifest=async()=>{throw Error('publish failure');};await assert.rejects(p.changeNavigationPoint(nav,request,hash(source)),/publish failure/);p.saveManifest=save;assert.deepEqual(await p.read(nav),source);assert.deepEqual(await p.read(seg),oldSegments);assert.equal(p.manifest.history.length,baseline);
  const index=await p.changeNavigationPoint(nav,request,hash(source));assert.equal(index,2);assert.equal(p.manifest.history.length,baseline+1);assert.equal(p.manifest.history.at(-1).files.length,2);const fresh=await ModProject.open(root);assert.deepEqual(parseSegments(await fresh.read(seg),4).records[0].nodes,[0,1,3]);assert.deepEqual((await fresh.read(seg)).subarray(56),oldSegments.subarray(56));
  await fresh.export(root+'/export');for(const name of [nav,seg])assert.deepEqual(await fs.readFile(root+'/export/'+name),await fresh.read(name));await fresh.undo();assert.deepEqual(await fresh.read(nav),source);assert.deepEqual(await fresh.read(seg),oldSegments);assert.equal(fresh.manifest.history.length,baseline);
  await writeSafe(root,fresh.asset(seg).overlay??'mods/'+seg,Buffer.from('broken'));await assert.rejects(fresh.changeNavigationPoint(nav,request,hash(source)),/Segments/);assert.deepEqual(await fresh.read(nav),source);
});
