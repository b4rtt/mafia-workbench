import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {parseNavigation,prepareNavigationEdits,changeNavigationConnection} from '../src/core/navigation.js';
import {parseSegments} from '../src/core/segments.js';
import {ModProject} from '../src/core/project.js';
import {hash,writeSafe} from '../src/core/files.js';
import {synchronizeAssets} from '../src/core/playtest.js';

function navigation(){
  const targets=[[1],[0,2],[3,0],[2]],bytes=Buffer.alloc(176,0xab);bytes.writeUInt32LE(0x01abcedf);bytes.writeUInt32LE(4,4);let link=0;
  for(let i=0;i<4;i++){const offset=8+i*30;[i*10,0,0].forEach((n,j)=>bytes.writeFloatLE(n,offset+j*4));bytes.writeUInt16LE(1,offset+12);bytes.writeUInt16LE(99,offset+14);bytes[offset+28]=bytes[offset+29]=targets[i].length;
    for(const target of targets[i]){bytes.writeUInt16LE(target,128+link*8);bytes.writeUInt16LE(0x81+link,130+link*8);bytes.writeUInt32LE(0x7fc00055+link,132+link*8);link++;}
  }return bytes;
}
function segments(){const bytes=Buffer.alloc(20+24+8+16,0xac);bytes.fill(0,0,20);bytes.write('AISEG-V1.1-JIPO');bytes.writeUInt32LE(1,16);bytes.writeUInt32LE(4,20);bytes.writeUInt32LE(2,40);bytes.writeUInt32LE(0,44);bytes.writeUInt32LE(2,48);return bytes;}
function distance(bytes,point,link){return bytes.readFloatLE(128+point.links[link].index*8+4);}
test('semantic movement sorts by X, preserves repeated IDs and raw descriptors, and updates only incident distances',()=>{
  const source=navigation(),original=parseNavigation(source),result=prepareNavigationEdits(source,[{id:'points/0/position',value:[25,3,0]}]),parsed=parseNavigation(result.data);
  assert.deepEqual(result.mapping,[2,0,1,3]);assert.deepEqual(parsed.points.map(p=>p.position),[[10,0,0],[20,0,0],[25,3,0],[30,0,0]]);assert.ok(parsed.points.every(p=>p.id===99));
  assert.deepEqual(parsed.points.map(p=>p.links.map(l=>l.target)),[[2,1],[3,2],[0],[1]]);
  assert.equal(distance(result.data,parsed.points[0],0),Math.fround(Math.sqrt(234)));assert.equal(distance(result.data,parsed.points[2],0),Math.fround(Math.sqrt(234)));assert.equal(distance(result.data,parsed.points[1],1),Math.fround(Math.sqrt(34)));
  for(const point of original.points){const next=parsed.points[result.mapping[point.index]];assert.deepEqual(result.data.subarray(8+next.index*30+12,8+(next.index+1)*30),source.subarray(8+point.index*30+12,8+(point.index+1)*30));
    for(let i=0;i<point.links.length;i++){const link=point.links[i];assert.equal(next.links[i].type,link.type);if(point.index!==0&&link.target!==0)assert.deepEqual(result.data.subarray(128+next.links[i].index*8+4,136+next.links[i].index*8),source.subarray(128+link.index*8+4,136+link.index*8));}
  }
  assert.deepEqual(source,navigation());
});
test('no-op and descriptor edits preserve legacy costs; retargeting mirrors distance on the surviving reverse edge',()=>{
  const source=navigation();assert.deepEqual(prepareNavigationEdits(source,[]).data,source);assert.deepEqual(prepareNavigationEdits(source,[{id:'points/0/position',value:[0,0,0]}]).data,source);
  const descriptor=prepareNavigationEdits(source,[{id:'points/0/areaSize',value:80}]);assert.deepEqual(descriptor.mapping,[0,1,2,3]);assert.deepEqual(descriptor.data.subarray(128),source.subarray(128));
  const target=prepareNavigationEdits(source,[{id:'links/0/target',value:2}]),parsed=parseNavigation(target.data);assert.deepEqual(target.mapping,[0,1,2,3]);assert.equal(distance(target.data,parsed.points[0],0),20);assert.equal(distance(target.data,parsed.points[2],1),20);assert.deepEqual(target.data.subarray(136,144),source.subarray(136,144));
  const multiple=prepareNavigationEdits(source,[{id:'points/0/position',value:[25,0,0]},{id:'points/3/position',value:[-5,0,0]}]);assert.deepEqual(multiple.mapping,[3,1,2,0]);
  const sameX=prepareNavigationEdits(source,[{id:'points/0/position',value:[10,0,0]}]);assert.deepEqual(sameX.mapping,[0,1,2,3]);assert.equal(distance(sameX.data,parseNavigation(sameX.data).points[0],0),0);
});
test('distance computation handles tiny paths and refuses nonfinite traversal costs before saving',()=>{
  const source=navigation();assert.throws(()=>prepareNavigationEdits(source,[{id:'points/0/position',value:[3e38,3e38,3e38]}]),/vzdálenost/);
  const tiny=prepareNavigationEdits(source,[{id:'points/0/position',value:[9.99999,0,0]}]);assert.equal(distance(tiny.data,parseNavigation(tiny.data).points[0],0),0);
  const disconnected=changeNavigationConnection(source,{action:'disconnect',from:0,to:1}),moved=prepareNavigationEdits(disconnected,[{id:'points/0/position',value:[9.99999,0,0]}]);
  const added=changeNavigationConnection(moved.data,{action:'connect',from:0,to:1});assert.equal(distance(added,parseNavigation(added).points[0],0),0);
});
async function project(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'mafia-nav-move-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const assets=[];
  for(const [name,data] of [['missions/TEST/check.bin',navigation()],['missions/TEST/clusters.seg',segments()]]){const asset={path:name,original:'originals/a1/'+name,sha256:hash(data),archive:'a1.dta',size:data.length,variants:[{}]};assets.push(asset);await writeSafe(root,asset.original,data);}
  await writeSafe(root,'workbench.json',JSON.stringify({format:'mafia-workbench',version:1,name:'Movement',assets,history:[]}));return {root,p:await ModProject.open(root),nav:assets[0].path,seg:assets[1].path};
}
test('project movement remaps segments in one generation and returns the selected point mapping, with exact undo and playtest synchronization',async t=>{
  const {root,p,nav,seg}=await project(t),source=navigation(),oldSegments=segments(),game=path.join(root,'game');await fs.mkdir(game);let sync=await synchronizeAssets(p,game);
  const mapping=await p.saveNavigation(nav,[{id:'points/0/position',value:[25,3,0]}],hash(source));assert.deepEqual(mapping,[2,0,1,3]);assert.equal(p.manifest.history.length,1);assert.equal(p.manifest.history[0].files.length,2);
  const fresh=await ModProject.open(root),after=await fresh.read(nav),changedSegments=await fresh.read(seg);assert.deepEqual(parseSegments(changedSegments,4).records[0].nodes,[1,2]);assert.deepEqual(changedSegments.subarray(52),oldSegments.subarray(52));
  sync=await synchronizeAssets(fresh,game,sync.files);assert.equal(sync.copied,2);await fresh.export(path.join(root,'export'));for(const name of [nav,seg])assert.deepEqual(await fs.readFile(path.join(root,'export',name)),await fresh.read(name));
  await assert.rejects(fresh.saveNavigation(nav,[{id:'points/2/position',value:[0,0,0]}],hash(source)),/změnil/);assert.deepEqual(await fresh.read(nav),after);
  await fresh.undo();assert.deepEqual(await fresh.read(nav),source);assert.deepEqual(await fresh.read(seg),oldSegments);await synchronizeAssets(fresh,game,sync.files);assert.deepEqual(await fs.readFile(path.join(game,nav)),source);assert.deepEqual(await fs.readFile(path.join(game,seg)),oldSegments);
});
test('movement refuses damaged segment data before changing the network and rolls back both files on publication failure',async t=>{
  const {root,p,nav,seg}=await project(t),source=navigation(),changes=[{id:'points/0/position',value:[25,3,0]}];await writeSafe(root,'mods/'+seg,Buffer.from('broken'));
  await assert.rejects(p.saveNavigation(nav,changes,hash(source)),/Segments/);assert.deepEqual(await p.read(nav),source);assert.equal(p.manifest.history.length,0);await writeSafe(root,'mods/'+seg,segments());
  p.saveManifest=async()=>{const fresh=await ModProject.open(root);assert.deepEqual(await fresh.read(nav),source);assert.deepEqual(await fresh.read(seg),segments());throw new Error('publication failure');};
  await assert.rejects(p.saveNavigation(nav,changes,hash(source)),/publication failure/);assert.deepEqual(await p.read(nav),source);assert.deepEqual(await p.read(seg),segments());assert.equal(p.manifest.history.length,0);
});
