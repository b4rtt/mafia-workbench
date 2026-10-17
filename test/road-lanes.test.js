import test from 'node:test';import assert from 'node:assert/strict';import * as THREE from 'three';
import {changeRoadTopology} from '../src/core/road-topology.js';import {parseRoads} from '../src/core/roads.js';import {roadLanePreview} from '../src/shared/road-lanes.js';import {RoadViewport} from '../src/ui/road-viewport.js';
function road(options={}){let data=Buffer.alloc(12);data.writeUInt32LE(2);for(const position of [[0,0,0],[0,0,12]])data=changeRoadTopology(data,{action:'create-crossing',position}).data;return changeRoadTopology(data,{action:'connect',from:0,to:1,...options}).data;}
const center=arrow=>arrow.start.map((n,i)=>(n+arrow.end[i])/2);
test('lane arrows follow each travel direction and half its first band width before the single viewport reflection',()=>{
  const data=road(),before=Buffer.from(data),file=parseRoads(data),a=roadLanePreview(file,0),b=roadLanePreview(file,1),node=roadLanePreview(file,2);
  assert.equal(a.roads,1);assert.equal(a.arrows.length,4);assert.deepEqual(a.warnings,[]);assert.equal(node.arrows.length,4);assert.deepEqual(new Set(b.arrows.map(row=>row.from)),new Set([0,1]));
  for(const arrow of a.arrows){assert.equal(center(arrow)[0],arrow.from===0?.75:-.75);assert.equal(center(arrow)[1],.08);assert.equal(Math.sign(arrow.end[2]-arrow.start[2]),arrow.from===0?1:-1);assert.ok(Math.abs(arrow.end[2]-arrow.start[2])<=3.5);}
  assert.deepEqual(data,before);
});
test('preview shows only active known lane types, skips raw/nonfinite values and does not infer missing ownership or cyclic chains',()=>{
  const lanes=[{type:1,distance:-2},{type:2,distance:0},{type:3,distance:2},{type:0,distance:4}],data=road({forwardLanes:lanes,reverseEnabled:false}),file=parseRoads(data),preview=roadLanePreview(file,0);
  assert.equal(preview.inactive,1);assert.equal(preview.arrows.length,6);assert.deepEqual(new Set(preview.arrows.map(a=>a.type)),new Set([1,2,3]));assert.equal(preview.arrows.some(a=>a.from===1),false);
  data[8+28+22]=19;data.writeUInt32LE(0x7fc01234,8+28+32);const raw=roadLanePreview(parseRoads(data),0);assert.equal(raw.arrows.length,0);assert.equal(raw.warnings.length,2);assert.match(raw.warnings.join(' '),/raw typ 19/);assert.match(raw.warnings.join(' '),/neplatná šířka pásu/);
  const closed=changeRoadTopology(road(),{action:'edit-road',from:0,to:1,forward:{enabled:false},reverse:{enabled:false}}).data;assert.equal(roadLanePreview(parseRoads(closed),0).arrows.length,0);assert.equal(roadLanePreview(parseRoads(closed),0).inactive,2);
  const orphan=parseRoads(road());orphan.nodes[0].previousCrossing=65535;assert.equal(roadLanePreview(orphan,2).warnings.length,1);assert.deepEqual(roadLanePreview(orphan,null).arrows,[]);
  const cycle=parseRoads(road());cycle.nodes[0].next=32768;assert.equal(roadLanePreview(cycle,0).arrows.length,0);
});
test('draft point positions rebuild arrows without touching source records and invalid or vertical segments cannot produce NaN geometry',()=>{
  const file=parseRoads(road()),before=structuredClone(file),positions=[...file.crossings,...file.nodes].map(r=>[...r.position]);positions[2]=[4,3,6];
  const draft=roadLanePreview(file,2,positions);assert.equal(draft.arrows.length,4);assert.ok(draft.arrows.every(a=>[...a.start,...a.end,...a.left,...a.right].every(Number.isFinite)));assert.ok(draft.arrows.some(a=>center(a)[1]>1));assert.deepEqual(file,before);
  positions[2]=[0,3,0];const vertical=roadLanePreview(file,2,positions);assert.equal(vertical.arrows.length,2);assert.match(vertical.warnings.join(' '),/směr XZ/);
  positions[2]=[Infinity,0,0];const invalid=roadLanePreview(file,2,positions);assert.equal(invalid.arrows.length,0);assert.ok(invalid.warnings.length);
});
test('road viewport overlay uses LS3D root exactly once, stays out of picking, rebuilds colors and disposes old geometry when settings change',()=>{
  const view=Object.create(RoadViewport.prototype);view.root=new THREE.Group();view.root.scale.z=-1;view.materials=new Set();view.selectedPoint=0;const file=parseRoads(road());view.positions=[...file.crossings,...file.nodes].map(r=>[...r.position]);
  view.setRoadLanes(file,true);const overlay=view.roadLaneOverlay,geometry=overlay.geometry;let disposed=false;geometry.addEventListener('dispose',()=>disposed=true);assert.equal(overlay.parent,view.root);assert.equal(overlay.material.depthWrite,false);assert.equal(overlay.material.depthTest,false);assert.equal(geometry.getAttribute('position').count,24);
  const world=new THREE.Vector3().fromBufferAttribute(geometry.getAttribute('position'),0);overlay.updateWorldMatrix(true,false);world.applyMatrix4(overlay.matrixWorld);assert.equal(world.x,.75);assert.ok(world.z<0);assert.equal(overlay.raycast({},[]),undefined);
  file.crossings[0].directions[0].lanes[0].type=1;view.setRoadLanes(file,true);assert.equal(disposed,true);const color=new THREE.Color(0x63e6ad),attribute=overlay.geometry.getAttribute('color');assert.ok(Math.abs(attribute.getX(0)-color.r)<1e-6);
  view.markers=new THREE.Mesh(new THREE.SphereGeometry(.35),new THREE.MeshBasicMaterial());view.fit=object=>{view.fitBox=new THREE.Box3().setFromObject(object);};view.fitRoadNetwork();assert.ok(view.fitBox.max.x>=.75);assert.ok(view.fitBox.min.z<-10);assert.equal(overlay.parent,view.root);
  view.setRoadLanes(file,false);assert.equal(overlay.visible,false);view.fitRoadNetwork();assert.ok(view.fitBox.max.x<1);view.setRoadLanes(file,true);assert.equal(overlay.visible,true);overlay.geometry.dispose();overlay.material.dispose();view.markers.geometry.dispose();view.markers.material.dispose();
});

test('native traffic and parking centres accumulate every preceding signed band width, including inactive and AI-only slots',()=>{
  const forwardLanes=[{type:0,distance:1},{type:2,distance:3},{type:1,distance:2},{type:3,distance:4}],reverseLanes=[{type:2,distance:-4},{type:0,distance:2},{type:3,distance:6},{type:0,distance:0}],data=road({forwardLanes,reverseLanes}),before=Buffer.from(data),preview=roadLanePreview(parseRoads(data),0);
  assert.deepEqual(preview.warnings,[]);
  for(const [from,offsets]of [[0,[[1,2.5],[2,5],[3,8]]],[1,[[0,-2],[2,1]]]])for(const [lane,offset]of offsets){
    const arrows=preview.arrows.filter(a=>a.from===from&&a.lane===lane);assert.equal(arrows.length,2);
    for(const a of arrows){assert.equal(a.offset,offset);assert.equal(center(a)[0],from===0?offset:-offset);}
  }
  assert.deepEqual(data,before);
});
test('unknown finite bands still consume width, while a nonfinite inactive band prevents guessing later centres',()=>{
  const data=road({forwardLanes:[{type:1,distance:2},{type:2,distance:4},{type:0,distance:1},{type:3,distance:2}],reverseEnabled:false}),file=parseRoads(data);file.crossings[0].directions[0].lanes[0].type=19;const known=roadLanePreview(file,0);
  assert.deepEqual(new Set(known.arrows.map(a=>a.offset)),new Set([4,8]));assert.match(known.warnings.join(' '),/raw typ 19/);
  file.crossings[0].directions[0].lanes[2].distance=NaN;
  const invalid=roadLanePreview(file,0);assert.equal(invalid.arrows.length,2);assert(invalid.arrows.every(a=>a.lane===1&&a.offset===4));assert.match(invalid.warnings.join(' '),/tohoto a dalších/);
});
