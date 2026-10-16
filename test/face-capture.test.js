import test from 'node:test';
import assert from 'node:assert/strict';
import { faceNeutral,faceScores,mapFace,smoothFace,validateFaceCapture,sampleFace,faceToLip } from '../src/shared/face-capture.js';
import { createLip,parseLip } from '../src/core/lip.js';
import { facePermissionGate } from '../src/desktop/face-permissions.js';
const fixture=()=>({format:'mafia-workbench-face',version:1,mapping:'ls3d-three-region-v1',model:'models/TommyHIGH.4ds',duration:600,settings:{gain:1,smoothing:40},calibration:{jawOpen:.02},samples:[{time:0,scores:{jawOpen:0},values:[...faceNeutral]},{time:55,scores:{jawOpen:1},values:[255,117,135,28,255,153]},{time:160,scores:null,values:[...faceNeutral]}]});
test('capture maps calibrated mouth, lids and brows while unsupported asymmetric detail stays in the recording',()=>{
  assert.deepEqual(mapFace(null),faceNeutral);assert.deepEqual(mapFace({}),faceNeutral);assert.deepEqual(mapFace({jawOpen:.2},{jawOpen:.2},3),faceNeutral);
  const closed=mapFace({eyeBlinkLeft:1,eyeBlinkRight:1,browInnerUp:1,jawOpen:1});assert.equal(closed[0],255);assert.equal(closed[3],255);assert.equal(closed[5],0);assert.equal(closed[4],255);
  assert.deepEqual(mapFace({eyeBlinkLeft:1}),mapFace({eyeBlinkRight:1}));assert.deepEqual(mapFace({tongueOut:1,eyeLookUpLeft:1,jawLeft:1}),faceNeutral);
  const scores=faceScores([{categoryName:'jawOpen',score:.7},{categoryName:'eyeBlinkLeft',score:.9}]);assert.equal(scores.eyeBlinkLeft,.9);assert.equal(mapFace(scores)[0],179);
  for(const bad of [null,[{categoryName:'x',score:NaN}],[{categoryName:'x',score:2}],[{categoryName:'x',score:.5},{categoryName:'x',score:.1}]])assert.equal(faceScores(bad),null);
});
test('smoothing uses elapsed time; tracking loss bypasses it and resampling never stretches a missing face',()=>{
  const a=smoothFace(faceNeutral,[255,117,135,28,255,153],40,100),b=smoothFace(faceNeutral,[255,117,135,28,255,153],100,100);assert(a[0]>0&&a[0]<b[0]&&b[0]<255);
  assert.deepEqual(smoothFace(faceNeutral,[255,117,135,28,255,153],40,0),[255,117,135,28,255,153]);
  const capture=fixture();assert.equal(sampleFace(capture,54)[0],0);assert.equal(sampleFace(capture,55)[0],255);assert.equal(sampleFace(capture,159)[0],255);assert.deepEqual(sampleFace(capture,160),faceNeutral);
  capture.samples.pop();assert.deepEqual(sampleFace(capture,256),faceNeutral);assert.deepEqual(sampleFace(capture,-1),faceNeutral);
});
test('trimmed performance becomes 25 Hz native LIP with two neutral release records, without mutating raw coefficients',()=>{
  const source=fixture(),before=structuredClone(source),frames=faceToLip(source,40,200);assert.equal(frames.length,6);assert.deepEqual(frames.map(r=>r.values[0]),[0,255,255,0,0,0]);assert(frames.every(r=>r.sourceIndex===null));
  const bytes=createLip(frames);assert.deepEqual(parseLip(bytes).frames.map(r=>r.values),frames.map(r=>r.values));assert.deepEqual(source,before);
  for(const range of [[-1,200],[0,601],[30,50],[NaN,100]])assert.throws(()=>faceToLip(source,...range),/Mimika/);
});
test('untrusted recording validation bounds memory, time, coefficients and paths and strips unrelated payloads',()=>{
  const source=fixture();source.video='must not persist';source.samples[0].image='must not persist';const value=validateFaceCapture(source);assert(!Object.hasOwn(value,'video'));assert(!Object.hasOwn(value.samples[0],'image'));assert.deepEqual(validateFaceCapture(JSON.parse(JSON.stringify(value))),value);
  for(const change of [v=>v.version=2,v=>v.model='../Game.exe',v=>v.duration=600001,v=>v.settings.gain=NaN,v=>v.samples[0].time=1,v=>v.samples[1].time=0,v=>v.samples[1].time=601,v=>v.samples[1].values[0]=256,v=>v.samples[1].scores.jawOpen=-1,v=>v.samples=Array(15002).fill(v.samples[0])]){const bad=fixture();change(bad);assert.throws(()=>validateFaceCapture(bad),/Mimika/);}
});
test('camera permission is short lived, main frame video only, and explicitly revocable',()=>{
  let time=100;const gate=facePermissionGate(()=>time),details={isMainFrame:true,requestingUrl:'workbench://app/index.html',mediaType:'video',mediaTypes:['video'],securityOrigin:'workbench://app'};
  assert(!gate.check('media','workbench://app',details));gate.arm();assert(gate.check('media','workbench://app',details));assert(gate.request('media',details));
  assert(gate.request('media',{...details,securityOrigin:'workbench://app/'}));assert(gate.check('media','workbench://app/',details));assert(!gate.check('media','workbench://app.example/',details));
  for(const patch of [{isMainFrame:false},{requestingUrl:'https://example.com/'},{mediaType:'audio'}])assert(!gate.check('media','workbench://app',{...details,...patch}));
  for(const patch of [{mediaTypes:['video','audio']},{mediaTypes:['audio']},{mediaTypes:[]},{securityOrigin:'https://example.com'}])assert(!gate.request('media',{...details,...patch}));
  assert(!gate.check('clipboard-read','workbench://app',details));time=30100;assert(!gate.request('media',details));gate.arm();gate.clear();assert(!gate.request('media',details));
});
