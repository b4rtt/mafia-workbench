import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CollisionViewport, collisionDisplayGeometry } from '../src/ui/collision-view.js';
import { collisionShapeGeometry, collisionTransformPatch } from '../src/shared/collision-shapes.js';
function viewport(){
  const view=Object.create(CollisionViewport.prototype),root=new THREE.Group(),batch=new THREE.Group(),proxy=new THREE.Group();root.scale.z=-1;root.add(batch,proxy);
  Object.assign(view,{root,batch,proxy,entries:new Map(),locations:new Map(),materials:new Set(),camera:new THREE.PerspectiveCamera(),controls:{target:new THREE.Vector3(),update(){}},highlightMaterial:new THREE.MeshBasicMaterial(),gizmo:{detach(){this.object=null;},attach(object){this.object=object;}}});return view;
}
function record(array,values,index=0){const item={id:`${array}/${index}`,index,array,...values};item.geometry=collisionShapeGeometry(array,item);return item;}
test('collision display retains native coordinates and OBB planes/cylinder slices rather than invented volumes',()=>{
  const matrix=new THREE.Matrix4().makeTranslation(10,4,12).toArray(),r=record('obbs',{extentMin:[-2,-100,-3],extentMax:[2,100,3],matrix});
  assert.deepEqual(r.geometry.min,[8,4,9]);assert.deepEqual(r.geometry.max,[12,4,15]);const geometry=collisionDisplayGeometry(r);assert.equal(geometry.getAttribute('position').count,6);geometry.dispose();
  const c=record('cylinders',{center:[10,12],radius:2});assert.equal(c.geometry.unboundedY,true);const slice=collisionDisplayGeometry(c);slice.computeBoundingBox();assert.deepEqual(slice.boundingBox.min.toArray(),[8,-10,10]);assert.deepEqual(slice.boundingBox.max.toArray(),[12,10,14]);slice.dispose();
  const view=viewport();view.loadRecords([r,c]);view.root.updateMatrixWorld(true);const bounds=new THREE.Box3().setFromObject(view.batch);assert.equal(bounds.max.z,-9);assert.equal(bounds.min.z,-15);view.clearBatches();
});
test('batched shapes preserve hit identity, invalidate previews, recover malformed originals and release resources',()=>{
  const view=viewport(),a=record('aabbs',{min:[0,0,2],max:[1,1,3]}),b=record('aabbs',{min:[4,0,2],max:[5,1,3]},1),s=record('spheres',{center:[8,1,2],radius:1});view.loadRecords([a,b,s]);
  assert.equal(view.batch.children.length,2);assert.deepEqual(view.locations.get(b.id).mesh.userData.collisionIds.slice(12),Array(12).fill(b.id));
  view.updateRecord({...a,geometry:undefined,warning:'invalid'});const attr=view.locations.get(a.id).mesh.geometry.getAttribute('position');assert.deepEqual([...attr.array.slice(0,108)],Array(108).fill(0));assert.equal(attr.array[108],4);
  const fixed=record('aabbs',{min:[2,0,2],max:[3,1,3]});view.updateRecord(fixed);assert.equal(attr.array[0],2);
  view.loadRecords([{...a,geometry:undefined,warning:'unavailable'}]);assert.equal(view.batch.children.length,0);view.updateRecord(fixed);assert.equal(view.batch.children.length,1);
  let disposed=0;view.batch.children[0].geometry.addEventListener('dispose',()=>disposed++);view.clearBatches();assert.equal(disposed,1);assert.equal(view.locations.size,0);assert.equal(view.materials.size,0);
});
test('selection and gizmo edits do not move the camera, and clearing selection notifies the inspector',()=>{
  const view=viewport(),r=record('triangles',{points:[[10,2,12],[11,2,12],[10,3,12]]});view.loadRecords([r]);let picked,patch;view.onPick=id=>picked=id;view.onEdit=(id,value)=>{assert.equal(id,r.id);patch=value;};
  const before=view.captureCamera();view.select(r.id,false);assert.equal(picked,r.id);assert.deepEqual(view.captureCamera(),before);
  view.proxy.position.x+=2;view.transformSelection();assert.deepEqual(patch.points,[[12,2,12],[13,2,12],[12,3,12]]);
  view.select(null,false);assert.equal(picked,null);assert.equal(view.highlight,null);assert.equal(view.baseRecord,null);assert.equal(view.gizmo.object,null);assert.deepEqual(view.captureCamera(),before);view.clearBatches();
});
test('native gizmo deltas preserve rotated volume matrices and cylinders have only XZ translation',()=>{
  const original=new THREE.Matrix4().makeRotationY(.7).setPosition(10,4,12),delta=new THREE.Matrix4().makeTranslation(2,3,4);
  const result=collisionTransformPatch({array:'xtobbs',matrix:original.toArray()},delta);assert.deepEqual(result.matrix,delta.clone().multiply(original).toArray());
  assert.deepEqual(collisionTransformPatch({array:'cylinders',center:[10,12]},delta),{center:[12,16]});
  assert.deepEqual(collisionTransformPatch({array:'spheres',center:[10,4,12]},delta),{center:[12,7,16]});
});
test('3D picking resolves batched faces and sphere instances while excluding the visual background',()=>{
  for(const r of [record('aabbs',{min:[-.5,-.5,0],max:[.5,.5,1]},7),record('spheres',{center:[0,0,.5],radius:.5},9)]){
    const view=viewport();view.loadRecords([r]);view.camera.position.set(0,0,3);view.camera.lookAt(0,0,0);view.renderer={domElement:{getBoundingClientRect:()=>({left:0,top:0,width:100,height:100})}};view.raycaster=new THREE.Raycaster();
    const backdrop=new THREE.Mesh(new THREE.PlaneGeometry(4,4),new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));backdrop.position.z=-2;view.root.add(backdrop);let selected;view.onPick=id=>selected=id;
    const event={button:0,clientX:50,clientY:50,pointerId:1},before=view.captureCamera();view.beginPick(event);view.finishPick(event);assert.equal(selected,r.id);assert.deepEqual(view.captureCamera(),before);
    view.select(null,false);view.beginPick(event);view.finishPick({...event,clientX:58});assert.equal(selected,null);view.clearBatches();backdrop.geometry.dispose();backdrop.material.dispose();
  }
});
