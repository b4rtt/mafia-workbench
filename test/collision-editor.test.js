import test from 'node:test';
import assert from 'node:assert/strict';
import { Matrix4, Vector3 } from 'three';
import { collisionFixture } from './fixtures/collision.js';
import { parseCollision } from '../src/core/collision.js';
import { collisionTriangleVertices } from '../src/core/collision-surfaces.js';
import { editCollision, collisionRecordGeometry } from '../src/core/collision-editor.js';

const identity=new Matrix4().toArray(),move=new Matrix4().makeRotationY(Math.PI/3).setPosition(15,4,15).toArray();
const edits=[
  {array:'aabbs',changes:{min:[11,1,11],max:[13,3,13]}},
  {array:'xtobbs',changes:{extentMin:[-1,-2,-3],extentMax:[1,2,3],matrix:move}},
  {array:'obbs',changes:{extentMin:[-1,-.1,-3],extentMax:[1,.1,3],matrix:move}},
  {array:'spheres',changes:{center:[15,4,15],radius:2}},
  {array:'cylinders',changes:{center:[15,15],radius:2}},
  {array:'triangles',changes:{points:[[11,1,11],[12,3,11],[11,1,13]]}}
];
const refCells=(p,array,index)=>p.cells.filter(cell=>cell.references.some(ref=>ref.type===p.primitives[array].type&&ref.index===index));
function assertOpaque(p,q){
  assert.deepEqual(q.bytes.subarray(0,q.gridOffset),p.bytes.subarray(0,p.gridOffset));assert.deepEqual(q.separator,p.separator);assert.deepEqual(q.cellSeparator,p.cellSeparator);assert.deepEqual(q.tail,p.tail);
  assert.deepEqual(q.grid.raw.subarray(32,48),p.grid.raw.subarray(32,48));assert.deepEqual(q.grid.raw.subarray(100),p.grid.raw.subarray(100));
}

test('every native primitive can be moved, with local matrices/inverses, correct cell references and opaque data retained',()=>{
  for(const edit of edits){
    const bytes=collisionFixture(),p=parseCollision(bytes),{bytes:result}=editCollision(bytes,[{...edit,kind:'edit',index:0}]),q=parseCollision(result);
    assertOpaque(p,q);assert.deepEqual(bytes,collisionFixture());assert.deepEqual(q.cells[0].header.subarray(4,12),p.cells[0].header.subarray(4,12));
    for(const [array,original] of Object.entries(p.primitives))if(array!==edit.array)assert.deepEqual(q.primitives[array].raw,original.raw);
    assert.equal(refCells(q,edit.array,0).length,1);assert.equal(refCells(q,edit.array,0)[0].index,3);
    const record=q.primitives[edit.array].records[0],geometry=collisionRecordGeometry(q,edit.array,record);
    assert.ok(q.cells[3].header.readFloatLE(12)>=geometry.max[1]||geometry.unboundedY);assert.equal(refCells(q,edit.array,0)[0].references.find(ref=>ref.type===q.primitives[edit.array].type).flag,0);
    if(edit.array==='xtobbs'||edit.array==='obbs'){
      const m=new Matrix4().fromArray(record.matrix),inverse=new Matrix4().fromArray(record.inverse),product=m.clone().multiply(inverse).toArray();product.forEach((n,i)=>assert.ok(Math.abs(n-identity[i])<2e-6));
      if(edit.array==='obbs')assert.equal(geometry.shape,'rectangle');else for(const point of geometry.points)point.forEach((n,i)=>assert.ok(n>=record.min[i]-1e-6&&n<=record.max[i]+1e-6));
    }
    if(edit.array==='cylinders'){assert.equal(record.center.length,2);assert.equal(q.cells[3].header.readFloatLE(12),3.4028234663852886e38);}
  }
});

test('metadata edits are byte-local for all six arrays, preserve winding and leave unresolved frame-backed triangles alone',()=>{
  const bytes=collisionFixture(),p=parseCollision(bytes);bytes.writeUInt16LE(0,p.primitives.triangles.start+6);
  for(const array of Object.keys(p.primitives)){
    const q=editCollision(bytes,[{kind:'edit',array,index:0,changes:{material:19,flags:128}}]).bytes,expected=Buffer.from(bytes);expected[p.primitives[array].start+2]=128;expected[p.primitives[array].start+3]=19;assert.deepEqual(q,expected);
    assert.deepEqual(editCollision(bytes,[{kind:'edit',array,index:0,changes:{material:p.primitives[array].records[0].material}}]).bytes,bytes);
  }
  assert.deepEqual(editCollision(bytes,[]).bytes,bytes);
  const opaque=Buffer.from(bytes),cellOffset=p.cells[0].raw.byteOffset-p.bytes.byteOffset;opaque.writeUInt32LE(0x7fa12345,cellOffset+12);
  assert.equal(parseCollision(editCollision(opaque,[{kind:'delete',array:'aabbs',index:0}]).bytes).cells[0].header.readUInt32LE(12),0x7fa12345);
});

test('addition, deletion and mixed-array edits remap offsets, retain original flags and do not bind guessed frames',()=>{
  const p=parseCollision(collisionFixture()),operations=edits.map(edit=>({...edit,kind:'add',changes:{...edit.changes,...(edit.array==='triangles'?{}:{link:0}),material:17}})),first=editCollision(p.bytes,operations),q=parseCollision(first.bytes);
  assert.equal(first.added.length,6);for(const edit of edits){assert.equal(q.primitives[edit.array].count,2);assert.equal(q.primitives[edit.array].records[1].material,17);assert.deepEqual(q.primitives[edit.array].records[0].raw,p.primitives[edit.array].records[0].raw);}
  const removed=editCollision(first.bytes,edits.map(edit=>({kind:'delete',array:edit.array,index:0}))),r=parseCollision(removed.bytes);
  for(const edit of edits){assert.equal(r.primitives[edit.array].count,1);assert.deepEqual(removed.mappings[edit.array],[null,0]);assert.deepEqual(r.primitives[edit.array].raw,q.primitives[edit.array].records[1].raw);assert.equal(refCells(r,edit.array,0).length,1);}
  assert.deepEqual(r.links.map(l=>l.raw),p.links.map(l=>l.raw));assert.deepEqual(r.extraVertices,q.extraVertices);assert.deepEqual(r.cells[1].raw,q.cells[1].raw);
  const sameCell=parseCollision(editCollision(p.bytes,[{kind:'edit',array:'aabbs',index:0,changes:{max:[5,6,7]}}]).bytes);assert.equal(refCells(sameCell,'aabbs',0)[0].references.find(r=>r.type===0x81).flag,1);
  for(const array of ['aabbs','xtobbs','obbs','spheres','cylinders'])assert.throws(()=>editCollision(p.bytes,[{kind:'add',array,changes:edits.find(e=>e.array===array).changes}]),/frame/);
});

test('frame-backed triangle edits detach into world vertices without changing the model or other triangles',()=>{
  const bytes=collisionFixture(),p=parseCollision(bytes);bytes.writeUInt16LE(0,p.primitives.triangles.start+6);
  const supplied=[[1,0,1],[2,0,1],[1,0,2]],resolver=(name,indices)=>{assert.equal(name,'old');return indices.map(index=>supplied[index]);};
  const q=parseCollision(editCollision(bytes,[{kind:'edit',array:'triangles',index:0,changes:{points:supplied}}],{resolveFrame:resolver}).bytes);
  assert.equal(q.vertexCount,6);assert.equal(q.primitives.triangles.records[0].vertices[0].link,0x7fff);assert.deepEqual(q.extraVertices.subarray(0,36),p.extraVertices);
  assert.deepEqual(collisionTriangleVertices(q,q.primitives.triangles.records[0]).sort(),supplied.sort());
  const moved=supplied.map(p=>p.map((n,i)=>i===1?n+5:n)),r=parseCollision(editCollision(q.bytes,[{kind:'edit',array:'triangles',index:0,changes:{points:moved}}]).bytes);
  assert.equal(r.vertexCount,6);assert.deepEqual(r.extraVertices.subarray(0,36),p.extraVertices);assert.deepEqual(collisionTriangleVertices(r,r.primitives.triangles.records[0]).sort(),moved.sort());
  const flipped=parseCollision(editCollision(r.bytes,[{kind:'edit',array:'triangles',index:0,changes:{reverse:true}}]).bytes);
  r.primitives.triangles.records[0].plane.forEach((n,i)=>assert.equal(flipped.primitives.triangles.records[0].plane[i],-n));
  assert.throws(()=>editCollision(bytes,[{kind:'edit',array:'triangles',index:0,changes:{reverse:true}}]),/vyřešit/);
});

test('spatial reindexing covers adjoining cells and maintains native X ordering after movement and expansion',()=>{
  const before=collisionFixture(),p=parseCollision(before),q=parseCollision(editCollision(before,[{kind:'edit',array:'triangles',index:0,changes:{points:[[10,0,10],[11,0,10],[10,0,11]]}},{kind:'add',array:'triangles',changes:{points:[[.5,0,.5],[1.5,0,.5],[.5,0,1.5]]}}]).bytes);
  assert.deepEqual(refCells(q,'triangles',0).map(c=>c.index),[0,1,2,3]);assert.deepEqual(q.cells[0].references.filter(r=>r.type===0).map(r=>r.index),[1,0]);assert.equal(q.cells[0].references.find(r=>r.type===0&&r.index===0).flag,6);
  const expanded=parseCollision(editCollision(before,[{kind:'add',array:'aabbs',changes:{link:0,min:[-15,0,25],max:[-5,2,35]}}]).bytes);
  assert.deepEqual(expanded.grid.x,[-20,-10,0,10,20]);assert.deepEqual(expanded.grid.z,[0,10,20,30,40]);assert.deepEqual(expanded.cells[2].raw,p.cells[0].raw);assert.deepEqual(expanded.cells[3].raw,p.cells[1].raw);
  assert.equal(refCells(expanded,'aabbs',1).length,4);assert.deepEqual(expanded.tail,p.tail);
});

test('malformed operations, degenerate geometry and unsafe transforms fail before source bytes are changed',()=>{
  const bytes=collisionFixture(),bad=[
    {kind:'edit',array:'aabbs',index:99,changes:{}},{kind:'edit',array:'unknown',index:0,changes:{}},{kind:'edit',array:'aabbs',index:0,changes:{wat:1}},
    {kind:'edit',array:'aabbs',index:0,changes:{min:null}},{kind:'edit',array:'spheres',index:0,changes:{radius:undefined}},
    {kind:'edit',array:'aabbs',index:0,changes:{min:[1,2,3],max:[1,4,5]}},{kind:'edit',array:'aabbs',index:0,changes:{link:8}},
    {kind:'edit',array:'triangles',index:0,changes:{points:[[0,0,0],[0,0,0],[0,0,0]]}},
    {kind:'add',array:'spheres',changes:{link:0,center:[1e20,0,0],radius:1}},
    {kind:'add',array:'cylinders',changes:{link:0,center:[0,0],radius:-1}},
    {kind:'add',array:'xtobbs',changes:{link:0,extentMin:[-1,-1,-1],extentMax:[1,1,1],matrix:Array(16).fill(0)}},
    {kind:'add',array:'xtobbs',changes:{link:0,extentMin:[-1,-1,-1],extentMax:[1,1,1],matrix:identity.map((n,i)=>i===3?1:n)}},
    {kind:'add',array:'obbs',changes:{link:0,extentMin:[0,0,0],extentMax:[0,0,1],matrix:identity}},
    {kind:'edit',array:'spheres',index:0,changes:{material:256}}
  ];
  for(const operation of bad)assert.throws(()=>editCollision(bytes,[operation]),/KLZ/);
  assert.throws(()=>editCollision(bytes,[{kind:'delete',array:'aabbs',index:0},{kind:'delete',array:'aabbs',index:0}]),/opakovaný/);assert.deepEqual(bytes,collisionFixture());
});

test('the oriented rectangle remains at local Y zero and its transformed normal agrees with the native plane',()=>{
  const matrix=new Matrix4().makeRotationX(Math.PI/4).setPosition(3,7,5).toArray(),q=parseCollision(editCollision(collisionFixture(),[{kind:'add',array:'obbs',changes:{link:0,extentMin:[-2,-100,-3],extentMax:[2,100,3],matrix}}]).bytes),record=q.primitives.obbs.records[1],g=collisionRecordGeometry(q,'obbs',record),inverse=new Matrix4().fromArray(record.inverse);
  for(const point of g.points)assert.ok(Math.abs(new Vector3(...point).applyMatrix4(inverse).y)<1e-6);
  assert.ok(g.max[1]<10);assert.ok(g.min[1]>4);assert.equal(g.points.length,4);
});

test('rotating a native triangle through 180 degrees rotates its normal instead of reversing its winding',()=>{
  const first=parseCollision(editCollision(collisionFixture(),[{kind:'add',array:'triangles',changes:{points:[[2,0,2],[3,0,2],[2,0,3]],reverse:true}}]).bytes),record=first.primitives.triangles.records[1],rotation=new Matrix4().makeRotationX(Math.PI),points=collisionTriangleVertices(first,record).map(p=>new Vector3(...p).applyMatrix4(rotation).toArray());
  const result=parseCollision(editCollision(first.bytes,[{kind:'edit',array:'triangles',index:1,changes:{points}}]).bytes),normal=new Vector3(...record.plane.slice(0,3)).transformDirection(rotation);
  result.primitives.triangles.records[1].plane.slice(0,3).forEach((n,i)=>assert.ok(Math.abs(n-normal.toArray()[i])<1e-6));
});

test('editing a shared world vertex detaches the selected triangle and leaves its neighbor byte-for-byte intact',()=>{
  const bytes=editCollision(collisionFixture(),[{kind:'add',array:'triangles',changes:{points:[[0,0,0],[1,0,0],[0,0,1]]}}]).bytes,p=parseCollision(bytes),second=p.primitives.triangles.records[1];
  for(let i=0;i<3;i++)bytes.writeUInt16LE(p.primitives.triangles.records[0].vertices[i].index,second.offset+4+i*4);
  const shared=parseCollision(bytes),points=collisionTriangleVertices(shared,shared.primitives.triangles.records[0]).map(p=>p.map((n,i)=>i===1?n+2:n)),q=parseCollision(editCollision(bytes,[{kind:'edit',array:'triangles',index:0,changes:{points}}]).bytes);
  assert.equal(q.vertexCount,9);assert.deepEqual(q.extraVertices.subarray(0,shared.extraVertices.length),shared.extraVertices);assert.deepEqual(q.primitives.triangles.records[1].raw,shared.primitives.triangles.records[1].raw);assert.deepEqual(collisionTriangleVertices(q,q.primitives.triangles.records[1]),collisionTriangleVertices(shared,shared.primitives.triangles.records[1]));
});
