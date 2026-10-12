import test from 'node:test';
import assert from 'node:assert/strict';
import { configureEmptyMission, missionName, readEmptyMissionZip } from '../src/core/mission.js';
import { inspectScene } from '../src/core/scene.js';
const chunk = (type, data) => { const header = Buffer.alloc(6); header.writeUInt16LE(type); header.writeUInt32LE(data.length + 6, 2); return Buffer.concat([header, data]); };
const floats = values => { const bytes = Buffer.alloc(values.length * 4); values.forEach((v,i) => bytes.writeFloatLE(v, i*4)); return bytes; };
const string = text => Buffer.from(text + '\0');
function template() {
  const object = (name, rest) => chunk(0x4010, Buffer.concat([chunk(0x10,string(name)), ...rest]));
  const transform = [chunk(0x20,floats([11,10,6])),chunk(0x22,floats([1,0,0,0]))];
  const objects = [object('start',transform), object('Tommy',[...transform,chunk(0x2012,string('Tommy.i3d'))]), ...['light_sun','light_ambient'].map(name => object(name,[chunk(0x4040,chunk(0x4042,floats([2])))]))];
  const scriptName = Buffer.from('GameInitEnd'), code = Buffer.from('policemanager_on\n'), header = Buffer.alloc(5), length = Buffer.alloc(4); header.writeUInt32LE(scriptName.length,1); length.writeUInt32LE(code.length);
  const opaque = chunk(0xbeef,Buffer.from([5,6,7,8]));
  const scene = chunk(0x4c53,Buffer.concat([chunk(0x4000,Buffer.concat(objects)),chunk(0xae50,chunk(0xae51,Buffer.concat([header,scriptName,length,code,Buffer.from([9,10])]))),opaque]));
  const model = Buffer.alloc(19); model.write('4DS\0'); model.writeUInt16LE(29,4); model[18] = 1;
  const cache = chunk(500,Buffer.from([1,0,0,0]));
  return new Map([['scene2.bin',scene],['scene.4ds',model],['cache.bin',cache],...['car_table.dat','check.bin','effects.bin','road.bin','tree.klz'].map(name=>[name,Buffer.from('opaque '+name)])]);
}
const options = { name:'NEW_MISSION', model:'models/TommyHAT.4ds', position:[1,2,3], heading:90, sun:1.5, ambient:.7, initializePolice:false };
test('empty mission edits only selected template fields, leaves other files and opaque bytes intact', () => {
  const original = template(), before = new Map([...original].map(([name,data])=>[name,Buffer.from(data)])), result = configureEmptyMission(original, options);
  const scene = inspectScene(result.get('scene2.bin'));
  for (const name of ['start','Tommy']) { const object = scene.objects.find(o=>o.name===name); assert.deepEqual(object.position,[1,2,3]); assert.ok(Math.abs(object.rotation[0] - Math.SQRT1_2) < 1e-6); assert.ok(Math.abs(object.rotation[2] - Math.SQRT1_2) < 1e-6); }
  assert.equal(scene.objects.find(o=>o.name==='Tommy').model,'TommyHAT.i3d');
  assert.deepEqual(scene.entries.filter(e=>e.label==='Síla světla').map(e=>Math.round(e.value*10)/10),[1.5,.7]);
  assert.equal(scene.entries.find(e=>e.kind==='script').value.code,''); assert.ok(result.get('scene2.bin').includes(Buffer.from([9,10])));
  assert.ok(result.get('scene2.bin').subarray(-10).equals(original.get('scene2.bin').subarray(-10)));
  for (const [name,data] of original) { assert.deepEqual(data,before.get(name)); if(name!=='scene2.bin') assert.deepEqual(result.get(name),data); }
  const standard = inspectScene(configureEmptyMission(original,{...options,initializePolice:true}).get('scene2.bin'));
  assert.equal(standard.entries.find(e=>e.kind==='script').value.code,'policemanager_on\n');
});
test('mission creation rejects ambiguous names, invalid configuration and unreviewed archives', () => {
  for(const name of ['../escape','a/b','wbtest','CON','NUL','česká','']) assert.throws(()=>missionName(name));
  assert.equal(missionName('Mise-1'),'Mise-1');
  for(const change of [{position:[NaN,0,0]},{position:[0,0]},{heading:Infinity},{model:'models/../Game.exe'},{sun:-1},{ambient:11},{initializePolice:'yes'}]) assert.throws(()=>configureEmptyMission(template(),{...options,...change}));
  assert.throws(()=>readEmptyMissionZip(Buffer.from('not an archive')),/ověřené šabloně/);
});
