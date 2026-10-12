import * as THREE from 'three';
import { Viewport } from './viewport.js';

// An explicitly linear path inspection, not the engine's camera interpolation.
// Bit 2 marks a cut boundary; its following records are the outgoing endpoint
// (bit 4) and incoming start (bit 8). The marker itself contains no pose.
export function replayPathSegments(keys) {
  const stop=keys.findIndex(key=>key.stop),limit=stop<0?keys.length:stop,anchors=[];
  for(let i=0;i<limit;i++)if(((keys[i].flags??1)&3)!==0)anchors.push(i);
  const pose=(index,side)=>{const key=keys[index];if(key.flags===2){const target=index+(side==='from'?2:1);return target<limit&&keys[target].flags===(side==='from'?8:4)?target:-1;}return index;};
  const segments=[];
  for(let i=0;i+1<anchors.length;i++) {
    const start=keys[anchors[i]].time,end=keys[anchors[i+1]].time,from=pose(anchors[i],'from'),to=pose(anchors[i+1],'to');
    if(end>start&&from>=0&&to>=0&&keys[from].position&&keys[to].position)segments.push({start,end,from,to});
  }
  const first=anchors.length?pose(anchors[0],'from'):-1,last=anchors.length?pose(anchors.at(-1),'from'):-1;
  return {segments,first,last,stopTime:stop<0?Infinity:keys[stop].time};
}
export function sampleReplayPath(keys,time) {
  const path=replayPathSegments(keys);if(!Number.isFinite(time)||time>=path.stopTime||path.first<0)return null;
  const segment=path.segments.find(s=>time>=s.start&&time<s.end);
  if(!segment){const index=time<keys[path.first].time?path.first:path.last;return keys[index]?.position?[...keys[index].position]:null;}
  const a=keys[segment.from],b=keys[segment.to],start=a.curveTime??a.time,end=b.curveTime??b.time,phase=end===start?0:Math.max(0,Math.min(1,(time-start)/(end-start)));
  return a.position.map((n,i)=>n+(b.position[i]-n)*phase);
}
export class ReplayViewport extends Viewport {
  loadReplay(file) {
    this.replay={cameras:file.cameras.map(k=>({...k,position:k.position?[...k.position]:undefined})),focus:file.focus.map(k=>({...k,position:k.position?[...k.position]:undefined}))};this.paths=new THREE.Group();this.root.add(this.paths);this.markers=[];
    for(const [id,color]of [['cameras',0x5fcaff],['focus',0x95d26a]]) {
      const keys=this.replay[id],path=replayPathSegments(keys),indices=path.segments.flatMap(s=>[s.from,s.to]);if(!indices.length&&keys[path.first]?.position)indices.push(path.first,path.first);const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(indices.flatMap(i=>keys[i].position),3));
      const material=new THREE.LineBasicMaterial({color});this.materials.add(material);const line=new THREE.LineSegments(geometry,material);line.raycast=()=>{};this.paths.add(line);
      const markerMaterial=new THREE.MeshBasicMaterial({color});this.materials.add(markerMaterial);const marker=new THREE.Mesh(new THREE.SphereGeometry(1,12,8),markerMaterial);marker.raycast=()=>{};this.root.add(marker);this.markers.push({id,marker,line,indices});
    }
    this.seek(0);this.fit(this.paths);
  }
  fit(object=this.paths) {super.fit(object);if(this.markers){const size=new THREE.Box3().setFromObject(object).getSize(new THREE.Vector3()),radius=Math.max(size.x,size.y,size.z,.1)*.012;for(const{marker}of this.markers)marker.scale.setScalar(radius);}}
  fitShot(time=this.time) {
    const positions=[];
    for(const keys of [this.replay.cameras,this.replay.focus]) {
      const path=replayPathSegments(keys),segment=path.segments.find(s=>time>=s.start&&time<s.end),sample=sampleReplayPath(keys,time);
      if(segment)positions.push(keys[segment.from].position,keys[segment.to].position);else if(sample)positions.push(sample);
    }
    if(!positions.length)return;
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions.flat(),3));const bounds=new THREE.Line(geometry);this.root.add(bounds);
    try{this.fit(bounds);}finally{this.root.remove(bounds);geometry.dispose();bounds.material.dispose();}
  }
  seek(time) {this.time=time;const stop=this.replay.cameras.find(key=>key.stop),ended=stop&&time>=stop.time;for(const{id,marker}of this.markers){const position=ended?null:sampleReplayPath(this.replay[id],time);marker.visible=!!position;if(position)marker.position.fromArray(position);}}
  updateEntry(id,value) {
    const match=/^(camera|focus)\/(\d+)\/position$/.exec(id);if(!match||!Array.isArray(value)||value.length!==3||value.some(n=>typeof n!=='number'||!Number.isFinite(Math.fround(n))))return;
    const channel=match[1]==='camera'?'cameras':'focus',index=Number(match[2]),key=this.replay[channel][index];if(!key||key.stop||key.cut)return;key.position=[...value];const{line,indices}=this.markers.find(m=>m.id===channel),attribute=line.geometry.attributes.position;indices.forEach((keyIndex,point)=>{if(keyIndex===index)attribute.array.set(value,point*3);});attribute.needsUpdate=true;line.geometry.boundingBox=line.geometry.boundingSphere=null;this.seek(this.time);
  }
}
