import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {inspectScene,editScene,changeSceneObject} from '../src/core/scene.js';
import {soundTypes,validateNewSound} from '../src/shared/sounds.js';
import {ModProject} from '../src/core/project.js';
import {hash,writeSafe} from '../src/core/files.js';

const chunk=(type,payload)=>{const b=Buffer.alloc(6);b.writeUInt16LE(type);b.writeUInt32LE(payload.length+6,2);return Buffer.concat([b,payload]);};
const u32=n=>{const b=Buffer.alloc(4);b.writeUInt32LE(n);return b;};
const floats=values=>{const b=Buffer.alloc(values.length*4);values.forEach((n,i)=>b.writeFloatLE(n,i*4));return b;};
const opaque=chunk(0xffff,Buffer.from('unrecognised sibling'));
const sector=chunk(0x4010,Buffer.concat([chunk(0x4011,u32(5)),chunk(0x10,Buffer.from('Room\0'))]));
const original=chunk(0x4c53,Buffer.concat([chunk(0x4000,sector),opaque]));
const request={kind:'add-sound',name:'WB_SOUND',position:[1,2,3],rotation:[1,0,0,0],parameters:{file:'voices\\hello.wav',type:2,volume:.5,outVolume:.25,range:[1,20,.75,.125],cone:[60,120],loop:true,sectors:['primary sector','ROOM']}};
const value=(scene,label)=>scene.entries.find(e=>e.id.startsWith(scene.objects.at(-1).id+'/')&&e.label===label).value;

test('five sound types retain ordered four-float ranges, cone, loop and sector bindings without actors or loss of existing bytes',()=>{
  for(const {value:type} of soundTypes){
    const result=changeSceneObject(original,{...request,parameters:{...request.parameters,type}}),scene=inspectScene(result),object=scene.objects.at(-1);
    assert.deepEqual(scene.objects.slice(0,-1),inspectScene(original).objects);assert.equal(object.frameType,4);assert.equal(object.actorBound,false);assert.deepEqual(object.position,[1,2,3]);assert.deepEqual(object.rotation,[1,0,0,0]);assert.equal(object.parent,'Primary sector');assert.equal(object.model,undefined);
    assert.equal(value(scene,'Typ zvuku'),type);assert.equal(value(scene,'Hlasitost'),.5);assert.equal(value(scene,'Vnější hlasitost'),.25);assert.deepEqual(value(scene,'Dosah zvuku'),[1,20,.75,.125]);assert.deepEqual(value(scene,'Zvukový kužel'),[60,120].map(n=>Math.fround(n*Math.PI/180)));assert.equal(value(scene,'Opakovat zvuk'),true);assert.deepEqual(scene.entries.filter(e=>e.label==='Sektor zvuku').map(e=>e.value),['Primary sector','Room']);assert.ok(scene.entries.some(e=>e.label==='Název'&&e.value==='voices\\hello.wav'));
    assert.ok(result.includes(opaque));assert.ok(result.includes(sector));assert.equal(result.readUInt32LE(2),result.length);
    for(const entry of scene.entries)assert.deepEqual(editScene(result,entry.id,entry.value),result);
    const copy=changeSceneObject(result,{kind:'duplicate',id:object.id,name:'WB_SOUND_COPY'}),copied=inspectScene(copy);assert.equal(value(copied,'Opakovat zvuk'),true);assert.deepEqual(value(copied,'Dosah zvuku'),[1,20,.75,.125]);assert.deepEqual(changeSceneObject(copy,{kind:'delete',id:copied.objects.at(-1).id}),result);
  }
});

test('sound loop presence can be inserted and removed with unknown sound chunks and tails intact',()=>{
  const sound=chunk(0x4060,Buffer.concat([chunk(0x10,Buffer.from('sample.wav\0')),chunk(0x4068,Buffer.concat([floats([1,10,1,0]),Buffer.from('range tail')])),chunk(0x4065,Buffer.from('opaque extra')),opaque]));
  const source=chunk(0x4c53,chunk(0x4000,chunk(0x4010,Buffer.concat([chunk(0x10,Buffer.from('Emitter\0')),chunk(0x4011,u32(4)),sound]))));
  const scene=inspectScene(source),loop=scene.entries.find(e=>e.soundParameter),range=scene.entries.find(e=>e.label==='Dosah zvuku');assert.equal(loop.value,false);
  const looped=editScene(source,loop.id,true);assert.equal(inspectScene(looped).entries.find(e=>e.soundParameter).value,true);assert.deepEqual(editScene(looped,loop.id,false),source);
  assert.throws(()=>editScene(source,loop.id,1),/opakování/);
  const edited=editScene(source,range.id,[2,30,.5,.25]);assert.deepEqual(inspectScene(edited).entries.find(e=>e.id===range.id).value,[2,30,.5,.25]);assert.ok(edited.includes(Buffer.from('range tail')));assert.ok(edited.includes(chunk(0x4065,Buffer.from('opaque extra'))));assert.ok(edited.includes(opaque));
  const legacy=chunk(0x4c53,chunk(0x4060,chunk(0x4068,floats([1,10])))),legacyRange=inspectScene(legacy).entries.find(e=>e.label==='Dosah zvuku');assert.equal(legacyRange.kind,'vec2');assert.deepEqual(editScene(legacy,legacyRange.id,[1,10]),legacy);
});

test('sound creation rejects ambiguous names, missing sectors and invalid file/range/cone values',()=>{
  const base={...request.parameters};
  for(const override of [{file:'..\\x.wav'},{file:'a/hi.wav'},{file:'x.mp3'},{file:'x:hi.wav'},{file:'\\hi.wav'},{file:'a\\\\hi.wav'},{type:0},{type:6},{volume:2},{volume:NaN},{outVolume:-1},{range:[1,10]},{range:[1,1+1e-10,1,0]},{range:[-1,10,1,0]},{range:[1,10,NaN,0]},{range:[1,10,1,2]},{range:Array(4)},{cone:[120,60]},{cone:[0,361]},{cone:[0,1e-50]},{loop:1},{sectors:[]},{sectors:['Room','room']},{sectors:['missing']},{unknown:1}])assert.throws(()=>changeSceneObject(original,{...request,parameters:{...base,...override}}),/Zvuk/);
  assert.throws(()=>changeSceneObject(original,{...request,name:'room'}),/existuje/);assert.throws(()=>changeSceneObject(original,{...request,rotation:[0,0,0,0]}),/rotace/);assert.throws(()=>changeSceneObject(original,{...request,position:[Infinity,0,0]}),/hodnota/);
  assert.throws(()=>changeSceneObject(original,{...request,position:Array(3)}),/hodnota/);assert.throws(()=>changeSceneObject(original,{...request,rotation:Array(4)}),/rotace/);
  assert.equal(validateNewSound({file:'test.wav',sectors:['Room']},['Room']).loop,true);
});

test('project sound creation resolves WAV paths, guards dependencies and publishes only scene changes with exact export/undo',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'mafia-sounds-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));await writeSafe(root,'workbench.json',JSON.stringify({format:'mafia-workbench',version:1,name:'Sounds',assets:[],history:[]}));const p=await ModProject.open(root),scenePath='missions/NEW/scene2.bin',geometryPath='missions/NEW/scene.4ds',audioPath='Sounds/Voices/Hello.WAV';
  const geometry=Buffer.alloc(19);geometry.write('4DS\0');geometry.writeUInt16LE(29,4);geometry[18]=1;
  const wav=Buffer.alloc(46);wav.write('RIFF');wav.writeUInt32LE(38,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(8000,28);wav.writeUInt16LE(1,32);wav.writeUInt16LE(8,34);wav.write('data',36);wav.writeUInt32LE(2,40);wav[44]=128;wav[45]=128;
  await p.createFiles([{path:scenePath,data:original},{path:geometryPath,data:geometry},{path:audioPath,data:wav},{path:'sounds/bad.wav',data:Buffer.from('not a WAV')}]);const history=p.manifest.history.length,operation={...request,sound:'sounds/voices/hello.wav'};
  await assert.rejects(p.changeSceneObject(scenePath,operation,'stale'),/změnil/);await assert.rejects(p.changeSceneObject(scenePath,{...operation,sound:'sounds/bad.wav'},hash(original)),/hlavičku/);await assert.rejects(p.changeSceneObject(scenePath,{...operation,sound:'../x.wav'},hash(original)),/cesta/);await assert.rejects(p.changeSceneObject(scenePath,{...operation,sound:'sounds/missing.wav'},hash(original)));assert.equal(p.manifest.history.length,history);assert.deepEqual(await p.read(scenePath),original);
  // Change the source WAV between preparation and publication: scene must stay untouched.
  const publish=p.changeBatch;p.changeBatch=async function(files,...args){assert.ok(files.some(f=>f.path===audioPath&&f.expectedHash===hash(wav)));await fs.appendFile(path.join(root,p.asset(audioPath).original),'changed');return publish.call(this,files,...args);};
  await assert.rejects(p.changeSceneObject(scenePath,operation,hash(original)),/změněna|změnil/);assert.deepEqual(await p.read(scenePath),original);assert.equal(p.manifest.history.length,history);await fs.writeFile(path.join(root,p.asset(audioPath).original),wav);p.changeBatch=publish;
  await p.changeSceneObject(scenePath,operation,hash(original));const result=await p.read(scenePath);assert.deepEqual(p.manifest.history.at(-1).files.map(f=>f.path),[scenePath]);assert.deepEqual(await p.read(audioPath),wav);assert.deepEqual(await p.read(geometryPath),geometry);assert.ok(inspectScene(result).entries.some(e=>e.label==='Název'&&e.value==='Voices\\Hello.WAV'));
  // Real files may put LOOP before RANGE. Draft selection order must not shift
  // numeric IDs and accidentally edit a sector or another sound property.
  const loopOffset=result.indexOf(chunk(0x4066,Buffer.alloc(0))),rangeOffset=result.indexOf(chunk(0x4068,floats(request.parameters.range)));
  const reordered=Buffer.concat([result.subarray(0,rangeOffset),result.subarray(loopOffset,loopOffset+6),result.subarray(rangeOffset,loopOffset),result.subarray(loopOffset+6)]);await p.change(scenePath,()=>reordered,'Fixture with loop before range');
  const reopened=await ModProject.open(root),range=inspectScene(reordered).entries.find(e=>e.label==='Dosah zvuku'),loop=inspectScene(reordered).entries.find(e=>e.soundParameter);
  await reopened.saveScene(scenePath,[{id:loop.id,value:false},{id:range.id,value:[2,30,.5,0]}],hash(reordered));const edited=await reopened.read(scenePath);assert.deepEqual(value(inspectScene(edited),'Dosah zvuku'),[2,30,.5,0]);assert.equal(value(inspectScene(edited),'Opakovat zvuk'),false);assert.deepEqual(inspectScene(edited).entries.filter(e=>e.label==='Sektor zvuku').map(e=>e.value),['Primary sector','Room']);
  const destination=path.join(root,'export');await reopened.export(destination);assert.deepEqual(await fs.readFile(path.join(destination,scenePath)),edited);assert.deepEqual(await fs.readFile(path.join(destination,audioPath)),wav);
  await reopened.undo();assert.deepEqual(await reopened.read(scenePath),reordered);await reopened.undo();assert.deepEqual(await reopened.read(scenePath),result);await reopened.undo();assert.deepEqual(await reopened.read(scenePath),original);assert.equal(reopened.manifest.history.length,history);
});
