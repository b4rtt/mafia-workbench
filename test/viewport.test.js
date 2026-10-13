import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Viewport } from '../src/ui/viewport.js';
import { fromLs3dRotation, toLs3dRotation } from '../src/ui/transforms.js';
function viewport() {
  const view = Object.create(Viewport.prototype);
  Object.assign(view, { root: new THREE.Group(), frames: new Map(), materials: new Set(), textures: new Set(), camera: new THREE.PerspectiveCamera(), controls: { target: new THREE.Vector3(), update() {} } });
  view.root.scale.z = -1;
  return view;
}
function source(id, name, parent, position) { return { id, name, parent, position, fields: { position: id + '/position' } }; }
test('collision helpers reflect native Z without changing object picking or camera framing',()=>{
  const view=viewport();view.scene=new THREE.Scene();view.scene.add(view.root);view.root.add(new THREE.Mesh(new THREE.BoxGeometry(1,1,1)));view.fit();const before=view.captureCamera();
  view.showCollisionBoxes([{name:'far collision',min:[100,0,200],max:[101,1,201]}],true);view.fit();assert.deepEqual(view.captureCamera(),before);
  view.scene.updateMatrixWorld(true);const helper=view.collisionOverlay.children[0],bounds=new THREE.Box3().setFromObject(helper);assert.deepEqual(bounds.min.toArray(),[100,0,-201]);assert.deepEqual(bounds.max.toArray(),[101,1,-200]);
  const ray=new THREE.Raycaster(new THREE.Vector3(100.5,.5,-199),new THREE.Vector3(0,0,-1));assert.equal(ray.intersectObjects(view.root.children,true).length,0);
});
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
test('right and middle clicks, orbit drags and mismatched pointers do not select or refocus the camera', () => {
  const view=viewport();view.camera.position.set(0,0,3);view.camera.lookAt(0,0,0);view.camera.updateMatrixWorld();
  view.renderer={domElement:{getBoundingClientRect:()=>({left:0,top:0,width:100,height:100})}};
  view.raycaster=new THREE.Raycaster();view.gizmo={detach(){},attach(){}};view.focusOnSelect=true;
  const id=view.addSceneObject(source('picked','Picked','Primary sector',[0,0,0]));view.root.updateMatrixWorld(true);
  let picked=0;view.onSelect=()=>picked++;const before=view.captureCamera();
  for(const button of [1,2]){const event={button,clientX:50,clientY:50,pointerId:1};view.beginPick(event);view.finishPick(event);}
  const left={button:0,clientX:50,clientY:50,pointerId:1};
  view.beginPick(left);view.finishPick({...left,clientX:56});
  view.beginPick(left);view.finishPick({...left,pointerId:2});
  view.beginPick(left);view.gizmo.dragging=true;view.finishPick(left);view.gizmo.dragging=false;
  assert.equal(picked,0);assert.deepEqual(view.captureCamera(),before);
  view.beginPick(left);view.finishPick(left);assert.equal(picked,1);assert.ok(view.camera.position.distanceTo(view.controls.target)<1);
  view.finishPick(left);assert.equal(picked,1);assert.ok(view.frames.has(id));
});
test('vertex editor picks the native vertex index from point overlays without selecting the whole part or moving its camera',()=>{
  const view=viewport();view.camera.position.set(0,0,10);view.camera.lookAt(0,0,0);view.camera.updateMatrixWorld();view.raycaster=new THREE.Raycaster();view.raycaster.params.Points.threshold=.05;
  view.renderer={domElement:{getBoundingClientRect:()=>({left:0,top:0,width:100,height:100})}};view.gizmo={};
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute([2,0,-1,0,0,-1],3));const points=new THREE.Points(geometry);points.userData.vertexEditor=true;view.root.add(points);
  const part=new THREE.Mesh(new THREE.PlaneGeometry(4,4),new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));part.userData.frame={id:'part'};view.root.add(part);view.root.updateMatrixWorld(true);
  let index=-1;view.onVertexSelect=value=>{index=value;};view.select=()=>assert.fail('part selection must not run');const before=view.captureCamera(),event={button:0,clientX:50,clientY:50,pointerId:1};view.beginPick(event);view.finishPick(event);assert.equal(index,1);assert.deepEqual(view.captureCamera(),before);
  points.visible=false;view.beginPick(event);view.finishPick(event);assert.equal(index,1);
  view.onVertexSelect=null;view.select=()=>{index=99;};view.beginPick(event);view.finishPick(event);assert.equal(index,99);
});
test('a restored detail remains stable with real OrbitControls and wheel zoom reaches its small distance limit', () => {
  const canvas=new EventTarget(),document=new EventTarget();
  Object.assign(canvas,{style:{},ownerDocument:document,getRootNode:()=>document,getBoundingClientRect:()=>({left:0,top:0,width:100,height:100})});
  const view=viewport();view.controls=new OrbitControls(view.camera,canvas);view.controls.enableDamping=true;view.controls.zoomToCursor=true;view.controls.minDistance=.02;
  const snapshot={position:[100,2,-7.97],target:[100,2,-8],near:.001,far:20000};
  view.restoreCamera(snapshot);for(let i=0;i<20;i++)view.controls.update();
  for(const key of ['position','target'])view.captureCamera()[key].forEach((value,i)=>assert.ok(Math.abs(value-snapshot[key][i])<1e-10));
  for(let i=0;i<30;i++){const wheel=new Event('wheel',{cancelable:true});Object.assign(wheel,{clientX:50,clientY:50,deltaY:-100,deltaMode:0,ctrlKey:false});canvas.dispatchEvent(wheel);}
  const distance=view.camera.position.distanceTo(view.controls.target);assert.ok(Math.abs(distance-.02)<1e-10);
  view.camera.updateMatrixWorld();const target=view.controls.target.clone().project(view.camera);assert.ok(target.z>-1&&target.z<1);
  view.controls.dispose();
});
test('cursor zoom approaches the visible surface depth instead of the distant map center, with a fine Shift step', () => {
  const canvas=new EventTarget(),document=new EventTarget();
  Object.assign(canvas,{style:{},ownerDocument:document,getRootNode:()=>document,getBoundingClientRect:()=>({left:0,top:0,width:100,height:100})});
  const view=viewport();view.renderer={domElement:canvas};view.raycaster=new THREE.Raycaster();view.gizmo={dragging:false};
  view.camera.fov=50;view.controls=new OrbitControls(view.camera,canvas);view.controls.zoomToCursor=true;view.controls.minDistance=.02;
  view.restoreCamera({position:[0,0,10],target:[0,0,-1000],near:.001,far:20000});
  const surface=new THREE.Mesh(new THREE.PlaneGeometry(4,4),new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));surface.position.z=-9;view.root.add(surface);
  const hidden=surface.clone();hidden.position.z=-9.9;hidden.visible=false;view.root.add(hidden);
  const backdrop=new THREE.Group();backdrop.userData.backdrop=true;const sky=surface.clone();sky.position.z=-9.99;backdrop.add(sky);view.root.add(backdrop);
  const wheel={clientX:50,clientY:50,shiftKey:false};const position=view.camera.position.clone(),orientation=view.camera.quaternion.clone();
  view.anchorZoom(wheel);assert.ok(view.controls.target.distanceTo(new THREE.Vector3(0,0,9))<1e-10);assert.deepEqual(view.camera.position.toArray(),position.toArray());assert.deepEqual(view.camera.quaternion.toArray(),orientation.toArray());
  const event=()=>{const value=new Event('wheel',{cancelable:true});Object.assign(value,{...wheel,deltaY:-100,deltaMode:0,ctrlKey:false});return value;};
  canvas.dispatchEvent(event());const normal=10-view.camera.position.z;assert.ok(normal>.09&&normal<.11);assert.ok(view.camera.position.z>9);
  view.restoreCamera({position:[0,0,10],target:[0,0,-1000],near:.001,far:20000});view.anchorZoom({...wheel,shiftKey:true});canvas.dispatchEvent(event());const fine=10-view.camera.position.z;assert.ok(fine>0&&fine<normal/2);
  const before=view.captureCamera();view.anchorZoom({clientX:10000,clientY:10000});assert.deepEqual(view.captureCamera(),before);
  let casts=0;const surfaceAt=view.surfaceAt.bind(view);view.surfaceAt=event=>{casts++;return surfaceAt(event);};view.zoomAnchor=null;
  for(let i=0;i<20;i++)view.anchorZoom({...wheel,timeStamp:1000+i*10});assert.equal(casts,1);
  view.anchorZoom({...wheel,timeStamp:1500});assert.equal(casts,2);
  view.anchorZoom({...wheel,clientX:55,timeStamp:1510});assert.equal(casts,3);
  view.restoreCamera(before);
  view.gizmo.dragging=true;view.anchorZoom(wheel);assert.deepEqual(view.captureCamera(),before);view.controls.dispose();
});
test('rebuilding a map and adding a selected object preserves the close camera after hierarchy and orbit updates', () => {
  const old=viewport();old.restoreCamera({position:[23.03,2,-8],target:[23,2,-8],near:.001,far:20000});const snapshot=old.captureCamera();
  const canvas=new EventTarget(),document=new EventTarget();Object.assign(canvas,{style:{},ownerDocument:document,getRootNode:()=>document});
  const rebuilt=viewport();rebuilt.controls=new OrbitControls(rebuilt.camera,canvas);rebuilt.controls.enableDamping=true;rebuilt.restoreCamera(snapshot);
  rebuilt.gizmo={detach(){this.object=null;},attach(object){this.object=object;}};rebuilt.onSelect=()=>{};rebuilt.focusOnSelect=true;
  rebuilt.addSceneObject(source('far','Far','Primary sector',[10000,0,0]));const added=rebuilt.addSceneObject(source('added','Added','Primary sector',[23,2,8]));rebuilt.linkScene();rebuilt.select(added,true,false);
  for(let i=0;i<20;i++)rebuilt.controls.update();
  for(const key of ['position','target'])rebuilt.captureCamera()[key].forEach((value,i)=>assert.ok(Math.abs(value-snapshot[key][i])<1e-10));
  assert.equal(rebuilt.gizmo.object,rebuilt.frames.get(added));rebuilt.controls.dispose();
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

test('surface collision overlays show native triangles without stealing selection or expanding map framing',()=>{
  const view=viewport();view.scene=new THREE.Scene();view.scene.add(view.root);view.root.add(new THREE.Mesh(new THREE.BoxGeometry(1,1,1)));view.fit();const before=view.captureCamera();
  view.showCollisionBoxes([],true,[{name:'surface',positions:[100,0,200,101,0,200,100,1,200]}]);view.fit();assert.deepEqual(view.captureCamera(),before);
  view.scene.updateMatrixWorld(true);const helper=view.collisionOverlay.children[0];assert.equal(helper.isLineSegments,true);assert.equal(helper.geometry.attributes.position.count,6);const bounds=new THREE.Box3().setFromObject(helper);assert.deepEqual(bounds.min.toArray(),[100,0,-200]);assert.deepEqual(bounds.max.toArray(),[101,1,-200]);
  const ray=new THREE.Raycaster(new THREE.Vector3(100.5,.5,-199),new THREE.Vector3(0,0,-1));assert.equal(ray.intersectObjects(view.root.children,true).length,0);
});
