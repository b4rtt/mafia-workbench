import * as THREE from 'three';
import { EffectModelViewport } from './effect-model-preview.js';
import { ParticleSimulation } from './particle-simulation.js';
import { materialTransparency } from './materials.js';
import { textureSequence, textureFrame } from './texture-animation.js';

// Reuse the model reader and texture/mask loader; duplicate only the selected
// visual's geometry, never its helpers, descendants or source-frame placement.
export class ParticleViewport extends EffectModelViewport {
  async loadTextureAnimations(resolveUrl) {
    if (this.disposed) return;
    this.textureAnimations = new Map();
    const warnings = new Set(this.textureWarnings), pending = [], staged = []; let budget = 0;
    try {
      for (const material of this.materials) {
        try {
          const source = material.userData.source, sequence = textureSequence(source); if (!sequence) continue;
          if (budget + sequence.names.length > 256) throw Error('Dosažen limit 256 snímků animovaných textur.');
          if (source.flags & 0x02000000 && material.userData.alpha?.alphaTexture) throw Error('Animace samostatné alpha masky není podporovaná: ' + source.texture);
          budget += sequence.names.length;
          const frames = [material];
          for (const name of sequence.names.slice(1)) {
            const frame = material.clone(); frame.map = frame.alphaMap = null;
            frame.userData.texture = name; frame.userData.source = { ...source, texture: name }; frame.userData.alpha = materialTransparency(frame.userData.source);
            staged.push(frame); frames.push(frame);
          }
          pending.push({ material, sequence, frames });
        } catch (error) { warnings.add(error.message); }
      }
      // Same BMP colour key, embedded alpha, mask and wrapping as frame zero.
      // Load candidates together to share images; don't reload scene materials.
      if (staged.length) for (const warning of await super.loadTextures(resolveUrl, null, staged)) warnings.add(warning);
      if (this.disposed) return;
      for (const { material, sequence, frames } of pending) {
        if (frames.some(frame => !frame.map || frame.userData.alpha?.alphaTexture && !frame.alphaMap)) { warnings.add('Neúplná animovaná textura, používám první snímek: ' + material.userData.texture); continue; }
        this.textureAnimations.set(material, { ...sequence, frames: frames.map(frame => ({ map: frame.map, alphaMap: frame.alphaMap })) });
      }
    } finally {
      for (const material of staged) material.dispose();
      this.textureWarnings = [...warnings];
    }
  }
  prepare(type, options = {}) {
    this.simulation = new ParticleSimulation(type, options); this.sources = new Map(); this.instances = new Map();
    this.particleRoot = new THREE.Group(); this.particleRoot.scale.z = -1; this.scene.add(this.particleRoot);
    for (const emitter of this.simulation.definitions) {
      const matches = [...this.frames.values()].filter(frame => frame.name === emitter.frame && frame.userData.frame.type === 1);
      const meshes = matches.length === 1 ? matches[0].children.filter(child => child.isMesh && !child.isSkinnedMesh) : [];
      if (!meshes.length) throw Error(`Část emitoru „${emitter.frame}“ nemá podporovanou geometrii.`);
      this.sources.set(emitter.id, meshes);
    }
    this.root.visible = false; this.partBox.visible = false; this.sync();
    // Continuous emitters may have no particle at t=0. Frame one second of
    // deterministic motion once, then rewind without moving the camera.
    if (!this.instances.size) { this.seek(1000); this.fitParticles(); this.restart(); }
    else this.fitParticles();
  }
  clearParticles() {
    for (const instance of this.instances?.values() ?? []) {
      instance.traverse(node => { for (const material of node.material ?? []) { material.dispose(); this.materials.delete(material); } });
      instance.removeFromParent();
    }
    this.instances?.clear();
  }
  seek(time) { this.simulation.seek(time); this.sync(); }
  restart() { this.clearParticles(); this.simulation.reset(); this.sync(); }
  sync() {
    const live = new Set(this.simulation.particles.map(particle => particle.id));
    for (const [id, instance] of this.instances) if (!live.has(id)) {
      instance.traverse(node => { for (const material of node.material ?? []) { material.dispose(); this.materials.delete(material); } });
      instance.removeFromParent(); this.instances.delete(id);
    }
    this.camera.updateWorldMatrix(true, false);
    const camera = this.camera.getWorldQuaternion(new THREE.Quaternion()), reflected = new THREE.Quaternion(-camera.x, -camera.y, camera.z, camera.w);
    for (const particle of this.simulation.particles) {
      const d = particle.emitter.definition; let instance = this.instances.get(particle.id);
      if (!instance) {
        instance = new THREE.Group(); this.particleRoot.add(instance); this.instances.set(particle.id, instance);
        for (const source of this.sources.get(d.id)) {
          const materials = source.material.map(material => {
            const result = new THREE.MeshBasicMaterial({ color: material.color, map: material.map, alphaMap: material.alphaMap, opacity: material.opacity, alphaTest: material.alphaTest, transparent: true, depthWrite: false, side: material.side, blending: d.mode === 2 ? THREE.AdditiveBlending : THREE.NormalBlending });
            result.userData.baseOpacity = material.opacity; result.userData.textureAnimation = this.textureAnimations?.get(material); this.materials.add(result); return result;
          });
          instance.add(new THREE.Mesh(source.geometry, materials));
        }
      }
      instance.position.copy(particle.position); instance.scale.copy(particle.scale);
      instance.visible = !(d.phases[particle.phase].flags & 8) && (!this.emitterId || this.emitterId === d.id);
      if (d.flags & 1) instance.quaternion.copy(reflected);
      else if (d.flags & 2 && particle.velocity.lengthSq() > 1e-16) instance.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), particle.velocity.clone().normalize());
      else instance.quaternion.identity();
      instance.quaternion.multiply(particle.rotation);
      for (const mesh of instance.children) for (const material of mesh.material) {
        material.opacity = material.userData.baseOpacity * particle.alpha;
        const animation = material.userData.textureAnimation;
        if (animation) { const frame = animation.frames[textureFrame(animation, particle.age)]; material.map = frame.map; material.alphaMap = frame.alphaMap; }
      }
    }
  }
  fitParticles() {
    const visible = [...this.instances.values()].filter(object => object.visible);
    if (visible.length) this.fit(visible);
    else { this.camera.position.set(3, 2, 4); this.controls.target.set(0, .5, 0); this.controls.update(); }
  }
}
