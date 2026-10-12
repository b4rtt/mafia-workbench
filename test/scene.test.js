import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectScene, editScene, changeSceneObject } from '../src/core/scene.js';
function chunk(type, payload) { const header = Buffer.alloc(6); header.writeUInt16LE(type); header.writeUInt32LE(payload.length + 6, 2); return Buffer.concat([header, payload]); }
function script(name, code) { const head = Buffer.alloc(5), length = Buffer.alloc(4); head[0] = 0x73; head.writeUInt32LE(name.length, 1); length.writeUInt32LE(code.length); return Buffer.concat([head, Buffer.from(name), length, Buffer.from(code), Buffer.from([0xde, 0xad])]); }
function fixture() {
  const position = Buffer.alloc(15, 0xee); position.writeFloatLE(1, 0); position.writeFloatLE(2, 4); position.writeFloatLE(3, 8);
  return chunk(0x4c53, Buffer.concat([chunk(0x4000, chunk(0x4010, Buffer.concat([chunk(0x10, Buffer.from('frame\0suffix')), chunk(0x20, position), chunk(0xffff, Buffer.from('unknown-data'))]))), chunk(0xae50, chunk(0xae51, script('Mission', 'wait 1000\n')))]));
}
test('scene property edits preserve opaque chunks and recalculate all ancestors', () => {
  const original = fixture(), scene = inspectScene(original);
  for (const entry of scene.entries) assert.deepEqual(editScene(original, entry.id, entry.value), original);
  const name = scene.entries.find(e => e.kind === 'string');
  const modified = editScene(original, name.id, 'longer-frame-name');
  assert.equal(inspectScene(modified).entries.find(e => e.id === name.id).value, 'longer-frame-name');
  assert.ok(modified.includes(Buffer.from('suffix'))); assert.ok(modified.includes(Buffer.from('unknown-data')));
  assert.equal(modified.readUInt32LE(2), modified.length);
  const pos = scene.entries.find(e => e.kind === 'vec3');
  const moved = editScene(original, pos.id, [10, 20, 30]);
  assert.deepEqual(inspectScene(moved).entries.find(e => e.id === pos.id).value, [10, 20, 30]);
  assert.ok(moved.includes(Buffer.from([0xee, 0xee, 0xee])));
});
test('script edits retain unknown prefix and suffix and roundtrip source', () => {
  const original = fixture(), entry = inspectScene(original).entries.find(e => e.kind === 'script');
  const value = { name: 'NewMission', code: 'wait 2500\n// český komentář' };
  const modified = editScene(original, entry.id, value);
  assert.deepEqual(inspectScene(modified).entries.find(e => e.id === entry.id).value, value);
  assert.ok(modified.includes(Buffer.from([0xde, 0xad])));
  assert.ok(modified.includes(Buffer.from([0x73, value.name.length, 0, 0, 0])));
});
test('malformed chunks, missing properties and invalid values fail explicitly', () => {
  const original = fixture(), position = inspectScene(original).entries.find(e => e.kind === 'vec3');
  assert.throws(() => inspectScene(original.subarray(0, original.length - 1)), /překračuje/);
  assert.throws(() => editScene(original, 'no-such-id', 1), /neexistuje/);
  assert.throws(() => editScene(original, position.id, [NaN, 0, 0]), /hodnota/);
});
test('kind 5 actor scripts preserve headers, tails and unknown actor payloads on edits',()=>{
  const code=Buffer.from('loaddifferences "One.chg"\r\nrecloadfull "One.rep"'),header=Buffer.alloc(14);header[0]=header[1]=header[5]=1;header.writeUInt32LE(code.length,10);
  const actor=(kind,data)=>{const k=Buffer.alloc(4);k.writeUInt32LE(kind);return chunk(0xae21,Buffer.concat([chunk(0xae23,Buffer.from('Init\0')),chunk(0xae22,k),chunk(0xae24,data)]));};
  const data=Buffer.concat([header,code,Buffer.from([0xde,0xad])]),source=chunk(0x4c53,chunk(0xae20,actor(5,data))),before=Buffer.from(source);
  assert.deepEqual(inspectScene(source).actorScripts,[{name:'Init',code:code.toString()}]);assert.deepEqual(editScene(source,'0/0/0/0','Init'),source);assert.deepEqual(source,before);
  const entry=inspectScene(source).entries.find(e=>e.actorScript);assert.equal(entry.id,'0/0/0/2');assert.deepEqual(editScene(source,entry.id,entry.value),source);
  const value={name:'Init',code:entry.value.code+'\r\n// český komentář'};
  const changed=editScene(source,entry.id,value);assert.deepEqual(inspectScene(changed).entries.find(e=>e.id===entry.id).value,value);assert.ok(changed.subarray(-2).equals(Buffer.from([0xde,0xad])));assert.ok(changed.includes(header.subarray(0,10)));assert.equal(changed.readUInt32LE(2),changed.length);assert.deepEqual(editScene(changed,entry.id,entry.value),source);assert.deepEqual(source,before);
  assert.equal(inspectScene(editScene(source,entry.id,{name:'Init',code:''})).actorScripts[0].code,'');
  for(const invalid of [{name:'Other',code:'wait 1'},{name:'Init',code:'emoji 🐱'},{name:'Init',code:'nul\0'},{name:'Init',code:'a'.repeat(1000001)}])assert.throws(()=>editScene(source,entry.id,invalid),/Scene/);

  const unsupported=chunk(0x4c53,chunk(0xae20,actor(2,data)));assert.deepEqual(inspectScene(unsupported).actorScripts,[]);assert.throws(()=>editScene(unsupported,entry.id,value),/neexistuje/);
  assert.deepEqual(inspectScene(chunk(0x4c53,chunk(0xae20,actor(5,data.subarray(0,20))))).actorScripts,[]);
  const unknown=Buffer.from(data);unknown[5]=0;assert.deepEqual(inspectScene(chunk(0x4c53,chunk(0xae20,actor(5,unknown)))).actorScripts,[]);
});
test('human v6 scripts preserve actor parameters, sibling data and trailing source on edits',()=>{
  const code=Buffer.from('enemy_move 77, walk\r\n'),header=Buffer.alloc(83,0xee);
  header[0]=6;header[73]=header[74]=1;header.writeUInt32LE(0,75);header.writeUInt32LE(code.length,79);
  const data=Buffer.concat([header,code,Buffer.from('opaque program tail')]);
  const actor=(kind,payload)=>{const type=Buffer.alloc(4);type.writeUInt32LE(kind);return chunk(0xae21,Buffer.concat([chunk(0xae22,type),chunk(0xae23,Buffer.from('Walker\0')),chunk(0xae24,payload),chunk(0xbeef,Buffer.from('actor sibling'))]));};
  const scene=(kind,payload)=>chunk(0x4c53,chunk(0xae20,actor(kind,payload)));
  const source=scene(27,data),before=Buffer.from(source),entry=inspectScene(source).entries.find(e=>e.actorScript);
  assert.equal(entry.actorKind,27);assert.deepEqual(entry.value,{name:'Walker',code:code.toString()});
  assert.deepEqual(editScene(source,entry.id,entry.value),source);
  const value={name:'Walker',code:'enemy_move 88, walk\r\n// změna postavy'};
  const changed=editScene(source,entry.id,value);
  assert.deepEqual(inspectScene(changed).actorScripts,[value]);assert.ok(changed.includes(header.subarray(0,79)));
  assert.ok(changed.includes(Buffer.from('opaque program tail')));assert.ok(changed.includes(Buffer.from('actor sibling')));
  assert.equal(changed.readUInt32LE(2),changed.length);assert.deepEqual(editScene(changed,entry.id,entry.value),source);assert.deepEqual(source,before);
  assert.equal(inspectScene(editScene(source,entry.id,{name:'Walker',code:''})).actorScripts[0].code,'');
  for(const invalid of [{name:'Other',code:'wait 1'},{name:'Walker',code:'emoji 🐱'},{name:'Walker',code:'nul\0'},{name:'Walker',code:'a'.repeat(1000001)}])assert.throws(()=>editScene(source,entry.id,invalid),/Scene/);
  // Never find a script by scanning for signatures in opaque human data.
  for(const [offset,value] of [[0,5],[73,0],[74,2],[75,1],[79,0xff]]){
    const bad=Buffer.from(data);bad[offset]=value;
    assert.deepEqual(inspectScene(scene(27,bad)).actorScripts,[]);
    assert.throws(()=>editScene(scene(27,bad),entry.id,entry.value),/neexistuje/);
  }
  for(const kind of [2,3,5,28])assert.deepEqual(inspectScene(scene(kind,data)).actorScripts,[]);
  for(const length of [0,73,82,83,100])assert.deepEqual(inspectScene(scene(27,data.subarray(0,length))).actorScripts,[]);
});
const modelOperation = { kind:'add-model', name:'WB_CRATE', model:'bedna02.i3d', position:[1,2,3], rotation:[Math.SQRT1_2,0,Math.SQRT1_2,0], scale:[1,2,3] };
test('inserting and deleting a model recalculates sizes, preserves all original chunks and restores the exact scene', () => {
  const source = fixture(), before = Buffer.from(source), added = changeSceneObject(source,modelOperation), scene = inspectScene(added), object = scene.objects.at(-1);
  assert.equal(object.frameType,9); assert.equal(object.actorBound,false); assert.equal(object.name,'WB_CRATE'); assert.equal(object.model,'bedna02.i3d');
  assert.equal(object.parent,'Primary sector'); assert.deepEqual(object.position,[1,2,3]); assert.deepEqual(object.worldPosition,[1,2,3]); assert.deepEqual(object.scale,[1,2,3]);
  assert.ok(Math.abs(object.rotation[2]-Math.SQRT1_2)<1e-6); assert.equal(added.readUInt32LE(2),added.length);
  assert.ok(added.includes(source.subarray(18,source.indexOf(Buffer.from('unknown-data'))+12))); assert.deepEqual(source,before);
  assert.deepEqual(changeSceneObject(added,{kind:'delete',id:object.id}),source);
  const punctuation = changeSceneObject(source,{...modelOperation,model:'!bedna (02).i3d'});
  assert.equal(inspectScene(punctuation).objects.at(-1).model,'!bedna (02).i3d');
});
test('duplicating a standalone object preserves opaque bytes, parent and transform while giving the copy its own identity', () => {
  let source = changeSceneObject(fixture(),modelOperation), original = inspectScene(source).objects.at(-1);
  const tag = chunk(0xbeef,Buffer.from('copy-preserved-payload'));
  // Attach an unknown child to the model without changing any known fields.
  const start = source.indexOf(Buffer.from('WB_CRATE\0')) - 22, size = source.readUInt32LE(start+2);
  assert.equal(source.readUInt16LE(start),0x4010);
  const marked = Buffer.concat([source.subarray(0,start+size),tag,source.subarray(start+size)]);
  marked.writeUInt32LE(size+tag.length,start+2); marked.writeUInt32LE(marked.length,2); marked.writeUInt32LE(source.readUInt32LE(8)+tag.length,8);
  source = marked; original = inspectScene(source).objects.at(-1);
  const result = changeSceneObject(source,{kind:'duplicate',id:original.id,name:'WB_COPY'}), objects = inspectScene(result).objects;
  const copy = objects.at(-1); assert.notEqual(copy.id,original.id); assert.equal(copy.name,'WB_COPY');
  for(const field of ['position','rotation','scale','worldPosition','model','parent','frameType']) assert.deepEqual(copy[field],original[field]);
  assert.equal(result.toString('latin1').split('copy-preserved-payload').length-1,2);
  assert.deepEqual(changeSceneObject(result,{kind:'delete',id:copy.id}),source);
});
test('structural changes reject collisions, actor and child references, geometry overrides and invalid transforms', () => {
  const source = fixture();
  for(const change of [{name:'FRAME'},{name:'Primary sector'},{name:'../bad'},{model:'../model.i3d'},{rotation:[0,0,0,0]},{position:[NaN,0,0]},{scale:[1,0,1]}]) assert.throws(()=>changeSceneObject(source,{...modelOperation,...change}));
  assert.throws(()=>changeSceneObject(source,modelOperation,['wb_crate']),/existuje/);
  assert.throws(()=>changeSceneObject(source,{kind:'delete',id:inspectScene(source).objects[0].id}),/samostatný/);
  const added = changeSceneObject(source,modelOperation), object = inspectScene(added).objects.at(-1);
  assert.throws(()=>changeSceneObject(added,{kind:'delete',id:object.id},['WB_CRATE']),/geometrie/);
  const extend = extra => { const result=Buffer.concat([added,extra]); result.writeUInt32LE(result.length,2); return result; };
  const actor = extend(chunk(0xae20,chunk(0xae21,chunk(0xae23,Buffer.from('wb_crate\0')))));
  assert.equal(inspectScene(actor).objects.at(-1).actorBound,true); assert.throws(()=>changeSceneObject(actor,{kind:'duplicate',id:object.id,name:'COPY'}),/aktéra/);
  const child = extend(chunk(0x4010,Buffer.concat([chunk(0x10,Buffer.from('child\0')),chunk(0x4020,chunk(0x10,Buffer.from('wb_crate\0')))])));
  assert.throws(()=>changeSceneObject(child,{kind:'delete',id:object.id}),/potomky/);
  const referenced = extend(chunk(0xae50,chunk(0xae51,script('Reference','findframe 0, "WB_CRATE"'))));
  assert.throws(()=>changeSceneObject(referenced,{kind:'delete',id:object.id}),/skript/);
  assert.throws(()=>changeSceneObject(added,{kind:'delete',id:'missing'}),/samostatný/);
});
