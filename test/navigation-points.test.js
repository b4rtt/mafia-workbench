import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {changeNavigationPoint,parseNavigation} from '../src/core/navigation.js';
import {parseSegments,remapSegments} from '../src/core/segments.js';
import {ModProject} from '../src/core/project.js';
import {synchronizeAssets} from '../src/core/playtest.js';
import {hash,writeSafe} from '../src/core/files.js';

function navigation(){
  const bytes=Buffer.alloc(8+3*30+3*8,0xab);bytes.writeUInt32LE(0x01abcedf);bytes.writeUInt32LE(3,4);
  for(let i=0;i<3;i++){const offset=8+i*30;[i*10,2,i*20].forEach((n,j)=>bytes.writeFloatLE(n,offset+j*4));bytes.writeUInt16LE(1,offset+12);bytes.writeUInt16LE(99,offset+14);bytes.writeUInt16LE(50,offset+16);bytes[offset+28]=bytes[offset+29]=1;bytes.writeUInt16LE((i+1)%3,98+i*8);bytes.writeUInt16LE(0x81,100+i*8);bytes.writeUInt32LE(0x7fc00055,102+i*8);}
  return bytes;
}
function segments(){
  const head=Buffer.alloc(20),record=Buffer.alloc(24+3*4+40+56,0xac);head.write('AISEG-V1.1-JIPO');head.writeUInt32LE(1,16);
  record.writeUInt32LE(0x10000011);record.writeUInt32LE(3,20);[0,1,2].forEach((n,i)=>record.writeUInt32LE(n,24+i*4));return Buffer.concat([head,record]);
}
async function project(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'mafia-nav-points-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const files=[['missions/TEST/check.bin',navigation()],['missions/TEST/clusters.seg',segments()]],assets=[];
  for(const [name,bytes] of files){const asset={path:name,original:'originals/a1/'+name,sha256:hash(bytes),archive:'a1.dta',size:bytes.length,variants:[{}]};assets.push(asset);await writeSafe(root,asset.original,bytes);}
  await writeSafe(root,'workbench.json',JSON.stringify({format:'mafia-workbench',version:1,name:'Navigation points',assets,history:[]}));return {p:await ModProject.open(root),root,nav:files[0][0],seg:files[1][0]};
}
test('navigation inserts sorted points with constructor defaults and remaps targets while preserving raw records',()=>{
  const source=navigation(),added=changeNavigationPoint(source,{action:'add',position:[15,3,7],type:2}),parsed=parseNavigation(added.data);
  assert.equal(added.index,2);assert.deepEqual(added.mapping,[0,1,3]);assert.equal(parsed.points.length,4);assert.deepEqual(parsed.points[2].position,[15,3,7]);assert.equal(parsed.points[2].type,2);assert.equal(parsed.points[2].areaSize,50);assert.equal(parsed.points[2].id,0);assert.equal(parsed.points[2].links.length,0);
  assert.deepEqual(parsed.points.map(p=>p.links.map(l=>l.target)),[[1],[3],[],[0]]);
  for(const [old,next] of added.mapping.entries())assert.deepEqual(added.data.subarray(8+next*30,38+next*30),source.subarray(8+old*30,38+old*30));
  for(let i=0;i<3;i++)assert.deepEqual(added.data.subarray(130+i*8,136+i*8),source.subarray(100+i*8,106+i*8));
  assert.deepEqual(changeNavigationPoint(added.data,{action:'delete',index:2}).data,source);
  const first=changeNavigationPoint(source,{action:'add',position:[-10,0,0]}),last=changeNavigationPoint(source,{action:'add',position:[20,0,0]});assert.equal(first.index,0);assert.equal(last.index,3);
  const empty=Buffer.alloc(8);empty.writeUInt32LE(0x01abcedf);const only=changeNavigationPoint(empty,{action:'add',position:[0,0,0]});assert.equal(only.index,0);assert.deepEqual(changeNavigationPoint(only.data,{action:'delete',index:0}).data,empty);
});
test('navigation deletes incident connections and rebases surviving indices without touching other fields',()=>{
  const source=navigation(),deleted=changeNavigationPoint(source,{action:'delete',index:1}),parsed=parseNavigation(deleted.data);assert.deepEqual(deleted.mapping,[0,-1,1]);assert.equal(parsed.linkCount,1);assert.equal(parsed.points[0].links.length,0);assert.equal(parsed.points[1].links[0].target,0);
  assert.deepEqual(deleted.data.subarray(8,36),source.subarray(8,36));assert.deepEqual(deleted.data.subarray(38,68),source.subarray(68,98));assert.deepEqual(deleted.data.subarray(68),source.subarray(114));
  for(const request of [{action:'other'},{action:'delete',index:3},{action:'delete',index:0.5},{action:'add',position:[NaN,0,0]},{action:'add',position:[1e50,0,0]},{action:'add',position:[0,0,0],type:-1}])assert.throws(()=>changeNavigationPoint(source,request));
  const unsorted=Buffer.from(source);unsorted.writeFloatLE(-1,38);assert.throws(()=>changeNavigationPoint(unsorted,{action:'delete',index:0}),/seřazené/);
});
test('segment remapping retains geometry bytes, removes deleted references and preserves ignored legacy files',()=>{
  const source=segments(),parsed=parseSegments(source,3);assert.equal(parsed.active,true);assert.deepEqual(parsed.records[0].nodes,[0,1,2]);assert.deepEqual(remapSegments(source,[0,1,2],3),source);
  const moved=remapSegments(source,[2,-1,0],3);assert.deepEqual(parseSegments(moved,3).records[0].nodes,[0,2]);assert.deepEqual(moved.subarray(52),source.subarray(56));assert.deepEqual(moved.subarray(0,40),source.subarray(0,40));
  const legacy=Buffer.from(source);legacy.write('AISEG-V1.0-JIPO');assert.equal(parseSegments(legacy,3).active,false);assert.deepEqual(remapSegments(legacy,[0,-1,1],2),legacy);
  const dangling=Buffer.from(source);dangling.writeUInt32LE(3,52);assert.throws(()=>parseSegments(dangling,3),/odkazy/);
  const badType=Buffer.from(source);badType.writeUInt32LE(0x10000031,20);assert.throws(()=>parseSegments(badType,3),/typ/);
  assert.throws(()=>parseSegments(source.subarray(0,-1),3),/geometrie/);assert.throws(()=>parseSegments(Buffer.concat([source,Buffer.from([0])]),3),/za záznamy/);
  for(const mapping of [[0,0,1],[0,1,3],[0,-2,1]])assert.throws(()=>remapSegments(source,mapping,3),/přemapování/);
});
test('point creation and deletion publish paired check/segment edits, reopen, export and undo exactly',async t=>{
  const {p,root,nav,seg}=await project(t),source=navigation(),originalSegments=segments();
  const game=path.join(root,'game');await fs.mkdir(game);let sync=await synchronizeAssets(p,game);
  await assert.rejects(p.changeNavigationPoint(nav,{action:'add',position:[15,3,7]},'0'.repeat(64)),/změnil/);
  const index=await p.changeNavigationPoint(nav,{action:'add',position:[15,3,7]},hash(source));assert.equal(index,2);assert.equal(p.manifest.history.length,1);assert.equal(p.manifest.history[0].kind,'batch');assert.equal(p.manifest.history[0].files.length,2);
  assert.equal(p.manifest.version,2);
  const fresh=await ModProject.open(root);assert.deepEqual(parseSegments(await fresh.read(seg),4).records[0].nodes,[0,1,3]);assert.ok((await fresh.list()).assets.every(a=>a.modified));
  sync=await synchronizeAssets(fresh,game,sync.files);assert.equal(sync.copied,2);for(const name of [nav,seg])assert.deepEqual(await fs.readFile(path.join(game,name)),await fresh.read(name));
  await fs.unlink(path.join(game,nav));sync=await synchronizeAssets(fresh,game,sync.files);assert.equal(sync.copied,1);assert.deepEqual(await fs.readFile(path.join(game,nav)),await fresh.read(nav));assert.equal((await fs.stat(path.join(game,nav))).nlink,1);
  await fresh.export(path.join(root,'export'));for(const name of [nav,seg])assert.deepEqual(await fs.readFile(path.join(root,'export',name)),await fresh.read(name));
  const added=await fresh.read(nav),shifted=await fresh.read(seg);await fresh.changeNavigationPoint(nav,{action:'delete',index:2},hash(added));assert.deepEqual(await fresh.read(nav),source);assert.deepEqual(await fresh.read(seg),originalSegments);
  await fresh.undo();assert.deepEqual(await fresh.read(nav),added);assert.deepEqual(await fresh.read(seg),shifted);await fresh.undo();assert.deepEqual(await fresh.read(nav),source);assert.deepEqual(await fresh.read(seg),originalSegments);assert.ok((await fresh.list()).assets.every(a=>!a.modified));
  await synchronizeAssets(fresh,game,sync.files);assert.deepEqual(await fs.readFile(path.join(game,nav)),source);assert.deepEqual(await fs.readFile(path.join(game,seg)),originalSegments);
  for(const asset of fresh.manifest.assets)assert.equal(hash(await fs.readFile(path.join(root,asset.original))),asset.sha256);
});
test('failed staged writes or manifest publication leave both files at the prior generation, including undo',async t=>{
  const {p,root,nav,seg}=await project(t),source=navigation(),originalSegments=segments(),add={action:'add',position:[15,3,7]},link=fs.link;
  fs.link=async(...args)=>{if(args[1].includes('/mods/batches/')&&args[1].endsWith('/clusters.seg'))throw new Error('staging failure');return link(...args);};
  try{await assert.rejects(p.changeNavigationPoint(nav,add,hash(source)),/staging failure/);}finally{fs.link=link;}
  assert.deepEqual(await p.read(nav),source);assert.deepEqual(await p.read(seg),originalSegments);assert.equal((await ModProject.open(root)).manifest.history.length,0);
  const save=p.saveManifest;p.saveManifest=async()=>{const fresh=await ModProject.open(root);assert.deepEqual(await fresh.read(nav),source);assert.deepEqual(await fresh.read(seg),originalSegments);throw new Error('manifest failure');};
  await assert.rejects(p.changeNavigationPoint(nav,add,hash(source)),/manifest failure/);assert.deepEqual(await p.read(nav),source);assert.equal(p.manifest.history.length,0);assert.equal(p.manifest.version,1);
  p.saveManifest=save;await p.changeNavigationPoint(nav,add,hash(source));const after=await p.read(nav),segAfter=await p.read(seg);
  p.saveManifest=async()=>{const fresh=await ModProject.open(root);assert.deepEqual(await fresh.read(nav),after);assert.deepEqual(await fresh.read(seg),segAfter);throw new Error('undo failure');};
  await assert.rejects(p.undo(),/undo failure/);assert.deepEqual(await p.read(nav),after);assert.deepEqual(await p.read(seg),segAfter);assert.equal(p.manifest.history.length,1);p.saveManifest=save;
  await writeSafe(root,p.asset(seg).overlay,Buffer.from('foreign edit'));await assert.rejects(p.undo(),/neodpovídá/);assert.deepEqual(await p.read(nav),after);
  await writeSafe(root,p.asset(seg).overlay,segAfter);await p.undo();assert.deepEqual(await p.read(nav),source);assert.deepEqual(await p.read(seg),originalSegments);
});
test('legacy single-file history and later property edits remain compatible with staged layers',async t=>{
  const {p,root,nav,seg}=await project(t),source=navigation();await p.saveNavigation(nav,[{id:'points/0/id',value:77}],hash(source));const old=await p.read(nav);
  await p.changeNavigationPoint(nav,{action:'add',position:[15,3,7]},hash(old));const added=await p.read(nav);await p.saveNavigation(nav,[{id:'points/0/id',value:42}],hash(added));
  const fresh=await ModProject.open(root);assert.equal(parseNavigation(await fresh.read(nav)).points[0].id,42);await fresh.undo();assert.deepEqual(await fresh.read(nav),added);await fresh.undo();assert.deepEqual(await fresh.read(nav),old);await fresh.undo();assert.deepEqual(await fresh.read(nav),source);assert.deepEqual(await fresh.read(seg),segments());assert.equal(await fresh.export(path.join(root,'export')),0);
  fresh.manifest.version=1;await fresh.saveManifest();await assert.rejects(ModProject.open(root),/formát projektu 2/);fresh.manifest.version=2;
  const asset=fresh.asset(nav);asset.overlay='mods/batches/bad/'+seg;await fresh.saveManifest();await assert.rejects(ModProject.open(root),/vrstva/);
});
test('point changes refuse corrupt companion data and support absent or inactive segment files',async t=>{
  const {p,root,nav,seg}=await project(t),source=navigation(),request={action:'add',position:[15,3,7]};
  await writeSafe(root,'mods/'+seg,Buffer.from('corrupt'));await assert.rejects(p.changeNavigationPoint(nav,request,hash(source)),/Segments/);assert.deepEqual(await p.read(nav),source);assert.equal(p.manifest.history.length,0);
  const legacy=segments();legacy.write('AISEG-V1.0-JIPO');await writeSafe(root,'mods/'+seg,legacy);await p.changeNavigationPoint(nav,request,hash(source));assert.equal(p.manifest.history[0].files.length,1);assert.deepEqual(await p.read(seg),legacy);await p.undo();assert.deepEqual(await p.read(nav),source);
  p.manifest.assets=p.manifest.assets.filter(a=>a.path!==seg);await p.saveManifest();const fresh=await ModProject.open(root);await fresh.changeNavigationPoint(nav,request,hash(source));assert.equal(fresh.manifest.history.at(-1).files.length,1);await fresh.undo();assert.deepEqual(await fresh.read(nav),source);
});
test('undo of a newly created mission remains safe after staged edits and refuses hidden foreign overlays',async t=>{
  const {p,root}=await project(t),name='missions/NEW/check.bin',source=navigation();await p.createFiles([{path:name,data:source}]);
  await p.changeNavigationPoint(name,{action:'add',position:[15,3,7]},hash(source));await p.undo();assert.deepEqual(await p.read(name),source);
  await writeSafe(root,'mods/'+name,Buffer.from('foreign shadow'));await assert.rejects(p.undo(),/skryté vrstvě/);assert.ok(p.asset(name));
  await writeSafe(root,'mods/'+name,source);await p.undo();assert.throws(()=>p.asset(name),/není v projektu/);assert.equal(p.manifest.history.length,0);assert.equal((await ModProject.open(root)).manifest.assets.length,2);
});
