import * as THREE from 'three';
import { Viewport } from './viewport.js';

// An explicitly linear path inspection, not the engine's camera interpolation.
export function sampleReplayPath(keys,time) {
  const stop=keys.findIndex(key=>key.stop);if(stop>=0){if(time>=keys[stop].time)return null;keys=keys.slice(0,stop);}
  if(!keys.length||!Number.isFinite(time))return null;
  let index=0;while(index+1<keys.length&&keys[index+1].time<=time)index++;
  const a=keys[index],b=keys[Math.min(index+1,keys.length-1)],phase=b.time===a.time?0:Math.max(0,Math.min(1,(time-a.time)/(b.time-a.time)));
  return a.position.map((n,i)=>n+(b.position[i]-n)*phase);
}
export class ReplayViewport extends Viewport {
  loadReplay(file) {
    this.replay={cameras:file.cameras.map(k=>({...k,position:k.position?[...k.position]:undefined})),focus:file.focus.map(k=>({...k,position:[...k.position]}))};this.paths=new THREE.Group();this.root.add(this.paths);this.markers=[];
    for(const [id,color]of [['cameras',0x5fcaff],['focus',0x95d26a]]) {
      const keys=this.replay[id],stop=keys.findIndex(key=>key.stop),indices=keys.slice(0,stop<0?keys.length:stop).map((_,i)=>i),geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(indices.flatMap(i=>keys[i].position),3));
      const material=new THREE.LineBasicMaterial({color});this.materials.add(material);const line=new THREE.Line(geometry,material);line.raycast=()=>{};this.paths.add(line);
      const markerMaterial=new THREE.MeshBasicMaterial({color});this.materials.add(markerMaterial);const marker=new THREE.Mesh(new THREE.SphereGeometry(1,12,8),markerMaterial);marker.raycast=()=>{};this.root.add(marker);this.markers.push({id,marker,line,indices});
    }
    this.seek(0);this.fit(this.paths);
  }
  fit(object=this.paths) {super.fit(object);if(this.markers){const size=new THREE.Box3().setFromObject(this.paths).getSize(new THREE.Vector3()),radius=Math.max(size.x,size.y,size.z,.1)*.012;for(const{marker}of this.markers)marker.scale.setScalar(radius);}}
  seek(time) {this.time=time;const stop=this.replay.cameras.find(key=>key.stop),ended=stop&&time>=stop.time;for(const{id,marker}of this.markers){const position=ended?null:sampleReplayPath(this.replay[id],time);marker.visible=!!position;if(position)marker.position.fromArray(position);}}
  updateEntry(id,value) {
    const match=/^(camera|focus)\/(\d+)\/position$/.exec(id);if(!match||!Array.isArray(value)||value.length!==3||value.some(n=>typeof n!=='number'||!Number.isFinite(Math.fround(n))))return;
    const channel=match[1]==='camera'?'cameras':'focus',index=Number(match[2]),key=this.replay[channel][index];if(!key||key.stop)return;key.position=[...value];const{line,indices}=this.markers.find(m=>m.id===channel),point=indices.indexOf(index);if(point>=0){const attribute=line.geometry.attributes.position;attribute.array.set(value,point*3);attribute.needsUpdate=true;line.geometry.boundingBox=line.geometry.boundingSphere=null;}this.seek(this.time);
  }
}
