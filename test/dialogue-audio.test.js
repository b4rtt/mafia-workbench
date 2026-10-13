import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {prepareDialogueWav,dialogueSoundPath} from '../src/core/dialogue-audio.js';
import {ModProject} from '../src/core/project.js';
import {hash,writeSafe} from '../src/core/files.js';
function chunk(name,data){const header=Buffer.alloc(8);header.write(name);header.writeUInt32LE(data.length,4);return Buffer.concat([header,data,Buffer.alloc(data.length%2)]);}
function wav(values,{format=1,bits=16,channels=1,extensible=false,junk=false}={}){
  const width=bits/8,fmt=Buffer.alloc(extensible?40:16);fmt.writeUInt16LE(extensible?0xfffe:format);fmt.writeUInt16LE(channels,2);fmt.writeUInt32LE(22050,4);fmt.writeUInt32LE(22050*channels*width,8);fmt.writeUInt16LE(channels*width,12);fmt.writeUInt16LE(bits,14);
  if(extensible){fmt.writeUInt16LE(22,16);fmt.writeUInt16LE(bits,18);fmt.writeUInt32LE(channels===1?4:3,20);Buffer.from(format===1?'0100000000001000800000aa00389b71':'0300000000001000800000aa00389b71','hex').copy(fmt,24);}
  const data=Buffer.alloc(values.length*width);values.forEach((value,i)=>{if(format===3){if(bits===32)data.writeFloatLE(value,i*width);else data.writeDoubleLE(value,i*width);}else if(bits===8)data[i]=value;else data.writeIntLE(value,i*width,width);});
  const payload=Buffer.concat([Buffer.from('WAVE'),...(junk?[chunk('JUNK',Buffer.from([1,2,3]))]:[]),chunk('fmt ',fmt),chunk('data',data)]),head=Buffer.alloc(8);head.write('RIFF');head.writeUInt32LE(payload.length,4);return Buffer.concat([head,payload]);
}
test('dialogue PCM keeps rate and samples, handles metadata, stereo and extensible input, and canonical filename uses signed engine range',()=>{
  const source=wav([-32768,-123,0,123,32767],{junk:true}),{bytes,info}=prepareDialogueWav(source);assert.equal(info.sampleRate,22050);assert.equal(info.sourceBits,16);assert.equal(info.duration,5/22050);assert.equal(info.samples,5);assert.deepEqual([...Array(5)].map((_,i)=>bytes.readInt16LE(44+i*2)),[-32768,-123,0,123,32767]);assert.equal(bytes.length,54);assert(!bytes.includes(Buffer.from('JUNK')));assert.deepEqual(prepareDialogueWav(bytes).bytes,bytes);
  const stereo=prepareDialogueWav(wav([1000,3000,-1000,-3000],{channels:2,extensible:true}));assert.equal(stereo.info.sourceChannels,2);assert.equal(stereo.bytes.readInt16LE(44),2000);assert.equal(stereo.bytes.readInt16LE(46),-2000);
  assert.equal(dialogueSoundPath(90000),'sounds/00090000.wav');assert.equal(dialogueSoundPath(123456789),'sounds/123456789.wav');for(const id of [-1,NaN,1.5,2147483648])assert.throws(()=>dialogueSoundPath(id),/ID/);
});
test('dialogue conversion covers unsigned PCM8, PCM24/32, float32/64, clipping and malformed inputs',()=>{
  for(const [bits,values]of [[8,[0,128,255]],[24,[-8388608,0,8388607]],[32,[-2147483648,0,2147483647]]]){const result=prepareDialogueWav(wav(values,{bits}));assert.equal(result.bytes.readInt16LE(44),-32768);assert.equal(result.bytes.readInt16LE(46),0);assert.equal(result.bytes.readInt16LE(48),bits===8?32512:32767);}
  for(const bits of [32,64]){const result=prepareDialogueWav(wav([-2,-.5,0,.5,2],{format:3,bits,extensible:bits===32}));assert.equal(result.info.clipped,2);assert.deepEqual([...Array(5)].map((_,i)=>result.bytes.readInt16LE(44+i*2)),[-32768,-16384,0,16384,32767]);assert.throws(()=>prepareDialogueWav(wav([NaN],{format:3,bits})),/NaN/);}
  const good=wav([0,1]);for(const bad of [good.subarray(0,43),Buffer.concat([good,Buffer.from([0])]),wav([],{}),wav([1,2,3],{channels:3}),wav([1],{format:6})])assert.throws(()=>prepareDialogueWav(bad),/Dabing/);
  for(const [offset,value]of [[28,1],[32,4],[24,100],[40,999]]){const bad=Buffer.from(good);bad.writeUInt32LE(value,offset);assert.throws(()=>prepareDialogueWav(bad),/Dabing/);}
  const bad=wav([0],{extensible:true});bad[44]=0;assert.throws(()=>prepareDialogueWav(bad),/Dabing/);
});
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'mafia-voice-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));await writeSafe(root,'workbench.json',JSON.stringify({format:'mafia-workbench',version:2,name:'Voice test',assets:[],history:[]}));const project=await ModProject.open(root),name='tables/textdb_cz.def',text=Buffer.alloc(26);text.writeUInt32LE(2,0);text.writeUInt32LE(90000,8);text.writeUInt32LE(24,12);text.writeUInt32LE(99999999,16);text.writeUInt32LE(25,20);await project.createFiles([{path:name,data:text}]);return {root,project,name,text};}
test('new dialogue import validates text binding, exports and undoes the creation; replacement is guarded and backed up',async t=>{
  const {root,project:p,name,text}=await fixture(t),original=JSON.stringify(p.manifest),sound='sounds/00090000.wav',one=wav([1,2,3]),two=wav([7,8,9]);
  await assert.rejects(()=>p.importDialogue(name,90000,one,'stale'),/změnily/);await assert.rejects(()=>p.importDialogue(name,90001,one,hash(text)),/neexistuje/);await assert.rejects(()=>p.importDialogue(name,99999999,one,hash(text)),/hraniční/);await assert.rejects(()=>p.importDialogue(name,90000,one,hash(text),'stale'),/změnil/);assert.equal(JSON.stringify(p.manifest),original);
  const result=await p.importDialogue(name,90000,one,hash(text));assert.equal(result.path,sound);assert.equal(p.asset(sound).archive,'Vlastní dabing');assert.deepEqual(await p.read(sound),one);assert.deepEqual(await p.read(name),text);
  await assert.rejects(()=>p.importDialogue(name,90000,two,hash(text)),/existuje/);await assert.rejects(()=>p.importDialogue(name,90000,two,hash(text),'stale'),/změnil/);
  await p.importDialogue(name,90000,two,hash(text),hash(one));assert.deepEqual(await p.read(sound),two);const reopened=await ModProject.open(root);await reopened.export(path.join(root,'export'));assert.deepEqual(await fs.readFile(path.join(root,'export',sound)),two);await reopened.undo();assert.deepEqual(await reopened.read(sound),one);await reopened.undo();assert.throws(()=>reopened.asset(sound));assert.equal(JSON.stringify(reopened.manifest),original);assert.deepEqual(await reopened.read(name),text);
});
test('new voice creation rejects concurrent text change before publication and manifest failure leaves no indexed voice',async t=>{
  const {root,project:p,name,text}=await fixture(t),sound='sounds/00090000.wav',original=JSON.stringify(p.manifest),one=wav([1,2,3]),save=p.saveManifest;
  p.saveManifest=async()=>{throw new Error('publication failed');};await assert.rejects(()=>p.importDialogue(name,90000,one,hash(text)),/publication failed/);assert.equal(JSON.stringify(p.manifest),original);assert.throws(()=>p.asset(sound));p.saveManifest=save;
  const read=p.read;let reads=0;p.read=async function(asset){const result=await read.call(this,asset);if(asset===name&&++reads===3)return Buffer.concat([result,Buffer.from([123])]);return result;};await assert.rejects(()=>p.importDialogue(name,90000,one,hash(text)),/Závislý/);assert.equal(JSON.stringify(p.manifest),original);assert.throws(()=>p.asset(sound));p.read=read;
  await p.importDialogue(name,90000,one,hash(text));const batch=p.changeBatch;p.changeBatch=async function(files,...args){const textAsset=this.asset(name);await writeSafe(root,textAsset.original,Buffer.concat([text,Buffer.from([42])]));return batch.call(this,files,...args);};await assert.rejects(()=>p.importDialogue(name,90000,wav([9]),hash(text),hash(one)),/změnil|mimo editor/);assert.deepEqual(await p.read(sound),one);
});
