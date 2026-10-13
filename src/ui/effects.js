import * as THREE from 'three';
import {Viewport} from './viewport.js';

// Markers show stored placement vectors, not a particle simulation.
export class EffectsViewport extends Viewport {
  loadEffects(file){
    this.effectRecords=new Map();this.focusOnSelect=true;
    const material=new THREE.MeshBasicMaterial({color:0xffa94d});this.materials.add(material);
    for(const effect of file.effects){
      const object=new THREE.Group();object.name=effect.id;object.position.fromArray(effect.position);
      object.userData.frame={id:effect.id,name:effect.id,effectIndex:effect.index};
      object.add(new THREE.Mesh(new THREE.SphereGeometry(.18,8,6),material));
      const arrow=new THREE.ArrowHelper(new THREE.Vector3(0,1,0),new THREE.Vector3(),1,0xffd280,.25,.15);object.add(arrow);
      this.materials.add(arrow.line.material);this.materials.add(arrow.cone.material);
      this.frames.set(effect.id,object);this.effectRecords.set(effect.id,{...effect,arrow});this.root.add(object);this.updateEffect(effect.id,effect);
    }
    this.fit();
  }
  updateEffect(id,value){
    const record=this.effectRecords.get(id),object=this.frames.get(id);if(!record||!object)return;
    if(value.position){record.position=[...value.position];object.position.fromArray(value.position);}
    if(value.direction){record.direction=[...value.direction];const direction=new THREE.Vector3(...value.direction);record.arrow.visible=direction.lengthSq()>0;if(record.arrow.visible)record.arrow.setDirection(direction.normalize());}
  }
  showGeometry(value){
    if(this.contextGeometry)this.contextGeometry.visible=value;
    for(const [id,record] of this.effectRecords)this.frames.get(id).visible=!value||!record.frame&&record.bindingEditable;
  }
  select(id,editable=true,focus=this.focusOnSelect){
    const record=this.effectRecords.get(id);if(!record)return;
    if(record.frame||!record.bindingEditable)this.showGeometry(false);
    this.selectedId=id;super.select(id,editable,focus);
  }
}
