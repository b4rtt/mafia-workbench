import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {parseBmp,editBmp} from '../src/core/bmp.js';
import {BitmapDraft} from '../src/shared/bitmap-draft.js';
import {ModProject} from '../src/core/project.js';
import {hash,writeSafe} from '../src/core/files.js';
function fixture(bits,topDown=false){
  const width=3,height=2,count=bits===8?4:0,offset=54+count*4+7,stride=Math.ceil(width*bits/32)*4,data=Buffer.alloc(offset+height*stride+9,0xa5);
  data.write('BM');data.writeUInt32LE(data.length,2);data.writeUInt32LE(offset,10);data.writeUInt32LE(40,14);data.writeInt32LE(width,18);data.writeInt32LE(topDown?-height:height,22);data.writeUInt16LE(1,26);data.writeUInt16LE(bits,28);data.writeUInt32LE(0,30);data.writeUInt32LE(0,34);data.writeUInt32LE(count,46);
  for(let i=0;i<count;i++){data[54+i*4]=10+i;data[55+i*4]=20+i;data[56+i*4]=30+i;}
  const bpp=bits/8;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){const at=offset+(topDown?y:height-1-y)*stride+x*bpp,index=y*width+x;if(bits===8)data[at]=index%count;else{data[at]=index+10;data[at+1]=index+20;data[at+2]=index+30;if(bits===32)data[at+3]=index*40;}}
  return data;
}
test('BMP edits retain orientation, stride padding, reserved palette bytes and unknown tails for all installed variants',()=>{
  for(const bits of [8,24,32])for(const topDown of [false,true]){
    const source=fixture(bits,topDown),snapshot=Buffer.from(source),b=parseBmp(source);assert.deepEqual([b.width,b.height,b.bits,b.topDown],[3,2,bits,topDown]);
    const unchanged={pixels:Array.from({length:6},(_,index)=>({index,value:bits===8?b.pixels[index]:Array.from(b.pixels.subarray(index*b.channels,(index+1)*b.channels))})),palette:b.palette.map((color,index)=>({index,color}))};
    assert.deepEqual(editBmp(source,unchanged),source);
    const value=bits===8?3:bits===32?[41,42,43,44]:[41,42,43],changes={pixels:[{index:0,value}],palette:bits===8?[{index:1,color:[50,60,70]}]:[]},result=editBmp(source,changes),actual=parseBmp(result);
    assert.deepEqual(bits===8?actual.pixels[0]:Array.from(actual.pixels.subarray(0,b.channels)),value);
    const at=b.offset+(topDown?0:1)*b.stride,allowed=new Set(Array.from({length:b.channels},(_,i)=>at+i));if(bits===8)for(const i of [58,59,60])allowed.add(i);
    for(let i=0;i<source.length;i++)if(!allowed.has(i))assert.equal(result[i],source[i],`unexpected byte ${i}`);
    assert.deepEqual(editBmp(result,{pixels:[unchanged.pixels[0]],palette:bits===8?[unchanged.palette[1]]:[]}),source);assert.deepEqual(source,snapshot);
    if(bits===32)assert.deepEqual(Array.from(b.pixels.subarray(0,4)),[30,20,10,0]);
  }
});
test('BMP rejects unsupported headers, compression, invalid dimensions, missing data and edits without publishing output',()=>{
  const source=fixture(8);
  for(const [at,value]of [[14,12],[30,1],[18,0],[22,0],[46,257],[10,1],[18,100000]]){const bad=Buffer.from(source);bad.writeUInt32LE(value,at);assert.throws(()=>parseBmp(bad),/BMP/);}
  const bad=Buffer.from(source);bad.writeUInt16LE(16,28);assert.throws(()=>parseBmp(bad));assert.throws(()=>parseBmp(source.subarray(0,20)));assert.throws(()=>parseBmp(source.subarray(0,-10)));
  const invalidPixel=Buffer.from(source);invalidPixel[parseBmp(source).offset]=10;assert.throws(()=>parseBmp(invalidPixel),/paletu/);
  for(const changes of [null,{}, {pixels:[{index:6,value:1}],palette:[]},{pixels:[{index:0,value:4}],palette:[]},{pixels:[{index:0,value:1},{index:0,value:2}],palette:[]},{pixels:[],palette:[{index:4,color:[0,0,0]}]},{pixels:[],palette:[{index:0,color:[0,0,256]}]},{pixels:[],palette:[{index:0,color:[0,0,0]},{index:0,color:[1,1,1]}]}])assert.throws(()=>editBmp(source,changes));
  for(const value of [[1,2],[1,2,3,4],[1,-1,3],[1,2,NaN],['1',2,3]])assert.throws(()=>editBmp(fixture(24),{pixels:[{index:1,value}],palette:[]}));
});
test('texture drafts group strokes, undo/redo palette edits, remove no-op edits and preserve alpha and colour-key preview semantics',()=>{
  const b=parseBmp(fixture(8)),edits=new Map(),draft=new BitmapDraft(b,edits);
  draft.begin();draft.set('pixel',0,2);draft.set('pixel',0,3);draft.set('pixel',1,3);draft.end();assert.equal(draft.undo.length,1);assert.equal(edits.size,2);
  draft.step();assert.equal(edits.size,0);draft.step(true);assert.equal(draft.value('pixel',0),3);
  draft.begin();draft.set('palette',3,b.palette[0]);draft.end();const keyed=draft.rgba('key');assert.equal(keyed[3],0);assert.equal(keyed[7],0);assert.equal(draft.rgba()[3],255);
  assert.deepEqual(draft.changes().palette,[{index:3,color:b.palette[0]}]);draft.step();assert.equal(draft.value('palette',3)[0],33);draft.step();assert.equal(edits.size,0);
  draft.begin();draft.set('pixel',0,1);draft.set('pixel',0,0);draft.end();assert.equal(draft.undo.length,0);assert.equal(edits.size,0);
  const alpha=new BitmapDraft(parseBmp(fixture(32)));assert.equal(alpha.rgba('alpha')[3],0);assert.equal(alpha.rgba()[3],255);alpha.begin();alpha.set('pixel',0,[12,13,14,42]);alpha.end();assert.equal(alpha.rgba('alpha')[3],42);
  const changed=editBmp(fixture(32),alpha.changes());assert.equal(parseBmp(changed).pixels[3],42);
});
test('BMP project save guards stale data, exports original formats, reopens and undoes all installed bit depths',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'mafia-bmp-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const sources=[8,24,32].map(bits=>({name:`maps/${bits}.bmp`,bytes:fixture(bits)})),assets=sources.map(({name,bytes})=>({path:name,original:`originals/a1/${name}`,sha256:hash(bytes),size:bytes.length,archive:'a1.dta',variants:[{}]}));
  for(let i=0;i<assets.length;i++)await writeSafe(root,assets[i].original,sources[i].bytes);await writeSafe(root,'workbench.json',JSON.stringify({format:'mafia-workbench',version:1,name:'BMP',assets,history:[]}));
  let p=await ModProject.open(root);
  for(const {name,bytes}of sources){const file=await p.inspect(name),value=file.bitmap.bits===8?1:file.bitmap.bits===32?[91,92,93,94]:[91,92,93],changes={pixels:[{index:2,value}],palette:[]};assert.equal(file.type,'image');
    await assert.rejects(p.saveBitmap(name,changes,'0'.repeat(64)),/změnil/);await p.saveBitmap(name,changes,file.sha256);assert.deepEqual(await p.read(name),editBmp(bytes,changes));await assert.rejects(p.saveBitmap(name,changes,file.sha256),/změnil/);
  }
  p=await ModProject.open(root);await p.export(path.join(root,'export'));
  for(let i=0;i<sources.length;i++){assert.deepEqual(await fs.readFile(path.join(root,'export',sources[i].name)),await p.read(sources[i].name));assert.deepEqual(await fs.readFile(path.join(root,assets[i].original)),sources[i].bytes);}
  for(let i=0;i<3;i++)await p.undo();for(const {name,bytes}of sources)assert.deepEqual(await p.read(name),bytes);assert.equal(p.manifest.history.length,0);
  await p.saveBitmap(sources[0].name,{pixels:[],palette:[]},hash(sources[0].bytes));assert.equal(p.manifest.history.length,0);
  const malformed=fixture(8);malformed.writeUInt32LE(1,30);await p.change(sources[0].name,malformed);const result=await p.inspect(sources[0].name);assert.equal(result.type,'image');assert.equal(result.bitmap,undefined);assert.match(result.warning,/nekomprimované/);
});
