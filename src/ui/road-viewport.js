import * as THREE from 'three';
import {NavigationViewport} from './navigation.js';
import {roadLanePreview} from '../shared/road-lanes.js';

export class RoadViewport extends NavigationViewport {
  fitRoadNetwork(){
    const frame=new THREE.Group();frame.scale.copy(this.root.scale);frame.add(this.markers.clone());
    if(this.roadLaneOverlay?.visible)frame.add(this.roadLaneOverlay.clone());
    this.fit(frame);
  }
  setRoadLanes(file,visible=this.roadLanesVisible??true){
    this.roadLaneFile=file;this.roadLanesVisible=visible;
    if(!this.roadLaneOverlay){
      const material=new THREE.LineBasicMaterial({vertexColors:true,transparent:true,opacity:.9,depthTest:false,depthWrite:false});this.materials.add(material);
      this.roadLaneOverlay=new THREE.LineSegments(new THREE.BufferGeometry(),material);this.roadLaneOverlay.raycast=()=>{};this.roadLaneOverlay.renderOrder=3;this.root.add(this.roadLaneOverlay);
    }
    this.syncRoadLanes();
  }
  syncRoadLanes(){
    if(!this.roadLaneOverlay)return;
    this.roadLaneOverlay.visible=this.roadLanesVisible;
    if(!this.roadLanesVisible){this.onRoadLanePreview?.(null);return;}
    const preview=roadLanePreview(this.roadLaneFile,this.selectedPoint,this.positions),vertices=[],colors=[];
    for(const arrow of preview.arrows){
      const color=new THREE.Color(arrow.type===1?0x63e6ad:arrow.type===2?0xff8c6c:0xffd56a);
      vertices.push(...arrow.start,...arrow.end,...arrow.end,...arrow.left,...arrow.end,...arrow.right);
      for(let i=0;i<6;i++)colors.push(color.r,color.g,color.b);
    }
    this.roadLaneOverlay.geometry.dispose();const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));this.roadLaneOverlay.geometry=geometry;
    this.onRoadLanePreview?.({...preview,arrows:preview.arrows.length});
  }
  select(...args){super.select(...args);this.syncRoadLanes();}
  updatePoint(...args){super.updatePoint(...args);this.syncRoadLanes();}
}
