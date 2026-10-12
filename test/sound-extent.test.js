import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {soundExtentSettings,createSoundExtent} from '../src/ui/sound-extent.js';
import {Viewport} from '../src/ui/viewport.js';

const object={id:'0/1/2',frameType:4};
const entry=(name,value,index)=>({id:`${object.id}/7/${index}`,label:name,value});
const file={entries:[{id:`${object.id}/7:sound.loop`,nodeId:`${object.id}/7`,soundParameter:true},entry('Typ zvuku',2,1),entry('Dosah zvuku',[1,10,.75,.125],2),entry('Zvukový kužel',[Math.PI/3,Math.PI/2],3)]};

test('sound extents use unique selected block IDs and unsaved values, without replacing source settings',()=>{
  const before=structuredClone(file),drafts=new Map([[`${object.id}/7/2`,[2,30,.5,0]]]);
  const settings=soundExtentSettings(file,object,drafts);assert.equal(settings.mode,'cone');assert.deepEqual(settings.range,[2,30]);assert.deepEqual(settings.cone,[Math.PI/3,Math.PI/2]);assert.deepEqual(file,before);
  assert.equal(soundExtentSettings(file,{...object,frameType:9}),null);
  const unrelated={entries:[...file.entries,{id:'0/1/20/7/1',label:'Typ zvuku',value:0}]};assert.equal(soundExtentSettings(unrelated,object).mode,'cone');
  const duplicate={entries:[...file.entries,{id:`${object.id}/8:sound.loop`,nodeId:`${object.id}/8`,soundParameter:true}]};assert.equal(soundExtentSettings(duplicate,object).mode,null);
  for(const type of [0,3,4,6])assert.equal(soundExtentSettings(file,object,new Map([[`${object.id}/7/1`,type]])).mode,null);
  for(const range of [[-1,10,1,0],[1,0,1,0],[5,2,1,0],[1,Infinity,1,0],Array(4),{invalid:true,raw:'['}])assert.equal(soundExtentSettings(file,object,new Map([[`${object.id}/7/2`,range]])).mode,null);
  for(const cone of [[2,1],[-1,1],[0,8],Array(2)])assert.equal(soundExtentSettings(file,object,new Map([[`${object.id}/7/3`,cone]])).mode,null);
  const omni=soundExtentSettings(file,object,new Map([[`${object.id}/7/1`,1],[`${object.id}/7/2`,[2,10]]]));assert.equal(omni.mode,'sphere');assert.deepEqual(omni.range,[2,10]);
  const full=soundExtentSettings(file,object,new Map([[`${object.id}/7/3`,[Math.fround(2*Math.PI),Math.fround(2*Math.PI)]]]));assert.deepEqual(full.cone,[2*Math.PI,2*Math.PI]);
});

function points(helper){const a=helper.geometry.getAttribute('position');return Array.from({length:a.count},(_,i)=>new THREE.Vector3().fromBufferAttribute(a,i));}
function dispose(group){group.traverse(node=>{node.geometry?.dispose();node.material?.dispose();});}

test('inner and outer spherical sound ranges have the requested radii and stay local to the source',()=>{
  const group=createSoundExtent({mode:'sphere',range:[2,10]});assert.equal(group.children.length,2);
  for(const [i,helper]of group.children.entries())for(const point of points(helper))assert.ok(Math.abs(point.length()-[2,10][i])<1e-6);
  const bounds=new THREE.Box3().setFromObject(group);assert.deepEqual(bounds.min.toArray(),[-10,-10,-10]);assert.deepEqual(bounds.max.toArray(),[10,10,10]);dispose(group);
});

test('sound cones use full aperture and radial distance, including angles above 180 and the full sphere',()=>{
  for(const aperture of [Math.PI/2,Math.PI,Math.PI*1.5]){
    const group=createSoundExtent({mode:'cone',range:[0,10],cone:[0,aperture]}),helper=group.children[0],vertices=points(helper);
    for(const point of vertices){assert.ok(point.length()<=10.000001);if(point.length()>1e-6)assert.ok(Math.acos(THREE.MathUtils.clamp(point.z/point.length(),-1,1))<=aperture/2+1e-6);}
    assert.ok(vertices.some(p=>Math.abs(p.z-10*Math.cos(aperture/2))<1e-6&&Math.abs(Math.hypot(p.x,p.y)-10*Math.sin(aperture/2))<1e-6));dispose(group);
  }
  const full=createSoundExtent({mode:'cone',range:[1,10],cone:[2*Math.PI,2*Math.PI]});assert.deepEqual(new THREE.Box3().setFromObject(full).min.toArray(),[-10,-10,-10]);dispose(full);
});

test('sound overlay follows reflected world hierarchy and drafts, excludes picking/framing and disposes replaced helpers',()=>{
  const view=Object.create(Viewport.prototype);Object.assign(view,{scene:new THREE.Scene(),root:new THREE.Group(),frames:new Map(),materials:new Set(),textures:new Set(),camera:new THREE.PerspectiveCamera(),controls:{target:new THREE.Vector3(),update(){}}});view.root.scale.z=-1;view.scene.add(view.root);
  const source=(id,name,parent,position)=>({id,name,parent,position,fields:{position:id+'/position'}});
  const parent=view.addSceneObject(source('parent','Parent','Primary sector',[10,2,30])),id=view.addSceneObject({...source('sound','Emitter','Parent',[1,0,2]),rotation:[Math.SQRT1_2,0,Math.SQRT1_2,0]});view.linkScene();
  const originalCamera=(()=>{view.fit();return view.captureCamera();})(),settings={mode:'cone',range:[1,10],cone:[Math.PI/3,Math.PI/2]};view.showSoundExtent(id,settings,true);view.scene.updateMatrixWorld(true);assert.ok(view.soundOverlay.matrixWorld.equals(view.frames.get(id).matrixWorld));
  const forward=new THREE.Vector3(0,0,10).applyMatrix4(view.soundOverlay.matrixWorld);assert.ok(forward.distanceTo(new THREE.Vector3(1,2,-32))<1e-6);
  view.fit();assert.deepEqual(view.captureCamera(),originalCamera);assert.equal(view.root.children.includes(view.soundOverlay),false);
  const ray=new THREE.Raycaster(new THREE.Vector3(11,2,-22),new THREE.Vector3(0,0,-1));assert.ok(ray.intersectObject(view.root,true).every(hit=>hit.object.parent!==view.soundOverlay));
  view.update(id,{position:[2,1,3]});view.scene.updateMatrixWorld(true);assert.ok(view.soundOverlay.matrixWorld.equals(view.frames.get(id).matrixWorld));
  view.frames.get(parent).visible=false;view.syncSoundExtent();assert.equal(view.soundOverlay.visible,false);view.frames.get(parent).visible=true;view.syncSoundExtent();assert.equal(view.soundOverlay.visible,true);
  // Linking can finish after a user selects an already loaded sound frame.
  view.root.add(view.frames.get(id));view.showSoundExtent(id,settings,true);view.linkScene();view.scene.updateMatrixWorld(true);assert.ok(view.soundOverlay.matrixWorld.equals(view.frames.get(id).matrixWorld));
  let geometryDisposals=0,materialDisposals=0;const old=view.soundOverlay;old.traverse(node=>{node.geometry?.addEventListener('dispose',()=>geometryDisposals++);node.material?.addEventListener('dispose',()=>materialDisposals++);});
  view.showSoundExtent(id,{mode:'sphere',range:[2,20]},false);assert.equal(view.soundOverlay.visible,false);assert.equal(old.parent,null);assert.equal(geometryDisposals,2);assert.equal(materialDisposals,2);assert.equal(view.materials.size,4); // two markers + two active range materials
  view.showSoundExtent(null,null,true);assert.equal(view.soundOverlay,null);assert.equal(view.materials.size,2);
});
