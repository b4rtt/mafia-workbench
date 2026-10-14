import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {appendSector} from '../src/core/sector-create.js';
import {editSectorGeometry} from '../src/core/sector-geometry.js';
import {parseFourDs,editFourDs} from '../src/core/fourds.js';
import {inspectSectorLinks,linkSectorPortal,changeSectorPortalPair} from '../src/core/sector-link.js';
import {sectorLinkPlan,sectorWorldPoints} from '../src/shared/sector-link.js';
import {ModProject} from '../src/core/project.js';
import {hash,writeSafe} from '../src/core/files.js';
const portal=[5,-2,-2,5,-2,2,5,2,2,5,2,-2],select={mesh:1,portal:0,target:2};
const scene=()=>{const b=Buffer.alloc(6);b.writeUInt16LE(0x4c53);b.writeUInt32LE(6,2);return b;};
function geometry(){const h=Buffer.alloc(19);h.write('4DS\0');h.writeUInt16LE(29,4);h[18]=0x61;let bytes=appendSector(appendSector(h,{name:'A',center:[0,0,0],size:[10,10,10]}),{name:'B',center:[10,0,0],size:[10,10,10]});bytes=editSectorGeometry(bytes,{mesh:1,sector:{portals:[{positions:portal}]}});bytes=linkSectorPortal(bytes,scene(),select);return appendSector(bytes,{name:'C',center:[30,0,0],size:[2,2,2]});}
const corners=p=>Array.from({length:p.length/3},(_,i)=>p.slice(i*3,i*3+3).map(v=>Math.round(v*1e4)).join(',')).sort();
const shrink=p=>p.map((v,i)=>i%3===0?v:v*.5);
const raw=(bytes,p)=>bytes.subarray(p.offset,p.endOffset);
test('paired update preserves each raw header, unrelated frames, world opening and exact no-op',()=>{
 const before=geometry(),old=parseFourDs(before,true);for(let i=0;i<2;i++){const p=old.meshes[i].sector.portals[0];before.writeUInt32LE(0x80000004+i,p.offset+1);before.writeUInt32LE(0x7fc00009+i,p.offset+5);before.writeFloatLE(-0,p.offset+9);}
 const positions=shrink(portal),after=changeSectorPortalPair(before,scene(),{...select,kind:'update',positions}),result=parseFourDs(after,true),ctx=inspectSectorLinks(after,scene(),1);assert.equal(sectorLinkPlan(ctx,select).already,true);
 for(let i=0;i<2;i++){const a=old.meshes[i].sector.portals[0],b=result.meshes[i].sector.portals[0];assert.deepEqual(after.subarray(b.offset+1,b.planeOffset),before.subarray(a.offset+1,a.planeOffset));assert.deepEqual(result.meshes[i].sector.positions,old.meshes[i].sector.positions);}
 assert.deepEqual(corners(result.meshes[0].sector.portals[0].positions),corners(result.meshes[1].sector.portals[0].positions));assert.deepEqual(after.subarray(result.meshes[1].sector.endOffset),before.subarray(old.meshes[1].sector.endOffset));assert.equal(after.at(-1),0x61);
 assert.deepEqual(changeSectorPortalPair(after,scene(),{...select,kind:'update',positions}),after);assert.deepEqual(changeSectorPortalPair(before,scene(),{...select,kind:'update',positions:portal}),before);
});
test('vertex insertion updates both records and removal deletes only the selected pair',()=>{
 let before=geometry();const extra=[5,3,-1,5,3,1,5,4,1,5,4,-1];before=editSectorGeometry(before,{mesh:1,sector:{portals:[{positions:extra},{source:0}]}});const pair={...select,portal:1};before=linkSectorPortal(before,scene(),{...select,portal:0});const old=parseFourDs(before,true),five=[...portal.slice(0,3),5,-2,0,...portal.slice(3)],after=changeSectorPortalPair(before,scene(),{...pair,kind:'update',positions:five}),result=parseFourDs(after,true);assert.equal(result.meshes[0].sector.portals[1].positions.length,15);assert.equal(result.meshes[1].sector.portals[0].positions.length,15);
 for(const [mesh,index]of [[0,0],[1,1]])assert.deepEqual(raw(after,result.meshes[mesh].sector.portals[index]),raw(before,old.meshes[mesh].sector.portals[index]));
 const removed=changeSectorPortalPair(after,scene(),{...pair,kind:'remove'}),end=parseFourDs(removed,true);assert.equal(end.meshes[0].sector.portals.length,1);assert.equal(end.meshes[1].sector.portals.length,1);assert.deepEqual(raw(removed,end.meshes[0].sector.portals[0]),raw(before,old.meshes[0].sector.portals[0]));assert.deepEqual(raw(removed,end.meshes[1].sector.portals[0]),raw(before,old.meshes[1].sector.portals[1]));
});
test('paired edits map through hierarchy and rotated scaled target while preserving opposite world winding',()=>{
 let bytes=geometry();const g=parseFourDs(bytes,true),b=g.meshes[1].sector;bytes=editSectorGeometry(bytes,{mesh:2,sector:{positions:b.positions.map((v,i)=>i%3===0?v-10:v),portals:[{source:0,positions:b.portals[0].positions.map((v,i)=>i%3===0?v-10:v)}]}});bytes=editFourDs(bytes,[{id:'meshes/1/position',value:[10,0,0]}]);
 // Apply the same ancestor to both sectors, so their common boundary survives.
 bytes=editFourDs(bytes,[{id:'meshes/0/parent',value:3},{id:'meshes/1/parent',value:3},{id:'meshes/2/position',value:[20,7,-30]},{id:'meshes/2/rotation',value:[Math.SQRT1_2,0,Math.SQRT1_2,0]},{id:'meshes/2/scale',value:[2,1,3]}]);
 const after=changeSectorPortalPair(bytes,scene(),{...select,kind:'update',positions:shrink(portal)}),ctx=inspectSectorLinks(after,scene(),1);assert.equal(sectorLinkPlan(ctx,select).already,true);const a=ctx.sectors[0],target=ctx.sectors[1];assert.deepEqual(corners(sectorWorldPoints(a.sector.portals[0].positions,a.worldMatrix)),corners(sectorWorldPoints(target.sector.portals[0].positions,target.worldMatrix)));
});
test('pair mutation refuses absent, ambiguous, reversed, off-boundary and overlapping openings without writes',()=>{
 const before=geometry();for(const request of [{...select,kind:'bad'},{...select,kind:'remove',positions:portal},{...select,kind:'update',positions:[]},{...select,kind:'remove',portal:3},{...select,kind:'remove',target:3},{...select,kind:'update',positions:portal,extra:true},{...select,kind:'update',positions:portal.map((v,i)=>i%3===0?v+1:v)},{...select,kind:'update',positions:Array.from({length:4},(_,i)=>portal.slice(i*3,i*3+3)).reverse().flat()}])assert.throws(()=>changeSectorPortalPair(before,scene(),request));
 const duplicate=editSectorGeometry(before,{mesh:2,sector:{portals:[{source:0},{source:0}]}});assert.throws(()=>changeSectorPortalPair(duplicate,scene(),{...select,kind:'remove'}),/nejednoznačné/);
 const extra=[5,3,-1,5,3,1,5,4,1,5,4,-1],withExtra=editSectorGeometry(before,{mesh:1,sector:{portals:[{source:0},{positions:extra}]}});assert.throws(()=>changeSectorPortalPair(withExtra,scene(),{...select,kind:'update',positions:portal.map((v,i)=>i%3===1?v*2:v)}),/překrývá/);assert.deepEqual(before,geometry());
});
test('project updates and removes a pair atomically with stale guards, no-op, exact export/reopen/undo',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'mafia-sector-pair-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));await writeSafe(root,'workbench.json',JSON.stringify({format:'mafia-workbench',version:2,name:'Pair',assets:[],history:[]}));const p=await ModProject.open(root),name='missions/Test/scene.4ds',other='missions/Test/scene2.bin';await p.createFiles([{path:name,data:geometry()},{path:other,data:scene()},{path:'missions/Test/tree.klz',data:Buffer.from('protected')}]);const before=await p.read(name),ctx=await p.sectorLinkContext(name,1),history=structuredClone(p.manifest.history),request={...select,kind:'update',positions:shrink(portal)};
 await assert.rejects(()=>p.changeSectorPortalPair(name,request,'stale',ctx.sceneHash),/změnila/);await assert.rejects(()=>p.changeSectorPortalPair(name,request,ctx.sha256,'stale'),/změnila/);await p.changeSectorPortalPair(name,request,ctx.sha256,ctx.sceneHash);const updated=await p.read(name);assert.equal(p.manifest.history.length,history.length+1);assert.equal(p.manifest.history.at(-1).files.length,1);let now=await p.sectorLinkContext(name,1);await p.changeSectorPortalPair(name,request,now.sha256,now.sceneHash);assert.equal(p.manifest.history.length,history.length+1);
 await p.changeSectorPortalPair(name,{...select,kind:'remove'},now.sha256,now.sceneHash);assert.equal(parseFourDs(await p.read(name),true).meshes[0].sector.portals.length,0);await p.export(root+'/export');assert.deepEqual(await fs.readFile(path.join(root,'export',name)),await p.read(name));const reopened=await ModProject.open(root);await reopened.undo();assert.deepEqual(await reopened.read(name),updated);await reopened.undo();assert.deepEqual(await reopened.read(name),before);assert.deepEqual(reopened.manifest.history,history);assert.equal(hash(await reopened.read(other)),ctx.sceneHash);assert.equal((await reopened.read('missions/Test/tree.klz')).toString(),'protected');
});
test('pair publication failure and concurrent scene change preserve both old sides and independent edits',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'mafia-sector-pair-rollback-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));await writeSafe(root,'workbench.json',JSON.stringify({format:'mafia-workbench',version:2,name:'Rollback',assets:[],history:[]}));const p=await ModProject.open(root),name='missions/Test/scene.4ds',other='missions/Test/scene2.bin';await p.createFiles([{path:name,data:geometry()},{path:other,data:scene()}]);const before=await p.read(name),ctx=await p.sectorLinkContext(name,1),history=structuredClone(p.manifest.history),publish=p.saveManifest;
 p.saveManifest=async()=>{throw Error('Publication failed');};await assert.rejects(()=>p.changeSectorPortalPair(name,{...select,kind:'remove'},ctx.sha256,ctx.sceneHash),/Publication failed/);p.saveManifest=publish;assert.deepEqual(await p.read(name),before);assert.deepEqual(p.manifest.history,history);assert.deepEqual((await ModProject.open(root)).manifest.history,history);
 const batch=p.changeBatch,edited=Buffer.from(scene());edited.writeUInt16LE(0x1234);p.changeBatch=async function(files,...args){await this.change(other,edited,'Independent scene edit');return batch.call(this,files,...args);};await assert.rejects(()=>p.changeSectorPortalPair(name,{...select,kind:'update',positions:shrink(portal)},ctx.sha256,ctx.sceneHash),/změnil/);p.changeBatch=batch;assert.deepEqual(await p.read(name),before);assert.deepEqual(await p.read(other),edited);await p.undo();assert.deepEqual(p.manifest.history,history);
});
