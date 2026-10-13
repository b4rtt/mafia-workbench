import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {lightPreviewSettings,createLightPreview} from '../src/ui/light-preview.js';
import {Viewport} from '../src/ui/viewport.js';
import {sceneMarkerKind} from '../src/ui/scene-markers.js';
const object={id:'0/1/2',frameType:2},prefix=object.id+'/7/';
const values=[['Typ světla',2],['Barva RGB',[.5,.6,.7]],['Síla světla',2],['Dosah světla',[1,10]],['Světelný kužel',[Math.PI/6,Math.PI/3]]];
const file={entries:values.map(([label,value],i)=>({id:prefix+i,label,value}))};

test('light preview reads one selected block and drafts, rejects invalid settings and leaves source intact',()=>{
  const before=structuredClone(file),drafts=new Map([[prefix+'2',3],[prefix+'3',[2,20]]]);
  const settings=lightPreviewSettings(file,object,drafts);assert.equal(settings.mode,'cone');assert.equal(settings.power,3);assert.deepEqual(settings.range,[2,20]);assert.deepEqual(file,before);
  assert.equal(lightPreviewSettings(file,{...object,frameType:4}),null);
  assert.equal(lightPreviewSettings({entries:[...file.entries,{id:'0/1/20/7/0',label:'Typ světla',value:5}]},object).mode,'cone');
  assert.equal(lightPreviewSettings({entries:[...file.entries,{id:object.id+'/8/0',label:'Typ světla',value:1}]},object).mode,null);
  for(const [key,value]of [['0',5],['1',[-1,1,1]],['2',Infinity],['3',[4,2]],['4',[2,1]],['4',[0,4]],['1',{invalid:true}]])assert.equal(lightPreviewSettings(file,object,new Map([[prefix+key,value]])).mode,null);
});

test('light cone boundaries and illumination use the same full aperture and local +Z direction',()=>{
  const settings=lightPreviewSettings(file,object),group=createLightPreview(settings),light=group.children.find(o=>o.isSpotLight);
  assert.equal(light.angle,settings.cone[1]/2);assert.equal(light.distance,10);assert.equal(light.intensity,2);assert.equal(light.penumbra,.5);assert.deepEqual(light.target.position.toArray(),[0,0,1]);
  const boundary=group.children[0].children[1].geometry.attributes.position;
  for(let i=0;i<boundary.count;i++){const p=new THREE.Vector3().fromBufferAttribute(boundary,i);if(p.length()>1e-6)assert.ok(Math.acos(THREE.MathUtils.clamp(p.z/p.length(),-1,1))<=settings.cone[1]/2+1e-6);}
  group.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});
});

test('selected light follows reflected hierarchy, movement and visibility without changing framing or picking',()=>{
  const view=Object.create(Viewport.prototype);Object.assign(view,{scene:new THREE.Scene(),root:new THREE.Group(),frames:new Map(),materials:new Set(),textures:new Set(),studioLights:[new THREE.DirectionalLight()],camera:new THREE.PerspectiveCamera(),controls:{target:new THREE.Vector3(),update(){}}});view.root.scale.z=-1;view.scene.add(view.root);
  // No billboard needed in this headless fixture; real frame classification is
  // covered below and the native UI verifies the canvas glyphs.
  const parent=view.addSceneObject({id:'p',name:'Parent',position:[10,2,30],fields:{position:'p/pos'}}),id=view.addSceneObject({id:'l',name:'Light',parent:'Parent',position:[1,0,2],rotation:[Math.SQRT1_2,0,Math.SQRT1_2,0],fields:{position:'l/pos'}});view.linkScene();view.fit();const camera=view.captureCamera();
  view.showLightPreview(id,lightPreviewSettings(file,object));view.scene.updateMatrixWorld(true);const light=view.lightOverlay.children.find(o=>o.isSpotLight);
  assert.ok(view.lightOverlay.matrixWorld.equals(view.frames.get(id).matrixWorld));const direction=light.target.getWorldPosition(new THREE.Vector3()).sub(light.getWorldPosition(new THREE.Vector3())).normalize();assert.ok(direction.distanceTo(new THREE.Vector3(-1,0,0))<1e-6);
  assert.equal(view.studioLights[0].visible,false);view.fit();assert.deepEqual(view.captureCamera(),camera);assert.equal(view.root.children.includes(view.lightOverlay),false);
  view.update(id,{position:[2,1,3]});view.scene.updateMatrixWorld(true);assert.ok(view.lightOverlay.matrixWorld.equals(view.frames.get(id).matrixWorld));
  view.frames.get(parent).visible=false;view.syncLightPreview();assert.equal(view.lightOverlay.visible,false);assert.equal(view.studioLights[0].visible,true);
  view.frames.get(parent).visible=true;view.syncLightPreview();assert.equal(view.studioLights[0].visible,false);
  const old=view.lightOverlay;let disposed=0;old.traverse(o=>o.geometry?.addEventListener('dispose',()=>disposed++));view.showLightPreview(null,null);assert.equal(old.parent,null);assert.equal(disposed,2);assert.equal(view.materials.size,2);assert.equal(view.studioLights[0].visible,true);
});

test('scene marker classification distinguishes audio, lights and script points while preserving model fallbacks',()=>{
  for(const [frameType,kind]of [[2,'light'],[4,'sound'],[6,'script'],[9,null]])assert.equal(sceneMarkerKind({frameType}),kind);
  assert.equal(sceneMarkerKind({frameType:6,model:'missing.4ds'}),null);
});
