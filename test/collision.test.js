import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCollision, appendCollisionBoxes } from '../src/core/collision.js';

import { collisionFixture as fixture } from './fixtures/collision.js';

test('new box heights update the cell rejection bound without lowering existing collision bounds',()=>{
  const bytes=fixture(),p=parseCollision(bytes),offset=p.cells[0].raw.byteOffset-p.bytes.byteOffset;bytes.writeFloatLE(50,offset+12);
  const q=parseCollision(appendCollisionBoxes(bytes,[{name:'low',min:[1,0,1],max:[2,3,2]},{name:'high',min:[11,0,11],max:[12,8,12]}]));
  assert.equal(q.cells[0].header.readFloatLE(12),50);assert.equal(q.cells[3].header.readFloatLE(12),8);assert.deepEqual(q.cells[1].raw,p.cells[1].raw);
});

test('removing an owned AABB remaps later references without touching other primitives, links or cell flags',()=>{
  const first=appendCollisionBoxes(fixture(),[{name:'one',min:[1,0,1],max:[2,1,2]},{name:'two',min:[11,0,11],max:[12,1,12]}]),p=parseCollision(first),result=appendCollisionBoxes(first,[],[1]),q=parseCollision(result);
  assert.equal(q.primitives.aabbs.count,2);assert.deepEqual(q.primitives.aabbs.records[1].raw,p.primitives.aabbs.records[2].raw);
  for(const name of ['triangles','xtobbs','cylinders','obbs','spheres'])assert.deepEqual(q.primitives[name].raw,p.primitives[name].raw);
  assert.deepEqual(q.cells[3].references,[{type:0x81,index:1,flag:0}]);assert.deepEqual(q.cells[0].references,parseCollision(fixture()).cells[0].references);
  assert.deepEqual(q.cells[1].raw,p.cells[1].raw);assert.deepEqual(q.extraVertices,p.extraVertices);assert.deepEqual(q.links.map(l=>l.raw),p.links.map(l=>l.raw));assert.deepEqual(q.tail,p.tail);
  assert.deepEqual(q.cells[3].raw.subarray(20),p.cells[3].raw.subarray(20));
  const replace=parseCollision(appendCollisionBoxes(first,[{name:'one',min:[2,0,2],max:[3,1,3]}],[1]));assert.equal(replace.primitives.aabbs.count,3);assert.deepEqual(replace.primitives.aabbs.records[1].raw,p.primitives.aabbs.records[2].raw);
  for(const removal of [[-1],[3],[1,1],[.5]])assert.throws(()=>appendCollisionBoxes(first,[],removal),/odstraňovaných/);
});

test('KLZ v5 parses every primitive array, relative cell references and extra triangle vertices',()=>{
  const bytes=fixture(),p=parseCollision(bytes);
  assert.equal(p.links[0].name,'old');assert.equal(p.gridOffset,52);assert.equal(p.vertexCount,3);assert.equal(p.cells.length,4);
  assert.deepEqual(p.primitives.triangles.records[0].vertices,[{index:0,link:0x7fff},{index:1,link:0x7fff},{index:2,link:0x7fff}]);
  assert.deepEqual(p.primitives.aabbs.records[0].min,[1,2,3]);assert.deepEqual(p.primitives.aabbs.records[0].max,[4,5,6]);
  assert.deepEqual(p.cells[0].references.map(r=>[r.type,r.index,r.flag]),[[0x81,0,1],[0x80,0,2],[0x84,0,3],[0x83,0,4],[0x82,0,5],[0,0,6]]);
  assert.equal(p.tail.toString(),'opaque tail');assert.deepEqual(appendCollisionBoxes(bytes,[]),bytes);
});

test('adding boxes expands XZ cells, uses array-relative offsets and retains all existing data',()=>{
  const before=fixture(),p=parseCollision(before),after=appendCollisionBoxes(before,[{name:'new',min:[-5,0,5],max:[5,2,15],material:7},{name:'new',min:[21,1,1],max:[29,4,9]}]),q=parseCollision(after);
  assert.equal(q.links.length,2);assert.equal(q.links[1].name,'new');assert.equal(q.links[1].type,2);assert.equal(q.links[0].offset,p.links[0].offset+4);
  assert.deepEqual(after.subarray(32,q.links[1].offset),before.subarray(28,p.gridOffset)); // opaque gaps and name padding
  assert.deepEqual(q.grid.x,[-10,0,10,20,30]);assert.deepEqual(q.grid.z,[0,10,20]);assert.equal(q.primitives.aabbs.count,3);
  for(const [name,array] of Object.entries(p.primitives))assert.deepEqual(q.primitives[name].raw.subarray(0,array.raw.length),array.raw);
  assert.deepEqual(q.extraVertices,p.extraVertices);assert.deepEqual(q.tail,p.tail);assert.deepEqual(q.separator,p.separator);assert.deepEqual(q.cellSeparator,p.cellSeparator);
  assert.deepEqual(q.cells[1].references.slice(1),p.cells[0].references);assert.deepEqual(q.cells[1].header.subarray(4,12),p.cells[0].header.subarray(4,12));assert.equal(q.cells[1].header.readFloatLE(12),2);
  assert.deepEqual(q.cells[2].raw,p.cells[1].raw);assert.deepEqual(q.cells[6].raw,p.cells[3].raw);
  assert.deepEqual(q.cells.filter(c=>c.references.some(r=>r.type===0x81&&r.index===1)).map(c=>c.index),[0,1,4,5]);
  assert.deepEqual(q.cells.filter(c=>c.references.some(r=>r.type===0x81&&r.index===2)).map(c=>c.index),[3]);
  assert.equal(q.primitives.aabbs.records[1].material,7);assert.deepEqual(before,fixture());
  const more=parseCollision(appendCollisionBoxes(after,[{name:'new',min:[2,0,2],max:[3,1,3]}]));assert.equal(more.links.length,2);assert.equal(more.primitives.aabbs.count,4);
  const reused=parseCollision(appendCollisionBoxes(before,[{name:'OLD',min:[2,0,2],max:[3,1,3]}]));assert.equal(reused.links.length,1);assert.equal(reused.primitives.aabbs.records[1].link,0);
});

test('collision boundaries cover both adjoining cells and invalid or truncated data is rejected',()=>{
  const bytes=fixture(),p=parseCollision(bytes),q=parseCollision(appendCollisionBoxes(bytes,[{name:'edge',min:[10,0,10],max:[11,1,11]}]));
  assert.deepEqual(q.cells.filter(c=>c.references.some(r=>r.type===0x81&&r.index===1)).map(c=>c.index),[0,1,2,3]);
  for(const length of [0,23,50,155,p.primitives.spheres.start+1,bytes.length-p.tail.length-1])assert.throws(()=>parseCollision(bytes.subarray(0,length)),/KLZ/);
  for(const mutate of [b=>b.writeUInt32LE(6,4),b=>b.writeUInt32LE(999999,24),b=>b.writeUInt32LE(9,p.primitives.aabbs.start+4),b=>b.writeUInt16LE(3,p.primitives.triangles.start+4),b=>b.writeUInt32LE(0x81000001,p.cells[0].raw.byteOffset-p.bytes.byteOffset+16)]){const bad=Buffer.from(bytes);mutate(bad);assert.throws(()=>parseCollision(bad),/KLZ/);}
  for(const box of [{name:'',min:[0,0,0],max:[1,1,1]},{name:'x',min:[0,0,0],max:[0,1,1]},{name:'x',min:[0,0,0],max:[Infinity,1,1]},{name:'x',min:[0,0,0],max:[1e30,1,1]},{name:'x',min:[0,0,0],max:[1,1,1],material:256}])assert.throws(()=>appendCollisionBoxes(bytes,[box]),/KLZ/);
  const surface=Buffer.from(bytes);surface.writeUInt32LE(1,p.links[0].offset);assert.throws(()=>appendCollisionBoxes(surface,[{name:'old',min:[0,0,0],max:[1,1,1]}]),/povrchový/);
});
