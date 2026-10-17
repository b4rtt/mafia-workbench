import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCollision} from '../src/core/collision.js';
import {replaceCollisionSurfaces,collisionTriangleVertices} from '../src/core/collision-surfaces.js';
import {collisionFixture} from './fixtures/collision.js';

const wall={name:'wall',frame:'House.Wall',positions:[2,0,2,2,3,2,2,0,4],indices:[0,1,2],material:7};
const resolver=surfaces=>(name,indices)=>{
  const surface=surfaces.find(s=>s.frame.toLowerCase()===name.toLowerCase());
  assert.ok(surface,`Unexpected frame ${name}`);
  return indices.map(i=>surface.positions.slice(i*3,i*3+3));
};

test('frame surfaces preserve native buffers and gaps, address the first LOD and share case-insensitive links',()=>{
  const before=collisionFixture(),original=parseCollision(before),surfaces=[wall,{...wall,name:'back',frame:'house.wall',doubleSided:false}],resolveFrame=resolver(surfaces);
  const result=replaceCollisionSurfaces(before,surfaces,{resolveFrame}),parsed=parseCollision(result.bytes);
  assert.equal(parsed.vertexCount,original.vertexCount);assert.deepEqual(parsed.extraVertices,original.extraVertices);
  assert.equal(parsed.links.length,2);assert.equal(parsed.links[1].name,wall.frame);assert.equal(parsed.links[1].type,1);
  assert.deepEqual(parsed.bytes.subarray(24+parsed.links.length*4,parsed.links[1].offset),before.subarray(28,original.gridOffset));
  for(const [name,array]of Object.entries(original.primitives))assert.deepEqual(parsed.primitives[name].raw.subarray(0,array.raw.length),array.raw);
  assert.deepEqual(parsed.links[0].raw,original.links[0].raw);assert.deepEqual(parsed.tail,original.tail);
  assert.deepEqual(result.groups.map(g=>[g.frame,g.vertexCount,g.triangleStart,g.triangleCount]),[[wall.frame,0,1,2],['house.wall',0,3,1]]);
  const front=parsed.primitives.triangles.records[1],back=parsed.primitives.triangles.records[2];
  assert.ok(front.vertices.every(v=>v.link===1));assert.deepEqual(front.vertices.map(v=>v.index).sort(),[0,1,2]);
  assert.deepEqual(collisionTriangleVertices(parsed,front,resolveFrame),[[2,0,2],[2,3,2],[2,0,4]]);
  assert.deepEqual(back.plane.map(n=>n||0),front.plane.map(n=>-n||0));assert.notEqual(front.sort,back.sort);
  assert.equal(front.material,7);assert.equal(parsed.cells[0].header.readFloatLE(12),3);
  assert.deepEqual(parsed.cells[0].references.slice(0,6),original.cells[0].references);
  assert.deepEqual(before,collisionFixture());
});

test('independent frame buffers exceed the aggregate world index limit without duplicating world vertices',()=>{
  const surfaces=Array.from({length:2},(_,part)=>{
    const positions=[],indices=[];
    for(let i=0;i<12000;i++){const x=part*8+(i%100)/100,z=Math.floor(i/100)/100,at=positions.length/3;positions.push(x,4,z,x+.004,4,z,x,4,z+.004);indices.push(at,at+1,at+2);}
    return {name:`part ${part}`,frame:`City.Part${part}`,positions,indices,doubleSided:false};
  });
  assert.equal(surfaces.reduce((n,s)=>n+s.positions.length/3,0),72000);
  const resolveFrame=resolver(surfaces),result=replaceCollisionSurfaces(collisionFixture(),surfaces,{resolveFrame}),parsed=parseCollision(result.bytes);
  assert.equal(parsed.vertexCount,3);assert.equal(parsed.primitives.triangles.count,24001);
  for(const [i,g]of result.groups.entries()){
    const last=parsed.primitives.triangles.records[g.triangleStart+g.triangleCount-1];
    assert.ok(last.vertices.every(v=>v.link===i+1));assert.ok(last.vertices.some(v=>v.index===35999));
    assert.deepEqual(collisionTriangleVertices(parsed,last,resolveFrame).map(p=>p.map(Math.fround)),last.vertices.map(v=>surfaces[i].positions.slice(v.index*3,v.index*3+3).map(Math.fround)));
  }
  assert.throws(()=>replaceCollisionSurfaces(collisionFixture(),surfaces.map(({frame,...s})=>s)),/65 536 světových/);
});

test('mixed frame/world replacement preserves foreign framed records and reuses links',()=>{
  const before=collisionFixture(),surfaces=[wall],resolveFrame=resolver(surfaces),first=replaceCollisionSurfaces(before,[wall,{...wall,name:'world',frame:undefined}],{resolveFrame});
  const original=parseCollision(first.bytes),second=replaceCollisionSurfaces(first.bytes,[{...wall,name:'another'}],{removedIndices:[3,4],removedVertexIndices:[3,4,5],resolveFrame}),parsed=parseCollision(second.bytes);
  assert.equal(parsed.links.length,2);assert.equal(parsed.vertexCount,3);
  assert.deepEqual(parsed.primitives.triangles.raw.subarray(0,96),original.primitives.triangles.raw.subarray(0,96));
  const deleted=parseCollision(replaceCollisionSurfaces(second.bytes,[],{removedIndices:[1,2,3,4]}).bytes);
  assert.equal(deleted.primitives.triangles.count,1);assert.deepEqual(deleted.extraVertices,parseCollision(before).extraVertices);
  assert.ok(deleted.cells.every(c=>c.references.every(r=>r.type!==0||r.index===0)));
  // Type 3 also occurs on original game triangle links; never rewrite it.
  const type3=Buffer.from(first.bytes);type3.writeUInt32LE(3,original.links[1].offset);
  assert.equal(parseCollision(replaceCollisionSurfaces(type3,[wall],{resolveFrame}).bytes).links[1].type,3);
});

test('frame output handles high local indices with a full world pool and expands spatial cells in native X order',()=>{
  const before=collisionFixture(),p=parseCollision(before),at=p.primitives.spheres.start+p.primitives.spheres.raw.length+p.extraVertices.length;
  const full=Buffer.concat([before.subarray(0,at),Buffer.alloc((65536-p.vertexCount)*12),before.subarray(at)]);full.writeUInt32LE(65536,p.gridOffset+0x60);
  const positions=Array(65535*3).fill(0);positions.splice(65532*3,9,-5,7,22,-5,4,22,-5,4,23);
  const surface={...wall,frame:'Dům.Zábradlí',positions,indices:[65532,65533,65534]},resolveFrame=resolver([surface]),result=replaceCollisionSurfaces(full,[surface],{resolveFrame}),parsed=parseCollision(result.bytes);
  assert.equal(parsed.vertexCount,65536);assert.deepEqual(parsed.extraVertices,parseCollision(full).extraVertices);
  assert.equal(parsed.grid.minX,-10);assert.equal(parsed.grid.maxZ,30);assert.equal(parsed.links.at(-1).name,surface.frame);
  const record=parsed.primitives.triangles.records[result.groups[0].triangleStart];assert.ok(record.vertices.some(v=>v.index===65534));
  const cells=parsed.cells.filter(c=>c.references.some(r=>r.type===0&&r.index>=1));assert.ok(cells.length);assert.ok(cells.every(c=>c.header.readFloatLE(12)>=7));
  const surfaces=[{...wall,positions:wall.positions.map((v,i)=>i%3===0?-.5:v),frame:'Left'},wall],resolve=resolver(surfaces);
  const overlapping=parseCollision(replaceCollisionSurfaces(collisionFixture(),surfaces,{resolveFrame:resolve}).bytes);
  for(const cell of overlapping.cells){const x=cell.references.filter(r=>r.type===0).map(r=>collisionTriangleVertices(overlapping,overlapping.primitives.triangles.records[r.index],resolve)[0][0]);assert.deepEqual(x,[...x].sort((a,b)=>a-b));}
});

test('invalid frame bindings, unresolved or mismatched LOD buffers fail before returning changed bytes',()=>{
  const before=collisionFixture(),resolveFrame=resolver([wall]);
  for(const frame of ['',null,3,'old','x\0y','😀','x'.repeat(256)])assert.throws(()=>replaceCollisionSurfaces(before,[{...wall,frame}],{resolveFrame}),/KLZ/);
  for(const resolveFrame of [undefined,()=>[],()=>[[2,0,2],[2,4,2],[2,0,4]],()=>[[2,0,2],[2,3,2],[2,0,Infinity]]])assert.throws(()=>replaceCollisionSurfaces(before,[wall],{resolveFrame}),/prvnímu LOD/);
  assert.throws(()=>replaceCollisionSurfaces(before,[{...wall,positions:Array(65537*3).fill(0)}],{resolveFrame}),/65 536 vrcholů/);
  const source=parseCollision(replaceCollisionSurfaces(before,[wall],{resolveFrame}).bytes),duplicate=Buffer.from(source.bytes);
  duplicate.writeUInt32LE(source.links[1].offset,24);
  assert.throws(()=>replaceCollisionSurfaces(duplicate,[wall],{resolveFrame}),/nejednoznačný/);
  assert.deepEqual(before,collisionFixture());
});
