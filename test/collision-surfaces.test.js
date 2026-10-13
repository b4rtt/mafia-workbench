import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { parseCollision } from '../src/core/collision.js';
import { replaceCollisionSurfaces, collisionTriangleVertices } from '../src/core/collision-surfaces.js';
import { collisionFixture } from './fixtures/collision.js';
function fixture(){const bytes=collisionFixture(),p=parseCollision(bytes);bytes.writeUInt16LE(2,p.primitives.triangles.start+8);bytes.writeUInt16LE(1,p.primitives.triangles.start+12);return bytes;}
const wall={name:'wall',positions:[2,0,2,2,3,2,2,0,4],indices:[0,1,2],material:7};
const vec=p=>new THREE.Vector3(...p);
function nativeInside(type,v,point){
  const b=v[1].map((n,i)=>n-v[0][i]),c=v[2].map((n,i)=>n-v[0][i]),h=point.map((n,i)=>n-v[0][i]);let alpha,beta;
  switch(type){
    case 1:alpha=h[1]/c[1];beta=(h[2]-c[2]*alpha)/b[2];break;
    case 2:alpha=(b[1]*h[2]-b[2]*h[1])/(b[1]*c[2]-c[1]*b[2]);beta=(h[1]-c[1]*alpha)/b[1];break;
    case 3:alpha=h[0]/c[0];beta=(h[2]-c[2]*alpha)/b[2];break;
    case 4:alpha=h[2]/c[2];beta=(h[0]-c[0]*alpha)/b[0];break;
    case 5:alpha=(b[0]*h[2]-b[2]*h[0])/(c[2]*b[0]-b[2]*c[0]);beta=(h[0]-c[0]*alpha)/b[0];break;
    case 6:alpha=h[0]/c[0];beta=(h[1]-c[1]*alpha)/b[1];break;
    case 7:alpha=(b[0]*h[1]-b[1]*h[0])/(c[1]*b[0]-b[1]*c[0]);beta=(h[0]-c[0]*alpha)/b[0];break;
    default:return false;
  }return alpha>=0&&alpha<=1&&beta>=0&&alpha+beta<=1;
}
function hits(p,origin,direction){
  const ray=new THREE.Ray(vec(origin),vec(direction)),found=[];
  for(const face of p.primitives.triangles.records){const v=collisionTriangleVertices(p,face);const normal=vec(face.plane.slice(0,3));if(normal.dot(ray.direction)<1e-8)continue;
    const d=-(normal.dot(ray.origin)+face.plane[3])/normal.dot(ray.direction);if(d<0)continue;
    const point=ray.at(d,new THREE.Vector3()),triangle=new THREE.Triangle(...v.map(vec));assert.equal(nativeInside(face.type,v,point.toArray()),triangle.containsPoint(point));if(nativeInside(face.type,v,point.toArray()))found.push(point.toArray());
  }return found;
}
test('surface writer emits native planes, winding parity and X-sorted cells while preserving native data',()=>{
  const before=fixture(),p=parseCollision(before),result=replaceCollisionSurfaces(before,[wall]),q=parseCollision(result.bytes),g=result.groups[0];
  assert.deepEqual(g,{name:'wall',triangleStart:1,triangleCount:2,vertexStart:3,vertexCount:3,doubleSided:true});assert.equal(q.vertexCount,6);
  assert.deepEqual(result.bytes.subarray(0,p.gridOffset),before.subarray(0,p.gridOffset));assert.deepEqual(q.extraVertices.subarray(0,p.extraVertices.length),p.extraVertices);assert.deepEqual(q.primitives.triangles.records[0].raw,p.primitives.triangles.records[0].raw);
  for(const name of ['aabbs','xtobbs','obbs','spheres','cylinders'])assert.deepEqual(q.primitives[name].raw,p.primitives[name].raw);
  assert.deepEqual(q.tail,p.tail);assert.deepEqual(q.cells[1].raw,p.cells[1].raw);assert.deepEqual(q.cells[0].references.slice(0,6),p.cells[0].references);assert.equal(q.cells[0].header.readFloatLE(12),3);
  for(const t of q.primitives.triangles.records.slice(1)){const v=collisionTriangleVertices(q,t),cross=vec(v[1]).sub(vec(v[0])).cross(vec(v[2]).sub(vec(v[0]))),normal=vec(t.plane.slice(0,3));assert.equal(cross.dot(normal)>0,Boolean(t.sort&1));for(const point of v)assert.ok(Math.abs(normal.dot(vec(point))+t.plane[3])<1e-6);assert.ok(t.type>=1&&t.type<=7);assert.equal(t.material,7);}
  assert.deepEqual(hits(q,[1,1,2.5],[1,0,0]),[[2,1,2.5]]);assert.deepEqual(hits(q,[3,1,2.5],[-1,0,0]),[[2,1,2.5]]);
  const far={...wall,name:'far',positions:[-5,0,10,-5,4,10,-5,0,11]};const expanded=parseCollision(replaceCollisionSurfaces(before,[far]).bytes);assert.equal(expanded.grid.minX,-10);assert.ok(expanded.cells.filter(c=>c.references.some(r=>r.type===0&&r.index>=1)).length>=2);
  assert.deepEqual(before,fixture());assert.deepEqual(replaceCollisionSurfaces(before,[]).bytes,before);
});
test('precise surfaces leave an opening traversable from both sides, unlike their enclosing box',()=>{
  const positions=[0,0,2,0,3,2,1,0,2,1,3,2,2,0,2,2,3,2,3,0,2,3,3,2,1,2,2,2,2,2];
  const indices=[0,1,2,1,3,2,4,5,6,5,7,6,8,3,9,3,5,9];
  const q=parseCollision(replaceCollisionSurfaces(fixture(),[{name:'door opening',positions,indices}]).bytes);
  assert.deepEqual(hits(q,[1.5,1,0],[0,0,1]),[]);assert.deepEqual(hits(q,[1.5,1,4],[0,0,-1]),[]);
  assert.deepEqual(hits(q,[.25,1,0],[0,0,1]),[[.25,1,2]]);assert.deepEqual(hits(q,[1.5,2.7,0],[0,0,1]),[[1.5,2.7,2]]);
});
test('replacement reuses the owned vertex suffix and remaps cells without accumulating discarded triangles',()=>{
  const first=replaceCollisionSurfaces(fixture(),[wall,{...wall,name:'second',positions:wall.positions.map((n,i)=>i%3===0?n+10:n)}]);
  const replaced=replaceCollisionSurfaces(first.bytes,[{...wall,positions:wall.positions.map((n,i)=>i%3===0?n+1:n)}],{removedIndices:[1,2,3,4],vertexBase:3}),q=parseCollision(replaced.bytes);
  assert.equal(q.primitives.triangles.count,3);assert.equal(q.vertexCount,6);assert.deepEqual(q.primitives.triangles.records[0].raw,parseCollision(fixture()).primitives.triangles.records[0].raw);
  const removed=replaceCollisionSurfaces(replaced.bytes,[],{removedIndices:[1,2],vertexBase:3});assert.equal(parseCollision(removed.bytes).vertexCount,3);assert.equal(parseCollision(removed.bytes).primitives.triangles.count,1);
  assert.throws(()=>replaceCollisionSurfaces(first.bytes,[],{removedIndices:[1,2],vertexBase:3}),/jiný povrch/);
  for(const options of [{removedIndices:[1,1]},{vertexBase:1},{removedIndices:[99]}])assert.throws(()=>replaceCollisionSurfaces(first.bytes,[],options),/KLZ/);
});
test('invalid geometry, oversized world pools and unresolved imported faces fail before publishing bytes',()=>{
  const before=fixture();
  for(const surface of [{...wall,indices:[0,0,0]},{...wall,indices:[0,1,99]},{...wall,material:256},{...wall,positions:[Infinity,0,0]},{...wall,positions:Array(65537*3).fill(0)}])assert.throws(()=>replaceCollisionSurfaces(before,[surface]),/KLZ/);
  const p=parseCollision(before),frame=Buffer.from(before);frame.writeUInt16LE(0,p.primitives.triangles.start+6);
  assert.throws(()=>replaceCollisionSurfaces(frame,[wall]),/vyřešit/);
  const q=parseCollision(replaceCollisionSurfaces(frame,[wall],{resolveFrame:(name,indices)=>{assert.equal(name,'old');return indices.map(i=>[i===1?1:0,0,i===2?1:0]);}}).bytes);assert.equal(q.primitives.triangles.count,3);
  assert.deepEqual(before,fixture());
});

test('native axis classification and barycentric formulas accept interior points for all seven triangle cases',()=>{
  const samples=[[[0,0,0],[0,0,2],[0,3,0]],[[0,0,0],[0,2,1],[0,3,0]],[[0,0,0],[0,0,2],[3,0,0]],[[0,0,0],[1,0,0],[3,0,2]],[[0,0,0],[1,0,1],[3,0,0]],[[0,0,0],[0,2,0],[3,0,0]],[[0,0,0],[1,2,0],[3,0,0]]];
  const seen=new Set();for(const points of samples){const q=parseCollision(replaceCollisionSurfaces(fixture(),[{name:'case',positions:points.flat(),indices:[0,1,2]}]).bytes),record=q.primitives.triangles.records[1],v=collisionTriangleVertices(q,record);seen.add(record.type);assert.equal(nativeInside(record.type,v,[0,1,2].map(i=>v.reduce((sum,p)=>sum+p[i]/3,0))),true);assert.equal(nativeInside(record.type,v,v[0].map((n,i)=>n+2*(v[1][i]-n)+2*(v[2][i]-n))),false);}
  assert.deepEqual([...seen].sort(),[1,2,3,4,5,6,7]);
});
