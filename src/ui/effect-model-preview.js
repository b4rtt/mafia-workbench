import * as THREE from 'three';
import { Viewport } from './viewport.js';

// A static view of the visual cloned by a particle, not an emitter simulation.
// Keep every transform in the hierarchy, but never show volumes or attach gizmos.
export class EffectModelViewport extends Viewport {
  load(model) {
    this.addModel({ ...model, meshes: model.meshes.map(mesh => ({ ...mesh, editable: false })) });
    this.partBox = new THREE.Box3Helper(new THREE.Box3(), 0xffbd55);
    this.partBox.visible = false; this.scene.add(this.partBox); this.materials.add(this.partBox.material);
  }
  select(id) { super.select(id, false, false); }
  showPart(id, whole = false) {
    this.partId = String(id); const bounds = new THREE.Box3();
    this.root.updateWorldMatrix(true, true);
    for (const [key, object] of this.frames) {
      // The engine enables its cloned visual, even if its source is hidden.
      object.visible = true;
      for (const child of object.children) {
        if (child.isMesh) {
          child.visible = object.userData.frame.type === 1 && (whole || key === this.partId);
          if (key === this.partId && child.visible) {
            child.geometry.computeBoundingBox(); bounds.union(child.geometry.boundingBox.clone().applyMatrix4(child.matrixWorld));
          }
        } else if (child.userData.sectorPreview) child.visible = false;
      }
    }
    this.partBox.box.copy(bounds); this.partBox.visible = whole && !bounds.isEmpty();
  }
  fitPart() {
    const parts = this.frames.get(this.partId)?.children.filter(child => child.isMesh && child.visible) ?? [];
    if (parts.length) this.fit(parts);
  }
}
