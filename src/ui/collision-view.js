import * as THREE from 'three';
import { Viewport } from './viewport.js';
import { collisionShapeGeometry, collisionTransformPatch } from '../shared/collision-shapes.js';

const boxFaces=[0,2,3,0,3,1,4,5,7,4,7,6,0,1,5,0,5,4,2,6,7,2,7,3,0,4,6,0,6,2,1,3,7,1,7,5];
const colors={triangles:0x50bac6,aabbs:0xe6a846,xtobbs:0xbda1ef,obbs:0x91c56d,spheres:0xe69cbe,cylinders:0x71a9ed};
export function collisionDisplayGeometry(record){
  const shape=collisionShapeGeometry(record.array,record);
  if(record.array==='spheres')return new THREE.SphereGeometry(record.radius,16,10).translate(...record.center);
  // Only a 20 m display slice; the stored shape is infinite in Y.
  if(record.array==='cylinders')return new THREE.CylinderGeometry(record.radius,record.radius,20,16,1,true).translate(record.center[0],0,record.center[1]);
  const indices=record.array==='triangles'?[0,1,2]:record.array==='obbs'?[0,1,2,0,2,3]:boxFaces,geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(indices.flatMap(i=>shape.points[i]),3));return geometry;
}

export class CollisionViewport extends Viewport {
  constructor(container,onPick,onEdit){
    super(container);this.onPick=onPick;this.onEdit=onEdit;this.entries=new Map();this.locations=new Map();this.batch=new THREE.Group();this.root.add(this.batch);
    this.proxy=new THREE.Group();this.root.add(this.proxy);this.onChange=()=>this.transformSelection();
    this.highlightMaterial=new THREE.MeshBasicMaterial({color:0xffdd58,wireframe:true,depthTest:false});this.materials.add(this.highlightMaterial);
    this.gizmo.addEventListener('change',()=>{
      const record=this.entries.get(this.selectedId);if(!record)return;
      if((record.array==='aabbs'&&this.gizmo.mode==='rotate'||['spheres','cylinders'].includes(record.array)&&this.gizmo.mode!=='translate'))this.gizmo.setMode('translate');
      this.gizmo.showY=record.array!=='cylinders';
    });
  }
  clearBatches(){this.batch.traverse(node=>{node.geometry?.dispose();if(node.isInstancedMesh)node.dispose();if(node.material){node.material.dispose();this.materials.delete(node.material);}});this.batch.clear();this.locations.clear();}
  loadRecords(records){
    this.clearBatches();this.entries=new Map(records.map(r=>[r.id,r]));
    for(const array of Object.keys(colors)){
      const items=records.filter(r=>r.array===array&&r.geometry&&!r.warning);if(!items.length)continue;
      const material=new THREE.MeshBasicMaterial({color:colors[array],side:THREE.DoubleSide,transparent:true,opacity:.28,depthWrite:false});this.materials.add(material);
      if(['spheres','cylinders'].includes(array)){
        const geometry=array==='spheres'?new THREE.SphereGeometry(1,16,10):new THREE.CylinderGeometry(1,1,1,16,1,true),mesh=new THREE.InstancedMesh(geometry,material,items.length);
        mesh.userData.collisionIds=items.map(r=>r.id);this.batch.add(mesh);items.forEach((r,index)=>{this.locations.set(r.id,{mesh,index});this.writeInstance(r,mesh,index);});mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingBox();mesh.computeBoundingSphere();
      }else{
        const positions=[],ids=[];for(const record of items){const geometry=collisionDisplayGeometry(record),data=geometry.getAttribute('position').array,offset=positions.length;for(const n of data)positions.push(n);for(let n=0;n<data.length/9;n++)ids.push(record.id);this.locations.set(record.id,{offset,count:data.length});geometry.dispose();}
        const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.computeBoundingSphere();const mesh=new THREE.Mesh(geometry,material);mesh.userData.collisionIds=ids;this.batch.add(mesh);for(const r of items)this.locations.get(r.id).mesh=mesh;
      }
    }
  }
  writeInstance(record,mesh,index){
    const position=record.array==='spheres'?new THREE.Vector3(...record.center):new THREE.Vector3(record.center[0],0,record.center[1]),scale=record.array==='spheres'?new THREE.Vector3().setScalar(record.radius):new THREE.Vector3(record.radius,20,record.radius);
    mesh.setMatrixAt(index,new THREE.Matrix4().compose(position,new THREE.Quaternion(),scale));
  }
  updateRecord(record){
    this.entries.set(record.id,record);if(!this.locations.has(record.id)&&record.geometry&&!record.warning)this.loadRecords([...this.entries.values()]);const location=this.locations.get(record.id);
    if(location&&!record.warning&&record.geometry){
      if(location.index!==undefined){this.writeInstance(record,location.mesh,location.index);location.mesh.instanceMatrix.needsUpdate=true;location.mesh.computeBoundingBox();location.mesh.computeBoundingSphere();}
      else{const geometry=collisionDisplayGeometry(record),attribute=location.mesh.geometry.getAttribute('position');attribute.array.set(geometry.getAttribute('position').array,location.offset);attribute.needsUpdate=true;location.mesh.geometry.computeBoundingSphere();location.mesh.geometry.boundingBox=null;geometry.dispose();}
    }
    if(location&&(record.warning||!record.geometry)){
      if(location.index!==undefined){location.mesh.setMatrixAt(location.index,new THREE.Matrix4().makeScale(0,0,0));location.mesh.instanceMatrix.needsUpdate=true;location.mesh.computeBoundingBox();location.mesh.computeBoundingSphere();}
      else{location.mesh.geometry.getAttribute('position').array.fill(0,location.offset,location.offset+location.count);location.mesh.geometry.getAttribute('position').needsUpdate=true;location.mesh.geometry.computeBoundingSphere();location.mesh.geometry.boundingBox=null;}
    }
    if(record.id===this.selectedId){this.showHighlight(record);if(!this.gizmo.dragging)this.prepareSelection(record);}
  }
  showHighlight(record){
    if(this.highlight){this.root.remove(this.highlight);this.highlight.geometry.dispose();this.highlight=null;}
    if(!record.geometry||record.warning)return;
    this.highlight=new THREE.Mesh(collisionDisplayGeometry(record),this.highlightMaterial);this.root.add(this.highlight);
  }
  select(id,focus=true){
    this.selectedId=id;const record=this.entries.get(id);this.gizmo.detach();if(!record){if(this.highlight){this.highlight.geometry.dispose();this.root.remove(this.highlight);this.highlight=null;}this.baseRecord=null;this.onPick?.(null);return;}
    this.showHighlight(record);
    this.prepareSelection(record);if(record.geometry&&!record.warning&&focus)this.fit(this.proxy);
    this.onPick?.(id);
  }
  prepareSelection(record){
    if(!record.geometry||record.warning){this.gizmo.detach();return;}
    const g=record.geometry,center=g.unboundedY?[record.center[0],0,record.center[1]]:g.min.map((n,i)=>(n+g.max[i])/2);this.proxy.position.fromArray(center);this.proxy.quaternion.identity();this.proxy.scale.set(1,1,1);this.proxy.userData.frame={id:record.id};this.baseRecord=structuredClone(record);this.baseCenter=center;this.gizmo.attach(this.proxy);
  }
  transformSelection(){
    if(!this.baseRecord||!this.gizmo.object)return;this.proxy.updateMatrix();
    const delta=this.proxy.matrix.clone().multiply(new THREE.Matrix4().makeTranslation(...this.baseCenter.map(n=>-n))),changes=collisionTransformPatch(this.baseRecord,delta);
    this.onEdit?.(this.selectedId,changes);
  }
  fit(object=this.batch){super.fit(object===this.proxy?(this.highlight??this.batch):object);}
  finishPick(event){
    const start=this.start;this.start=null;if(event.button!==0||!start||this.gizmo.dragging||this.gizmo.axis||event.pointerId!==start[2]||Math.hypot(event.clientX-start[0],event.clientY-start[1])>4)return;
    const rect=this.renderer.domElement.getBoundingClientRect();this.camera.updateMatrixWorld();this.root.updateWorldMatrix(true,true);this.raycaster.setFromCamera(new THREE.Vector2((event.clientX-rect.left)/rect.width*2-1,1-(event.clientY-rect.top)/rect.height*2),this.camera);
    const hit=this.raycaster.intersectObjects(this.batch.children,true)[0];if(hit){const id=hit.object.userData.collisionIds[hit.instanceId??hit.faceIndex];if(id)this.select(id,false);}
  }
  dispose(){this.clearBatches();super.dispose();}
}
