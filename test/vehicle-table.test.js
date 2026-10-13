import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { vehicleFields } from '../src/shared/vehicle-parameters.js';
import { inspectVehicleTable, editVehicleTable } from '../src/core/vehicle-table.js';
import { parseVehicleTable } from '../src/core/vehicles.js';
import { ModProject } from '../src/core/project.js';
import { hash, writeSafe } from '../src/core/files.js';

function block(boost=false){
  const bytes=Buffer.alloc(0x1121,0xa5),values={mass:1500,power:boost?100:50,powerFactor:80,redline:3000,maxRPM:3300,idleRPM:800,bandLowRPM:1500,bandHighRPM:2800,shiftLowRPM:1000,shiftHighRPM:1000,firstGearRPM:2600,gears:2,tank:60,consumption:20};
  for(const field of vehicleFields){
    const match=/^gear(\d+)(Ratio|Up|Down)$/.exec(field.key);
    const value=match?(Number(match[1])<=2?match[2]==='Ratio'?12:Number(match[1])===0?0:match[2]==='Up'?80:20:0):values[field.key]??(field.max===1?.5:1);
    bytes.writeFloatLE(value,field.offset);
  }
  return bytes;
}
function fixture(unsupported=false){
  const header=Buffer.alloc(8);header.writeUInt32LE(1);header.writeUInt32LE(2,4);
  const records=[['testcar',[block(),block(true)]],['othercar',[unsupported?Buffer.from([1,2,3]):block()]]].map(([name,levels])=>{
    const record=Buffer.alloc(40);record.write(name,4);record.writeUInt32LE(levels.length,36);
    const bytes=Buffer.concat([record,...levels.flatMap(level=>{const size=Buffer.alloc(4);size.writeUInt32LE(level.length);return [size,level];})]);bytes.writeUInt32LE(bytes.length-4);return bytes;
  });return Buffer.concat([header,...records]);
}
test('vehicle edits preserve untouched bytes, other cars and normal/boost levels independently',()=>{
  const source=fixture(),before=Buffer.from(source),parsed=inspectVehicleTable(source),entries=parsed.records.flatMap(record=>record.levels.flatMap(level=>level.entries));
  assert.equal(parsed.records.length,2);assert.equal(parsed.records[0].levels.length,2);
  assert.deepEqual(editVehicleTable(source,entries.map(({id,value})=>({id,value}))),source);
  const changes=[{id:'0/0/power',value:70},{id:'0/1/gear2Up',value:92},{id:'1/0/tank',value:90}],edited=editVehicleTable(source,changes),spans=changes.map(change=>entries.find(entry=>entry.id===change.id).offset);
  for(let i=0;i<source.length;i++)if(!spans.some(start=>i>=start&&i<start+4))assert.equal(edited[i],source[i],`byte ${i}`);
  const actual=inspectVehicleTable(edited);assert.equal(actual.records[0].levels[0].entries.find(entry=>entry.key==='power').value,70);assert.equal(actual.records[0].levels[1].entries.find(entry=>entry.key==='power').value,100);
  assert.deepEqual(editVehicleTable(edited,changes.map(change=>({id:change.id,value:entries.find(entry=>entry.id===change.id).value}))),source);assert.deepEqual(source,before);
  assert.deepEqual(parseVehicleTable(edited).entries,parseVehicleTable(source).entries);
});
test('disk gear triples and floating gear counts are distinct from the reordered runtime structure',()=>{
  const source=fixture(),base=52;source.writeFloatLE(4,base+0x4c);
  for(let gear=0;gear<=10;gear++){source.writeFloatLE(10+gear,base+0x50+gear*12);source.writeFloatLE(60+gear,base+0x54+gear*12);source.writeFloatLE(20+gear,base+0x58+gear*12);}
  const entries=inspectVehicleTable(source).records[0].levels[0].entries;
  assert.equal(entries.find(e=>e.key==='gears').value,4);
  const changes=[];
  for(let gear=0;gear<=10;gear++)for(const [suffix,initial] of [['Ratio',10],['Up',60],['Down',20]]){
    const field=entries.find(e=>e.key===`gear${gear}${suffix}`);assert.equal(field.value,initial+gear);changes.push({id:field.id,value:initial+gear+1});
  }
  changes.push({id:'0/0/gears',value:5});const expected=Buffer.from(source);expected.writeFloatLE(5,base+0x4c);
  for(let gear=0;gear<=10;gear++){expected.writeFloatLE(11+gear,base+0x50+gear*12);expected.writeFloatLE(61+gear,base+0x54+gear*12);expected.writeFloatLE(21+gear,base+0x58+gear*12);}
  assert.deepEqual(editVehicleTable(source,changes),expected);
});
test('unsupported level sizes and nonfinite fields stay intact while supported fields remain editable',()=>{
  const source=fixture(true),table=inspectVehicleTable(source);assert.match(table.records[1].levels[0].warning,/Nepodporované/);assert.equal(table.records[1].levels[0].entries.length,0);
  const edited=editVehicleTable(source,[{id:'0/1/power',value:110}]),other=parseVehicleTable(source).entries[1];assert.deepEqual(edited.subarray(other.offset,other.offset+other.length),source.subarray(other.offset,other.offset+other.length));
  assert.throws(()=>editVehicleTable(source,[{id:'1/0/power',value:10}]),/neznámý/);
  const nan=Buffer.from(source),offset=table.records[0].levels[0].entries.find(entry=>entry.key==='power').offset;nan.writeUInt32LE(0x7fc01234,offset);
  const entry=inspectVehicleTable(nan).records[0].levels[0].entries.find(entry=>entry.key==='power');assert.equal(entry.readOnly,true);assert.equal(entry.value,null);
  assert.throws(()=>editVehicleTable(nan,[{id:entry.id,value:70}]),/pouze ke čtení/);const change=editVehicleTable(nan,[{id:'0/0/tank',value:70}]);assert.equal(change.readUInt32LE(offset),0x7fc01234);
});
test('vehicle writer rejects stale layouts, invalid IDs, float overflow, gear and RPM inconsistencies',()=>{
  const source=fixture();assert.throws(()=>inspectVehicleTable(source.subarray(0,-1)));assert.throws(()=>editVehicleTable(source,null));
  for(const change of [{id:'9/0/power',value:60},{id:'0/2/power',value:60},{id:'0/0/power',value:'60'},{id:'0/0/power',value:NaN},{id:'0/0/power',value:Infinity},{id:'0/0/power',value:1e50},{id:'0/0/power',value:1e-50},{id:'0/0/power',value:-1},{id:'0/0/gears',value:2.5},{id:'0/0/gears',value:11},{id:'0/0/gears',value:3},{id:'0/0/gear1Ratio',value:0},{id:'0/0/gear2Up',value:101},{id:'0/0/massX',value:2},{id:'0/0/maxRPM',value:2900},{id:'0/0/bandHighRPM',value:3100},{id:'0/0/firstGearRPM',value:4000},{id:'0/0/shiftLowRPM',value:2800}])assert.throws(()=>editVehicleTable(source,[change]),change.id);
  assert.throws(()=>editVehicleTable(source,[{id:'0/0/power',value:60},{id:'0/0/power',value:70}]),/opakovaná/);
  const result=editVehicleTable(source,[{id:'0/0/gears',value:3},{id:'0/0/gear3Ratio',value:4},{id:'0/0/redline',value:3500},{id:'0/0/maxRPM',value:4000},{id:'0/0/bandHighRPM',value:3400}]);assert.equal(inspectVehicleTable(result).records[0].levels[0].entries.find(entry=>entry.key==='gears').value,3);
});
test('vehicle project edits guard hashes, export both levels, reopen and undo without changing originals',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'mafia-vehicle-table-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const source=fixture(),asset={path:'TABLES/vehicles.bin',original:'originals/a1/TABLES/vehicles.bin',sha256:hash(source),archive:'a1.dta',size:source.length,variants:[{}]};
  await writeSafe(root,asset.original,source);await writeSafe(root,'workbench.json',JSON.stringify({format:'mafia-workbench',version:1,name:'Vehicles',assets:[asset],history:[]}));
  const project=await ModProject.open(root),inspected=await project.inspect(asset.path);assert.equal(inspected.type,'vehicles');
  await assert.rejects(project.saveVehicles(asset.path,[{id:'0/0/power',value:70}],'0'.repeat(64)),/změnil/);await assert.rejects(project.saveVehicles('tables/other.bin',[],inspected.sha256),/tabulka vozidel/);assert.equal(project.manifest.history.length,0);
  await project.saveVehicles('tables/VEHICLES.bin',[{id:'0/0/power',value:70},{id:'0/1/power',value:140}],inspected.sha256);
  const reopened=await ModProject.open(root),modified=await reopened.inspect(asset.path);assert.equal(modified.records[0].levels[1].entries.find(entry=>entry.key==='power').value,140);
  await assert.rejects(reopened.saveVehicles(asset.path,[{id:'0/0/power',value:80}],inspected.sha256),/změnil/);
  await reopened.export(path.join(root,'export'));assert.deepEqual(await fs.readFile(path.join(root,'export',asset.path)),await reopened.read(asset.path));assert.deepEqual(await fs.readFile(path.join(root,asset.original)),source);
  await reopened.undo();assert.deepEqual(await reopened.read(asset.path),source);assert.equal(reopened.manifest.history.length,0);
});
