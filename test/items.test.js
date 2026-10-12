import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import iconv from 'iconv-lite';
import { parseItems, editItems } from '../src/core/items.js';
import { ModProject } from '../src/core/project.js';
import { hash, writeSafe } from '../src/core/files.js';

function fixture() {
  const bytes = Buffer.alloc(188 * 2, 0xa5);
  for (let index = 0; index < 2; index++) {
    const start = index * 188;
    bytes.fill(0, start, start + 32); iconv.encode(index ? 'Český klíč' : 'Pistol', 'windows-1250').copy(bytes, start);
    bytes.fill(0, start + 36, start + 68); bytes.write('weapon.i3d', start + 36);
    bytes.writeUInt32LE(0x80000002, start + 32);
    for (const [offset, value] of [[76,-1],[84,10],[88,11],[92,1],[96,7],[100,35]]) bytes.writeInt32LE(value, start + offset);
    for (const [offset, value] of [[116,90],[120,55],[132,.2],[136,.97]]) bytes.writeFloatLE(value, start + offset);
  }
  return bytes;
}
test('PC item records preserve every byte on no-op and modify only selected field spans', () => {
  const source = fixture(), before = Buffer.from(source), parsed = parseItems(source);
  assert.equal(parsed.records.length,2); assert.equal(parsed.records[1].name,'Český klíč'); assert.equal(parsed.records[0].flags,0x80000002);
  assert.deepEqual(editItems(source,parsed.records.flatMap(r=>r.entries.map(({id,value})=>({id,value})))),source);
  const edited = editItems(source,[{id:'0/magazine',value:9},{id:'0/damage',value:72},{id:'1/name',value:'Malý klíč'}]);
  const actual = parseItems(edited); assert.equal(actual.records[0].magazine,9); assert.equal(actual.records[0].damage,72); assert.equal(actual.records[1].name,'Malý klíč');
  for(let i=0;i<source.length;i++) if(!(i>=96&&i<100)&&!(i>=120&&i<124)&&!(i>=188&&i<=188+iconv.encode('Malý klíč','windows-1250').length)) assert.equal(edited[i],source[i],`byte ${i}`);
  assert.deepEqual(source,before);
  const restored = editItems(edited,[{id:'0/magazine',value:7},{id:'0/damage',value:55}]); assert.deepEqual(restored.subarray(0,188),source.subarray(0,188));
});
test('items refuse invalid lengths, unterminated strings, unknown IDs, duplicate edits and invalid values', () => {
  const source = fixture(); assert.throws(()=>parseItems(source.subarray(0,-1)),/188/); assert.throws(()=>parseItems(Buffer.alloc(0)),/188/);
  const broken=Buffer.from(source); broken.fill(65,36,68); assert.throws(()=>parseItems(broken),/ukončení/);
  const badFloat=Buffer.from(source); badFloat.writeFloatLE(NaN,116); assert.throws(()=>parseItems(badFloat),/neplatné/);
  for(const change of [{id:'2/name',value:'X'},{id:'0/magazine',value:-1},{id:'0/magazine',value:2.5},{id:'0/reserve',value:2147483648},{id:'0/flags',value:-1},{id:'0/damage',value:1e50},{id:'0/damage',value:'10'},{id:'0/recoil',value:NaN},{id:'0/name',value:'a'.repeat(32)},{id:'0/model',value:'😀'},{id:'0/name',value:'a\0b'}]) assert.throws(()=>editItems(source,[change]));
  assert.throws(()=>editItems(source,[{id:'0/name',value:'A'},{id:'0/name',value:'B'}]),/opakovaná/);
  const result=editItems(source,[{id:'0/flags',value:4294967295},{id:'0/shootSound',value:-1}]); assert.equal(parseItems(result).records[0].flags,4294967295); assert.equal(parseItems(result).records[0].shootSound,-1);
});
test('item project edits guard stale hashes, reopen and export correctly, and undo leaves originals intact', async t => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'mafia-items-test-')); t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const source=fixture(), asset={path:'TABLES/predmety.def',original:'originals/a1/TABLES/predmety.def',sha256:hash(source),archive:'a1.dta',size:source.length,variants:[{}]};
  await writeSafe(root,asset.original,source); await writeSafe(root,'workbench.json',JSON.stringify({format:'mafia-workbench',version:1,name:'Items',assets:[asset],history:[]}));
  const project=await ModProject.open(root), inspected=await project.inspect(asset.path); assert.equal(inspected.type,'items');
  await assert.rejects(project.saveItems(asset.path,[{id:'0/magazine',value:9}],'0'.repeat(64)),/změnil/); assert.equal(project.manifest.history.length,0);
  await project.saveItems('tables/PREDMETY.def',[{id:'0/magazine',value:9},{id:'0/model',value:'jiná.i3d'}],inspected.sha256);
  const reopened=await ModProject.open(root); assert.equal((await reopened.inspect(asset.path)).records[0].magazine,9);
  await assert.rejects(reopened.saveItems(asset.path,[{id:'0/magazine',value:10}],inspected.sha256),/změnil/);
  await reopened.export(path.join(root,'export')); assert.deepEqual(await fs.readFile(path.join(root,'export',asset.path)),await reopened.read(asset.path));
  assert.deepEqual(await fs.readFile(path.join(root,asset.original)),source); await reopened.undo(); assert.deepEqual(await reopened.read(asset.path),source);
  await fs.rm(path.join(root,'mods',asset.path));
  await fs.writeFile(path.join(root,asset.original),source.subarray(0,-1)); asset.sha256=hash(source.subarray(0,-1)); await writeSafe(root,'workbench.json',JSON.stringify({...project.manifest,history:[],assets:[asset]}));
  const malformed=await ModProject.open(root); assert.equal((await malformed.inspect(asset.path)).type,'binary'); assert.match((await malformed.inspect(asset.path)).warning,/188/);
});
