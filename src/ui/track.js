import * as THREE from 'three';
import { Viewport } from './viewport.js';
import { AnimationPreview } from './animation.js';

// anim_machine_tick linearly interpolates both position and direction arrays.
// This isolated preview uses the track's local placement, without actor offsets
// or the engine's transitions between clips.
export function sampleTrack(positions, step, time) {
  if (!positions.length || !Number.isFinite(step) || step <= 0 || !Number.isFinite(time)) return null;
  const phase = Math.max(0,Math.min(positions.length-1,time/step)), index = Math.floor(phase), next = positions[Math.min(index+1,positions.length-1)];
  return positions[index].map((value,i) => value + (next[i]-value)*(phase-index));
}
export function companionAnimation(assets, path) {
  const name = path.replace(/\.tck$/i, '.5ds').normalize('NFC').toLowerCase();
  const matches = assets.filter(asset => asset.path.normalize('NFC').toLowerCase() === name);
  return matches.length === 1 ? matches[0].path : null;
}
export class TrackActorPreview {
  constructor(actor, frames, animation) {
    this.actor = actor; this.animation = animation; this.pose = new AnimationPreview(frames, animation);
  }
  seek(time, positions, secondary, step) {
    this.actor.position.fromArray(sampleTrack(positions, step, time));
    const direction = sampleTrack(secondary, step, time);
    this.actor.quaternion.identity();
    if (direction && Math.hypot(...direction) > 1e-8) {
      // LS3D actors face +Z; the viewport reflects Z once at the scene root.
      const matrix = new THREE.Matrix4().lookAt(new THREE.Vector3(...direction), new THREE.Vector3(), new THREE.Vector3(0,1,0));
      this.actor.quaternion.setFromRotationMatrix(matrix);
    }
    // Game animation keys use 40 ms frames. Keep bone-local base displacement;
    // the separate TCK placement belongs to the actor above the skeleton.
    this.pose.apply(Math.max(0, Math.min(this.animation.frames, time / 40)));
  }
}
export class TrackViewport extends Viewport {
  loadTrack(file) {
    this.positions = file.positions.map(v=>[...v]); this.secondary = file.secondary.map(v=>[...v]); this.step = file.step;
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
  loadActor(model, animation) {
    this.actor = new THREE.Group(); this.root.add(this.actor);
    this.actorPreview = new TrackActorPreview(this.actor, this.addModel(model, this.actor), animation);
    this.marker.visible = false;
    // Picking a preview must never attach an editing gizmo to the model.
    this.select = () => {};
    this.seek(this.time);
    return this.actorPreview.pose;
  }
  seek(time) { this.time = time; this.marker.position.fromArray(sampleTrack(this.positions,this.step,time)); this.actorPreview?.seek(time,this.positions,this.secondary,this.step); }
  updateDirection(index, value) {
    if (!this.secondary[index] || !validVector(value)) return;
    this.secondary[index] = [...value]; this.seek(this.time);
  }
  updateKey(index,value) {
    if (!this.positions[index] || !validVector(value)) return;
    this.positions[index] = [...value]; const attribute = this.path.geometry.getAttribute('position'); attribute.array.set(value,index*3); attribute.needsUpdate = true;
    this.path.geometry.boundingBox = this.path.geometry.boundingSphere = null; this.seek(this.time);
  }
}
function validVector(value) { return Array.isArray(value) && value.length === 3 && value.every(n => typeof n === 'number' && Number.isFinite(n) && Number.isFinite(Math.fround(n))); }
