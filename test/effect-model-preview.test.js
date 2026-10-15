import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { EffectModelViewport } from '../src/ui/effect-model-preview.js';

const lod={positions:[0,0,0,2,0,0,0,1,0],normals:[0,0,1,0,0,1,0,0,1],uv:[0,0,1,0,0,1],faces:[{material:1,indices:[0,1,2]}]};
const frame=(id,type,parent,position=[0,0,0])=>({id,name:`Part${id}`,type,parent,position,scale:[1,1,1],rotation:[1,0,0,0],culling:0,lods:type===6?[]:[lod],renderFlags:0x40});
const source={materials:[{diffuse:[1,1,1],opacity:1,flags:0}],meshes:[frame(1,6,0,[10,20,30]),frame(2,1,1,[2,0,0]),frame(3,1,2,[100,0,0]),frame(4,7,1)]};
function preview(){
  const view=Object.create(EffectModelViewport.prototype);let attached=0,selected;
  Object.assign(view,{scene:new THREE.Scene(),root:new THREE.Group(),frames:new Map(),materials:new Set(),camera:new THREE.PerspectiveCamera(50,1,.02,20000),controls:{target:new THREE.Vector3(),update(){}},gizmo:{detach(){},attach(){attached++;}},onSelect:frame=>{selected=frame;}});view.root.scale.z=-1;view.scene.add(view.root);view.load(source);
  return {view,attached:()=>attached,selected:()=>selected,dispose(){view.scene.traverse(node=>node.geometry?.dispose());for(const material of view.materials)material.dispose();}};
}

test('particle part preview retains native hierarchy and hidden source data, isolates only the selected visual and frames its geometry',()=>{
  const original=structuredClone(source),p=preview(),{view}=p;
  try{
    view.showPart(2);const selected=view.frames.get('2'),child=view.frames.get('3'),volume=view.frames.get('4');
    assert.deepEqual(selected.getWorldPosition(new THREE.Vector3()).toArray(),[12,20,-30]);
    assert.equal(selected.children.find(node=>node.isMesh).visible,true);assert.equal(child.children.find(node=>node.isMesh).visible,false);assert.equal(volume.children.find(node=>node.isMesh).visible,false);
    assert.equal(view.partBox.visible,false);view.fitPart();assert.deepEqual(view.controls.target.toArray(),[13,20.5,-30]);
    const camera=view.captureCamera();view.showPart(3,true);assert.deepEqual(view.captureCamera(),camera);
    assert.equal(view.partBox.visible,true);assert.deepEqual(view.partBox.box.min.toArray(),[112,20,-30]);assert.deepEqual(view.partBox.box.max.toArray(),[114,21,-30]);assert.equal(view.partBox.parent,view.scene);
    view.fitPart();assert.deepEqual(view.controls.target.toArray(),[113,20.5,-30]);
    view.select('2',true,true);assert.equal(p.attached(),0);assert.equal(p.selected().name,'Part2');assert.equal(p.selected().editable,false);
    view.showPart('missing');assert.equal(view.partBox.visible,false);assert.equal(selected.children.find(node=>node.isMesh).visible,false);assert.deepEqual(source,original);
  }finally{p.dispose();}
});
