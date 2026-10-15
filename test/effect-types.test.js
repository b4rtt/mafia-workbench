import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import iconv from 'iconv-lite';
import {parseEffectDefinitions,editEffectDefinitions,changeEffectDefinition} from '../src/core/effect-types.js';
import {parseEffectTypes} from '../src/core/effects.js';
import {ModProject} from '../src/core/project.js';
import {writeSafe,hash} from '../src/core/files.js';

const chunk=(type,payload)=>{const header=Buffer.alloc(6);header.writeUInt16LE(type);header.writeUInt32LE(payload.length+6,2);return Buffer.concat([header,payload]);};
const text=(type,value)=>chunk(type,Buffer.concat([iconv.encode(value,'windows-1250'),Buffer.from([0,0xde,0xad])]));
const floats=values=>{const bytes=Buffer.alloc(values.length*4);values.forEach((value,index)=>bytes.writeFloatLE(value,index*4));return bytes;};
function fixture({reversed=false,opaque=false,invalid=false}={}){
  const phase=floats([0,1,0,0,0,0,1,2,3,0,0,8,9,0.5,0.1,2,0.2,0]);phase.writeInt32LE(250,36);phase.writeInt32LE(20,40);phase.writeUInt32LE(0xabcd0011,68);
  if(invalid)phase.writeUInt32LE(0x7fc01234,0);
  const phasePair=chunk(108,floats([4,5,6,0.3,0.4,0.5])),phaseCore=chunk(opaque?999:106,Buffer.concat([phase,Buffer.from('phase-suffix')]));
  const emitter=floats([-0,1,2,0.1,0.2,0.3,4,0.2,10,11,0.8,0.1,200,50,0,0,0,0,2,0]);emitter.writeUInt32LE(0xface001d,76);
  const burst=Buffer.alloc(4);burst.writeInt32LE(12);
  const e=chunk(101,Buffer.concat([text(103,'Kouř'),text(105,'Mesh'),chunk(106,Buffer.concat([emitter,Buffer.from('emitter-suffix')])),chunk(107,floats([0,1,0,0.1,0.1,0.1])),chunk(108,floats([1,2,3,0.2,0.3,0.4])),chunk(109,burst),chunk(102,Buffer.concat([text(103,'Fáze'),...(reversed?[phasePair,phaseCore]:[phaseCore,phasePair]),chunk(107,floats([9.8]))]))]));
  return chunk(100,Buffer.concat([text(103,'Kouřový efekt'),text(104,'particle.I3D'),chunk(106,Buffer.concat([floats([0,0,0,1,0,0]),Buffer.from('type-suffix')])),chunk(110,Buffer.from([1,0,0xca,0xfe])),e]));
}
const entry=(node,key)=>node.entries.find(entry=>entry.key===key);

test('definitions expose native effect IDs, nested emitters/phases and typed integer lifetimes, bursts and flags',()=>{
  const bytes=fixture(),parsed=parseEffectDefinitions(bytes),type=parsed.records[0],emitter=type.children[0],phase=emitter.children[0];
  assert.equal(type.index,0);assert.equal(type.name,'Kouřový efekt');assert.equal(emitter.name,'Kouř');assert.equal(phase.name,'Fáze');
  assert.equal(entry(emitter,'burst').kind,'int');assert.equal(entry(emitter,'burst').value,12);assert.equal(entry(phase,'duration').value,250);assert.equal(entry(phase,'flags').value,0xabcd0011);assert.equal(entry(emitter,'flags').value,0xface001d);
  assert.deepEqual(entry(phase,'scale').value,[4,5,6]);assert.equal(Object.is(entry(emitter,'position').value[0],-0),true);
  assert.deepEqual(editEffectDefinitions(bytes,parsed.entries.map(({id,value})=>({id,value}))),bytes);
  assert.equal(parseEffectTypes(bytes).items[0].emitters,1);
});

test('effective vector edits respect chunk ordering, shadowed scalar bytes and unknown suffixes',()=>{
  for(const reversed of [false,true]){
    const bytes=fixture({reversed}),phase=parseEffectDefinitions(bytes).records[0].children[0].children[0],scale=entry(phase,'scale');
    assert.deepEqual(scale.value,reversed?[8,5,6]:[4,5,6]);
    const result=editEffectDefinitions(bytes,[{id:scale.id,value:[21,22,23]}]),expected=Buffer.from(bytes);scale.offsets.forEach((offset,i)=>expected.writeFloatLE(21+i,offset));
    assert.deepEqual(result,expected);assert.deepEqual(entry(parseEffectDefinitions(result).records[0].children[0].children[0],'scale').value,[21,22,23]);
    assert.deepEqual(editEffectDefinitions(result,[{id:scale.id,value:scale.value}]),bytes);
  }
});

test('Windows-1250 renames resize all ancestors and retain opaque suffixes and sibling definitions',()=>{
  const bytes=Buffer.concat([fixture(),fixture()]),type=parseEffectDefinitions(bytes).records[0],emitter=type.children[0],phase=emitter.children[0];
  const changes=[{id:entry(type,'name').id,value:'Žlutý kouř s dlouhým názvem'},{id:entry(emitter,'name').id,value:'Krátký'},{id:entry(phase,'name').id,value:''}];
  const result=editEffectDefinitions(bytes,changes),revised=parseEffectDefinitions(result).records[0];assert.equal(revised.name,changes[0].value);assert.equal(revised.children[0].name,'Krátký');assert.equal(revised.children[0].children[0].name,'');assert.deepEqual(result.subarray(-fixture().length),fixture());
  for(const suffix of ['type-suffix','emitter-suffix','phase-suffix'])assert.ok(result.includes(Buffer.from(suffix)));
  assert.deepEqual(editEffectDefinitions(result,changes.map(change=>({id:change.id,value:parseEffectDefinitions(bytes).entries.find(entry=>entry.id===change.id).value}))),bytes);
});

test('foreign fallback blocks and NaN payloads are preserved and never offered as writable numbers',()=>{
  for(const options of [{opaque:true},{invalid:true}]){
    const bytes=fixture(options),parsed=parseEffectDefinitions(bytes),phase=parsed.records[0].children[0].children[0],direction=entry(phase,'direction');assert.equal(direction.readOnly,true);
    assert.deepEqual(editEffectDefinitions(bytes,[]),bytes);assert.throws(()=>editEffectDefinitions(bytes,[{id:direction.id,value:[1,2,3]}]),/pouze ke čtení/);
    const duration=entry(phase,'duration');if(options.opaque){assert.ok(phase.warnings.length);assert.equal(duration.readOnly,true);}else{const changed=editEffectDefinitions(bytes,[{id:duration.id,value:300}]);assert.equal(changed.readUInt32LE(direction.offsets[0]),0x7fc01234);}
  }
  const bytes=fixture(),flag=parseEffectDefinitions(bytes).records[0].entries.find(entry=>entry.key==='rotateDirection');bytes[flag.offsets[0]]=2;assert.equal(parseEffectDefinitions(bytes).entries.find(entry=>entry.id===flag.id).readOnly,true);assert.deepEqual(editEffectDefinitions(bytes,[]),bytes);
});

test('malformed layouts, readonly references, duplicate IDs and invalid values are rejected before publication',()=>{
  const bytes=fixture(),parsed=parseEffectDefinitions(bytes),phase=parsed.records[0].children[0].children[0],emitter=parsed.records[0].children[0];
  for(const source of [Buffer.alloc(1),chunk(100,Buffer.from([1])),chunk(100,chunk(106,Buffer.alloc(23))),chunk(100,chunk(101,chunk(106,Buffer.alloc(79)))),chunk(100,chunk(101,chunk(102,chunk(106,Buffer.alloc(71)))))])assert.throws(()=>parseEffectDefinitions(source),/Definice efektů/);
  for(const value of [0,-1,1.5,2**31,NaN,'100'])assert.throws(()=>editEffectDefinitions(bytes,[{id:entry(phase,'duration').id,value}]),/Definice efektů/);
  for(const value of [null,[],[1,2],[1,2,Infinity],[1,2,1e40],Array(3)])assert.throws(()=>editEffectDefinitions(bytes,[{id:entry(emitter,'position').id,value}]),/Definice efektů/);
  for(const value of ['x\0y','🔥','x'.repeat(999)])assert.throws(()=>editEffectDefinitions(bytes,[{id:entry(phase,'name').id,value}]),/název/);
  assert.throws(()=>editEffectDefinitions(bytes,[{id:entry(emitter,'frame').id,value:'Absent'}]),/pouze ke čtení/);
  assert.throws(()=>editEffectDefinitions(bytes,[{id:entry(phase,'durationSpread').id,value:250}]),/rozptyl délky/);
  assert.throws(()=>editEffectDefinitions(bytes,[{id:entry(phase,'duration').id,value:100},{id:entry(phase,'duration').id,value:120}]),/opakovaná/);
  assert.throws(()=>editEffectDefinitions(bytes,[{id:'missing',value:1}]),/vlastnost/);
});

test('project saves definitions atomically with stale guards, byte-exact reopen/export and undo',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'mafia-effect-types-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  await writeSafe(root,'workbench.json',JSON.stringify({format:'mafia-workbench',version:1,name:'Effects',assets:[],history:[]}));const project=await ModProject.open(root),name='tables/effects.tbl',bytes=fixture();await project.createFiles([{path:name,data:bytes}]);const baseline=project.manifest.history.length;
  const file=await project.inspect(name);assert.equal(file.type,'effect-types');const phase=file.records[0].children[0].children[0],changes=[{id:entry(phase,'duration').id,value:350},{id:entry(phase,'name').id,value:'Nová fáze'}];
  await assert.rejects(project.saveEffectDefinitions(name,changes,'stale'),/změnil/);await assert.rejects(project.saveEffectDefinitions(name,[{id:entry(phase,'duration').id,value:0}],file.sha256),/rozsah/);assert.equal(project.manifest.history.length,baseline);assert.deepEqual(await project.read(name),bytes);
  await project.saveEffectDefinitions(name,changes,file.sha256);const expected=editEffectDefinitions(bytes,changes);assert.deepEqual(await project.read(name),expected);await assert.rejects(project.saveEffectDefinitions(name,changes,file.sha256),/změnil/);
  const reopened=await ModProject.open(root),destination=path.join(root,'export');await reopened.export(destination);assert.deepEqual(await fs.readFile(path.join(destination,name)),expected);assert.deepEqual(await reopened.read(name),expected);
  await reopened.undo();assert.deepEqual(await reopened.read(name),bytes);assert.equal(reopened.manifest.history.length,baseline);assert.equal(hash(await reopened.read(name)),file.sha256);
});

test('new effect types append exact renamed copies without changing any previous ID or opaque data',()=>{
  const source=Buffer.concat([fixture({opaque:true}),fixture({reversed:true})]),before=parseEffectDefinitions(source),request={action:'duplicate',id:before.records[0].id,name:'Vlastní kouř'};
  const {data,selection}=changeEffectDefinition(source,request),after=parseEffectDefinitions(data);
  assert.equal(selection,'types/2');assert.equal(after.records.length,3);assert.deepEqual(data.subarray(0,source.length),source);assert.equal(after.records[2].name,request.name);
  assert.equal(parseEffectTypes(data).items[2].effectId,2);assert.equal(parseEffectTypes(data).items[2].model,'particle.I3D');
  const expected=editEffectDefinitions(fixture({opaque:true}),[{id:before.records[0].entries.find(e=>e.key==='name').id,value:request.name}]);assert.deepEqual(data.subarray(source.length),expected);
  assert.equal(after.records[2].children[0].children[0].warnings.length,1);assert.deepEqual(source,Buffer.concat([fixture({opaque:true}),fixture({reversed:true})]));
});

test('local emitter/phase copies, ordering and deletion retain effective overrides, suffixes and exact other types',()=>{
  for(const kind of ['emitter','phase']){
    const source=Buffer.concat([fixture({reversed:true}),fixture({invalid:true})]),type=parseEffectDefinitions(source).records[0],emitter=type.children[0],target=kind==='emitter'?emitter:emitter.children[0];
    let result=changeEffectDefinition(source,{action:'duplicate',id:target.id,name:'Druhá'});const read=bytes=>{const record=parseEffectDefinitions(bytes).records[0];return kind==='emitter'?record.children:record.children[0].children;};
    assert.equal(read(result.data).length,2);assert.equal(read(result.data)[1].id,result.selection);assert.equal(read(result.data)[1].name,'Druhá');assert.deepEqual(result.data.subarray(-fixture({invalid:true}).length),fixture({invalid:true}));
    const copy=read(result.data)[1],phase=kind==='phase'?copy:copy.children[0];assert.deepEqual(entry(phase,'scale').value,[8,5,6]);assert(result.data.includes(Buffer.from('emitter-suffix')));assert(result.data.includes(Buffer.from('phase-suffix')));
    const copied=result.data;result=changeEffectDefinition(result.data,{action:'move',id:copy.id,direction:-1});assert.equal(read(result.data)[0].name,'Druhá');assert.equal(read(result.data)[0].id,result.selection);
    result=changeEffectDefinition(result.data,{action:'move',id:result.selection,direction:1});assert.deepEqual(result.data,copied);
    result=changeEffectDefinition(result.data,{action:'delete',id:read(result.data)[1].id});assert.deepEqual(result.data,source);assert.equal(result.selection,kind==='emitter'?type.id:emitter.id);
  }
});

test('unnamed native emitter/phase templates gain only a name chunk in their new copy',()=>{
  const phase=chunk(102,chunk(107,floats([9.8]))),emitter=chunk(101,phase),source=chunk(100,Buffer.concat([text(103,'Type'),emitter]));
  for(const id of ['types/0/1','types/0/1/0']){
    const result=changeEffectDefinition(source,{action:'duplicate',id,name:'Pojmenovaná kopie'}),parsed=parseEffectDefinitions(result.data),nodes=[parsed.records[0],...parsed.records[0].children.flatMap(e=>[e,...e.children])],copy=nodes.find(n=>n.id===result.selection);assert.equal(copy.name,'Pojmenovaná kopie');
    const original=nodes.find(n=>n.id===id);assert.equal(original.name,'');assert.deepEqual(changeEffectDefinition(result.data,{action:'delete',id:copy.id}).data,source);
    if(copy.kind==='phase')assert.equal(entry(copy,'gravity').value,Math.fround(9.8));
  }
});

test('definition structure refuses global ID shifts, empty chains, invalid requests and unsafe names',()=>{
  const source=fixture(),type=parseEffectDefinitions(source).records[0],emitter=type.children[0],phase=emitter.children[0];
  for(const request of [null,[],{}, {action:'delete',id:type.id},{action:'move',id:type.id,direction:1},{action:'delete',id:emitter.id},{action:'delete',id:phase.id},{action:'move',id:phase.id,direction:-1},{action:'move',id:phase.id,direction:0},{action:'duplicate',id:'types/0/missing',name:'X'},{action:'duplicate',id:phase.id,name:'FÁZE'},{action:'duplicate',id:type.id,name:'New',extra:true},{action:'delete',id:phase.id,name:'Name'},{action:'duplicate',id:type.id,name:'New',direction:1}])assert.throws(()=>changeEffectDefinition(source,request),/Definice efektů/);
  for(const name of ['', '  ', 'x\0y', '🔥', 'a'.repeat(999),null])assert.throws(()=>changeEffectDefinition(source,{action:'duplicate',id:phase.id,name}),/Definice efektů/);
  assert.throws(()=>changeEffectDefinition(chunk(100,text(103,'Empty')),{action:'duplicate',id:'types/0',name:'Copy'}),/úplný vzor/);
  assert.deepEqual(editEffectDefinitions(source,[]),source);
});

test('definition structure guards stale versions, publication rollback, export and one exact undo',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'mafia-effect-structure-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));await writeSafe(root,'workbench.json',JSON.stringify({format:'mafia-workbench',version:2,name:'Particles',assets:[],history:[]}));
  const p=await ModProject.open(root),name='tables/effects.tbl',source=fixture();await p.createFiles([{path:name,data:source},{path:'protected.bin',data:Buffer.from('protected')}]);const history=p.manifest.history.length,request={action:'duplicate',id:'types/0',name:'Vlastní'};
  await assert.rejects(()=>p.changeEffectDefinition(name,request,'stale'),/změnil/);await assert.rejects(()=>p.changeEffectDefinition('other.bin',request,hash(source)),/tabulka/);assert.equal(p.manifest.history.length,history);
  const publish=p.saveManifest;p.saveManifest=async()=>{throw Error('Publish failed');};await assert.rejects(()=>p.changeEffectDefinition(name,request,hash(source)),/Publish failed/);p.saveManifest=publish;assert.deepEqual(await p.read(name),source);assert.equal(p.manifest.history.length,history);
  const selection=await p.changeEffectDefinition(name,request,hash(source));assert.equal(selection,'types/1');assert.equal(p.manifest.history.length,history+1);
  const expected=changeEffectDefinition(source,request).data,reopen=await ModProject.open(root);assert.deepEqual(await reopen.read(name),expected);await reopen.export(root+'/export');assert.deepEqual(await fs.readFile(root+'/export/'+name),expected);
  await reopen.undo();assert.deepEqual(await reopen.read(name),source);assert.equal(reopen.manifest.history.length,history);assert.equal((await reopen.read('protected.bin')).toString(),'protected');
});
