import * as THREE from 'three';
import { fromLs3dRotation } from './transforms.js';

// 5DS keys store absolute local transforms. Missing channels retain the bind pose.
export function sampleTrack(track, frame, rotation = false) {
  if (!track?.times.length) return null;
  let low = 0, high = track.times.length;
  while (low < high) { const middle = (low + high) >>> 1; if (track.times[middle] <= frame) low = middle + 1; else high = middle; }
  const a = Math.max(0, low - 1), b = Math.min(low, track.times.length - 1);
  const span = track.times[b] - track.times[a], mix = span > 0 ? Math.max(0, Math.min(1, (frame - track.times[a]) / span)) : 0;
  if (!rotation) return track.values[a].map((value, i) => value + (track.values[b][i] - value) * mix);
  const quaternion = value => new THREE.Quaternion(value[1], value[2], value[3], value[0]).normalize();
  const value = quaternion(track.values[a]).slerp(quaternion(track.values[b]), mix);
  return [value.w, value.x, value.y, value.z];
}

export function bindSkin(mesh, owner, frames, skin) {
  if (!skin?.valid) return false;
  const bones = [owner];
  for (const group of skin.bones) {
    const matches = [...frames.values()].filter(object => {
      if (object.userData.frame.joint !== group.id) return false;
      let ancestor = object.parent;
      while (ancestor && ancestor !== owner) ancestor = ancestor.parent;
      return ancestor === owner;
    });
    if (matches.length !== 1) return false;
    bones.push(matches[0]);
  }
  const count = mesh.geometry.getAttribute('position').count, indices = new Uint16Array(count * 4), weights = new Float32Array(count * 4);
  let vertex = 0;
  for (const group of skin.bones) {
    for (let i = 0; i < group.rigid; i++, vertex++) { indices[vertex * 4] = group.id; weights[vertex * 4] = 1; }
    for (const weight of group.weights) {
      indices[vertex * 4] = group.id; indices[vertex * 4 + 1] = group.parent;
      weights[vertex * 4] = weight; weights[vertex * 4 + 1] = 1 - weight; vertex++;
    }
  }
  for (let i = 0; i < skin.rootVertices; i++, vertex++) weights[vertex * 4] = 1;
  if (vertex !== count) return false;
  mesh.geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(indices, 4));
  mesh.geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
  // Derive inverses from the displayed bind hierarchy, including frame scales and
  // the viewport's coordinate conversion. Source inverse matrices remain untouched.
  owner.updateWorldMatrix(true, true);
  const skeleton = new THREE.Skeleton(bones); mesh.bind(skeleton, mesh.matrixWorld);
  mesh.frustumCulled = false;
  return true;
}

export class AnimationPreview {
  constructor(frames, animation) {
    this.frames = frames; this.rest = new Map(); this.matches = []; this.unmatched = []; this.nodes = animation.nodes;
    const names = new Map();
    for (const object of frames.values()) {
      this.rest.set(object, { position: object.position.clone(), quaternion: object.quaternion.clone(), scale: object.scale.clone() });
      const name = object.name.normalize('NFC').toLowerCase(); names.set(name, names.has(name) ? null : object);
    }
    this.names = names; this.match();
  }
  match(draft = new Map()) {
    this.matches = []; this.unmatched = [];
    for (const node of this.nodes) {
      const name = draft.get(`nodes/${node.id}/name`) ?? node.name;
      const object = typeof name === 'string' ? this.names.get(name.normalize('NFC').toLowerCase()) : null;
      if (object) this.matches.push({ object, node }); else this.unmatched.push(node.name);
    }
  }
  apply(frame, draft = new Map()) {
    this.match(draft);
    for (const [object, rest] of this.rest) { object.position.copy(rest.position); object.quaternion.copy(rest.quaternion); object.scale.copy(rest.scale); }
    for (const { object, node } of this.matches) {
      for (const channel of ['position', 'rotation', 'scale']) {
        const track = node.tracks[channel]; if (!track) continue;
        const values = track.values.map((value, i) => draft.get(`nodes/${node.id}/${channel}/${i}`) ?? value);
        if (values.some(value => !Array.isArray(value) || value.length !== (channel === 'rotation' ? 4 : 3) || value.some(v => typeof v !== 'number' || !Number.isFinite(v)))) continue;
        const value = sampleTrack({ times: track.times, values }, frame, channel === 'rotation'); if (!value) continue;
        if (channel === 'rotation') fromLs3dRotation(value, object.quaternion); else object[channel].fromArray(value);
      }
    }
  }
}
