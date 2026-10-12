import * as THREE from 'three';
import { Viewport } from './viewport.js';

// This is a linear trajectory preview; it does not emulate the game's actor,
// bone animation, heading or animation-machine blending.
export function sampleTrack(positions, step, time) {
  if (!positions.length || !Number.isFinite(step) || step <= 0 || !Number.isFinite(time)) return null;
  const phase = Math.max(0,Math.min(positions.length-1,time/step)), index = Math.floor(phase), next = positions[Math.min(index+1,positions.length-1)];
  return positions[index].map((value,i) => value + (next[i]-value)*(phase-index));
}
export class TrackViewport extends Viewport {
  loadTrack(file) {
    this.positions = file.positions.map(v=>[...v]); this.step = file.step;
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position',new THREE.Float32BufferAttribute(this.positions.flat(),3));
    const material = new THREE.LineBasicMaterial({color:0x5fcaff}); this.materials.add(material);
    this.path = new THREE.Line(geometry,material); this.path.raycast = () => {}; this.root.add(this.path);
    const markerMaterial = new THREE.MeshBasicMaterial({color:0xffd56a}); this.materials.add(markerMaterial);
    this.marker = new THREE.Mesh(new THREE.SphereGeometry(1,12,8),markerMaterial); this.marker.raycast = () => {}; this.root.add(this.marker);
    this.seek(0); this.fit(this.path);
  }
  fit(object = this.path) {
    super.fit(object);
    if (this.marker) {
      const size = new THREE.Box3().setFromObject(this.path).getSize(new THREE.Vector3());
      this.marker.scale.setScalar(Math.max(size.x,size.y,size.z,.1)*.015);
    }
  }
  seek(time) { this.time = time; this.marker.position.fromArray(sampleTrack(this.positions,this.step,time)); }
  updateKey(index,value) {
    if (!this.positions[index] || !Array.isArray(value) || value.length!==3 || value.some(n=>typeof n!=='number'||!Number.isFinite(n)||!Number.isFinite(Math.fround(n)))) return;
    this.positions[index] = [...value]; const attribute = this.path.geometry.getAttribute('position'); attribute.array.set(value,index*3); attribute.needsUpdate = true;
    this.path.geometry.boundingBox = this.path.geometry.boundingSphere = null; this.seek(this.time);
  }
}
