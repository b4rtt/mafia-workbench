import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Viewport } from '../src/ui/viewport.js';
import { fromLs3dRotation, toLs3dRotation } from '../src/ui/transforms.js';
function viewport() {
  const view = Object.create(Viewport.prototype);
  Object.assign(view, { root: new THREE.Group(), frames: new Map(), materials: new Set(), textures: new Set(), camera: new THREE.PerspectiveCamera(), controls: { target: new THREE.Vector3(), update() {} } });
  view.root.scale.z = -1;
  return view;
}
function source(id, name, parent, position) { return { id, name, parent, position, fields: { position: id + '/position' } }; }
test('framing fits all transformed corners in narrow and wide viewports and keeps the viewing angle', () => {
  for (const aspect of [.4,2]) {
    const view=viewport(); view.camera.fov=50; view.camera.aspect=aspect;
    const object=new THREE.Mesh(new THREE.BoxGeometry(10,2,3)); object.position.set(200,4,-30);object.rotation.y=.7;view.root.add(object);
    view.camera.position.set(7,5,9);view.controls.target.set(1,2,3);
    const direction=view.camera.position.clone().sub(view.controls.target).normalize();
    view.controls.update=()=>view.camera.lookAt(view.controls.target);
    view.fit(object);view.camera.updateMatrixWorld();
    assert.ok(view.camera.position.clone().sub(view.controls.target).normalize().distanceTo(direction)<1e-10);
    const box=new THREE.Box3().setFromObject(object);
    for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z]){
      const point=new THREE.Vector3(x,y,z).project(view.camera);
      assert.ok(Math.abs(point.x)<1 && Math.abs(point.y)<1 && point.z<1 && point.z>-1);
    }
    const empty=new THREE.Group();empty.position.set(99,3,45);view.root.add(empty);view.fit(empty);
    assert.deepEqual(view.controls.target.toArray(),[99,3,-45]);
  }
});
test('camera restoration clears old damping, preserves a close detail view and suppresses automatic selection focus', () => {
  const view=viewport(); view.controls.enableDamping=true;
  const snapshot={position:[100.03,2,-8],target:[100,2,-8],near:.001,far:20000};
  let pending=true;
  view.controls.update=()=>{if(pending){view.camera.position.x+=9;view.controls.target.z+=5;pending=false;}};
  view.restoreCamera(snapshot); assert.deepEqual(view.captureCamera(),snapshot);assert.equal(view.controls.enableDamping,true);
  view.gizmo={detach(){},attach(){}};let selected;view.onSelect=frame=>{selected=frame.name;};view.focusOnSelect=true;
  const id=view.addSceneObject(source('new','New','Primary sector',[10,0,0]));
  view.select(id,true,false);assert.equal(selected,'New');assert.deepEqual(view.captureCamera(),snapshot);
  view.select(id);assert.deepEqual(view.controls.target.toArray(),[10,0,0]);assert.notDeepEqual(view.captureCamera(),snapshot);
});
test('map links local transforms and keeps backdrop outside camera fitting and original objects', () => {
  const view = viewport(), child = source('child', 'Child', 'PARENT', [1,2,3]), before = structuredClone(child);
  const childId = view.addSceneObject(child), parentId = view.addSceneObject(source('parent', 'Parent', 'Primary sector', [10,20,30]));
  const skyId = view.addSceneObject(source('sky', 'Sky', 'Backdrop sector', [1e6,1e6,1e6]));
  assert.deepEqual(view.linkScene(), []);
  assert.deepEqual(view.frames.get(childId).getWorldPosition(new THREE.Vector3()).toArray(), [11,22,-33]);
  assert.equal(view.frames.get(childId).parent, view.frames.get(parentId));
  assert.equal(view.frames.get(skyId).parent, view.backdrop); assert.equal(view.backdrop.visible, false);
  view.fit(); const target = view.controls.target.clone();
  view.showBackdrop(true); view.fit(); assert.deepEqual(view.controls.target, target);
  assert.ok(target.length() < 100); assert.deepEqual(child, before);
});
test('LS3D texture colour flags prevent blue authoring colours from tinting skin', () => {
  const view = viewport();
  const material = new THREE.MeshStandardMaterial({ color: new THREE.Color(.19,.39,.68) });
  material.userData.textureColored = false;
  view.applyTexture(material, new THREE.Texture());
  assert.deepEqual(material.color.toArray(), [1,1,1]); assert.equal(material.map.colorSpace, THREE.SRGBColorSpace);
  const colored = new THREE.MeshStandardMaterial({ color: new THREE.Color(.2,.4,.6) });
  colored.userData.textureColored = true; view.applyTexture(colored, new THREE.Texture());
  assert.deepEqual(colored.color.toArray(), [.2,.4,.6]);
});
test('map refuses cycles before linking and reports unresolved parents', () => {
  const view = viewport(), a = view.addSceneObject(source('a', 'A', 'B', [0,0,0])), b = view.addSceneObject(source('b', 'B', 'A', [0,0,0]));
  assert.throws(() => view.linkScene(), /cyklická/);
  assert.equal(view.frames.get(a).parent, view.root); assert.equal(view.frames.get(b).parent, view.root);
  const missing = viewport(); missing.addSceneObject(source('a', 'A', 'Missing', [0,0,0])); assert.equal(missing.linkScene().length, 1);
});
test('LS3D rotations point model and scene parts the same way and gizmos convert back', () => {
  const view = viewport(), rotation = [Math.SQRT1_2, Math.SQRT1_2, 0, 0];
  const model = { materials: [], meshes: [{ id:1, name:'Roof', type:6, parent:0, position:[0,0,0], scale:[1,1,1], rotation }] };
  const before = structuredClone(model), object = view.addModel(model).get(1);
  const direction = new THREE.Vector3(0,1,0).applyQuaternion(object.quaternion); assert.ok(direction.distanceTo(new THREE.Vector3(0,0,-1)) < 1e-8);
  const id = view.addSceneObject({ id:'rail', name:'Rail', fields:{}, rotation });
  assert.ok(view.frames.get(id).quaternion.angleTo(object.quaternion) < 1e-8);
  view.update('1', { rotation:[1,0,0,0] }); assert.equal(view.frames.get('1').quaternion.w,1);
  const restored = toLs3dRotation(fromLs3dRotation(rotation)); restored.forEach((v,i)=>assert.ok(Math.abs(v-rotation[i])<1e-8));
  assert.deepEqual(model,before);
});
test('disabled helper visuals remain in the hierarchy without fighting visible wall surfaces', () => {
  const view=viewport(),lod={positions:[-1,-1,0,1,-1,0,0,1,0],normals:[0,0,1,0,0,1,0,0,1],uv:[0,0,1,0,.5,1],faces:[{material:0,indices:[0,1,2]}]};
  const frame=(id,name,culling,renderFlags=0,parent=0)=>({id,name,culling,renderFlags,parent,type:1,position:[0,0,0],scale:[1,1,1],rotation:[1,0,0,0],lods:[lod]});
  const sector={...frame(5,'Mesh291',17),properties:'SECT no_shadow'},sectorChild=frame(6,'Sector wall',9,0,5),ordinary={...frame(7,'Sector texture',9),properties:'insect'};
  const model={materials:[],meshes:[frame(1,'SCTR',16),frame(2,'Wall',9),frame(3,'Hidden visual',9,0x40),frame(4,'Visible child',9,0,3),sector,sectorChild,ordinary]},before=structuredClone(model);
  view.addModel(model);assert.equal(view.frames.get('1').visible,false);assert.equal(view.frames.get('2').visible,true);assert.equal(view.frames.get('3').visible,true);assert.equal(view.frames.get('3').children.find(c=>c.isMesh).visible,false);assert.equal(view.frames.get('4').visible,true);
  view.root.updateMatrixWorld(true);const ray=new THREE.Raycaster(new THREE.Vector3(0,0,2),new THREE.Vector3(0,0,-1));
  const visible=ray.intersectObject(view.root,true).filter(hit=>{for(let o=hit.object;o;o=o.parent)if(!o.visible)return false;return true;});
  assert.equal(view.frames.get('5').visible,true);assert.equal(view.frames.get('5').children.find(c=>c.isMesh).visible,false);
  assert.deepEqual(new Set(visible.map(h=>h.object.parent.name)),new Set(['Wall','Visible child','Sector wall','Sector texture']));
  view.update('1',{culling:17});assert.equal(view.frames.get('1').visible,true);assert.deepEqual(model,before);
});
