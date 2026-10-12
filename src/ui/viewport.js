import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { bindSkin } from './animation.js';
import { fromLs3dRotation, toLs3dRotation } from './transforms.js';

export class Viewport {
  constructor(container, onSelect = () => {}, onChange = () => {}) {
    this.container = container; this.onSelect = onSelect; this.onChange = onChange; this.disposed = false;
    this.scene = new THREE.Scene(); this.scene.background = new THREE.Color('#141e20');
    this.camera = new THREE.PerspectiveCamera(50, 1, .02, 20000);
    this.renderer = new THREE.WebGLRenderer({ antialias: true }); this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.domElement.setAttribute('aria-label', '3D pohled: levé tlačítko otáčí, pravé posouvá, kolečko přibližuje');
    container.append(this.renderer.domElement);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement); this.controls.enableDamping = true;
    this.gizmo = new TransformControls(this.camera, this.renderer.domElement); this.scene.add(this.gizmo.getHelper());
    this.gizmo.addEventListener('dragging-changed', event => { this.controls.enabled = !event.value; });
    this.gizmo.addEventListener('objectChange', () => {
      const object = this.gizmo.object;
      if (object) this.onChange(object.userData.frame, { position: object.position.toArray(), scale: object.scale.toArray(), rotation: toLs3dRotation(object.quaternion) }, this.gizmo.mode);
    });
    this.root = new THREE.Group(); this.root.scale.z = -1; this.scene.add(this.root);
    this.scene.add(new THREE.HemisphereLight(0xe4edff, 0x55554a, 2));
    const light = new THREE.DirectionalLight(0xffffff, 2); light.position.set(5, 10, 7); this.scene.add(light);
    this.grid = new THREE.GridHelper(100, 50, 0x546658, 0x293832); this.scene.add(this.grid);
    this.scene.add(new THREE.AxesHelper(2));
    this.frames = new Map(); this.materials = new Set(); this.textures = new Set(); this.skinWarnings = [];
    this.raycaster = new THREE.Raycaster();
    this.down = event => { this.start = [event.clientX, event.clientY]; };
    this.up = event => {
      if (this.gizmo.dragging || this.gizmo.axis || !this.start || Math.hypot(event.clientX - this.start[0], event.clientY - this.start[1]) > 4) return;
      const rect = this.renderer.domElement.getBoundingClientRect();
      this.raycaster.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, 1 - (event.clientY - rect.top) / rect.height * 2), this.camera);
      const hit = this.raycaster.intersectObjects(this.root.children, true).find(hit => { for (let o = hit.object; o; o = o.parent) if (!o.visible) return false; return true; });
      if (!hit) return;
      if (hit.object.userData.navigation && hit.instanceId !== undefined) { this.select(String(hit.instanceId)); return; }
      let object = hit.object; while (object && !object.userData.frame) object = object.parent;
      if (object) this.select(object.userData.frame.ownerId ?? object.userData.frame.id);
    };
    this.renderer.domElement.addEventListener('pointerdown', this.down); this.renderer.domElement.addEventListener('pointerup', this.up);
    this.observer = new ResizeObserver(() => this.resize()); this.observer.observe(container); this.resize();
    this.renderer.setAnimationLoop(time => { if (!this.disposed) { this.onFrame?.(time); this.controls.update(); this.renderer.render(this.scene, this.camera); } });
  }
  resize() { const w = this.container.clientWidth, h = this.container.clientHeight; if (!w || !h) return; this.renderer.setSize(w, h); this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }
  addModel(model, parent = this.root, key = '', overrides = new Map()) {
    const frames = new Map(), geometry = new Map(), skins = [];
    for (const frame of model.meshes) {
      const object = frame.type === 10 ? new THREE.Bone() : new THREE.Group(), override = overrides.get(frame.name.toLowerCase());
      object.name = frame.name; object.userData.frame = { ...frame, id: `${key}${frame.id}`, sourceId: frame.id, sceneObject: override };
      object.position.fromArray(override?.position ?? frame.position); object.scale.fromArray(override?.scale ?? frame.scale);
      fromLs3dRotation(override?.rotation ?? frame.rotation, object.quaternion);
      frames.set(frame.id, object); this.frames.set(object.userData.frame.id, object);
    }
    const resolve = (frame, visited = new Set()) => {
      if (visited.has(frame.id)) throw new Error('4DS: cyklická instance geometrie.'); visited.add(frame.id);
      if (frame.instance) { const source = model.meshes[frame.instance - 1]; if (!source) throw new Error('4DS: chybějící instance geometrie.'); return resolve(source, visited); }
      return frame.lods?.[0];
    };
    for (const frame of model.meshes) {
      const object = frames.get(frame.id), lod = resolve(frame);
      if (lod?.positions.length) {
        let base = geometry.get(lod);
        if (!base) {
          base = new THREE.BufferGeometry(); base.setAttribute('position', new THREE.Float32BufferAttribute(lod.positions, 3));
          base.setAttribute('normal', new THREE.Float32BufferAttribute(lod.normals, 3));
          // LS3D/Direct3D V=0 is the image's top; Three/WebGL UV starts at the bottom.
          base.setAttribute('uv', new THREE.Float32BufferAttribute(lod.uv.map((v, i) => i % 2 ? 1 - v : v), 2));
          const indices = [], materials = [];
          for (const face of lod.faces) {
            base.addGroup(indices.length, face.indices.length, materials.length); for (const index of face.indices) indices.push(index);
            const source = model.materials[face.material - 1];
            const material = new THREE.MeshStandardMaterial({ color: source ? new THREE.Color(...source.diffuse) : 0xb0bc9e, roughness: .85, side: THREE.DoubleSide, opacity: source?.opacity ?? 1, transparent: (source?.opacity ?? 1) < 1 });
            material.userData.texture = source?.texture;
            material.userData.textureColored = Boolean(source?.flags & 0x08000000);
            materials.push(material); this.materials.add(material);
          }
          base.setIndex(indices); if (!lod.normals.some(n => n !== 0)) base.computeVertexNormals();
          geometry.set(lod, { base, materials });
        }
        const cached = geometry.get(lod), skin = frame.skin?.[0];
        const mesh = skin ? new THREE.SkinnedMesh(cached.base, cached.materials) : new THREE.Mesh(cached.base, cached.materials);
        object.add(mesh); if (skin) skins.push({ mesh, object, skin });
      }
      const ancestor = frames.get(frame.parent);
      if (frame.parent && (!ancestor || frame.parent === frame.id)) throw new Error('4DS: neplatná hierarchie.');
      (ancestor ?? parent).add(object);
    }
    for (const { mesh, object, skin } of skins) if (!bindSkin(mesh, object, frames, skin)) {
      // Keep unsupported skin data visible in its static bind pose.
      object.remove(mesh); object.add(new THREE.Mesh(mesh.geometry, mesh.material));
      this.skinWarnings?.push(object.name);
    }
    return frames;
  }
  async loadTextures(resolveUrl) {
    const loader = new THREE.TextureLoader(), cache = new Map();
    await Promise.all([...this.materials].map(async material => {
      const name = material.userData.texture; if (!name) return;
      try {
        if (!cache.has(name)) cache.set(name, (async () => { const url = await resolveUrl(name); if (!url) return null; return loader.loadAsync(url); })());
        const texture = await cache.get(name); if (!texture) return;
        if (this.disposed) { texture.dispose(); return; }
        this.applyTexture(material, texture);
      } catch { /* Missing or unsupported texture leaves its material colour visible. */ }
    }));
  }
  applyTexture(material, texture) {
    texture.colorSpace = THREE.SRGBColorSpace; texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    // LS3D diffuse RGB tints a diffuse texture only with MTL_DIFFUSE_COLORED.
    // Otherwise authoring colours (e.g. blue face/legs) must not stain the image.
    if (!material.userData.textureColored) material.color.set(0xffffff);
    this.textures.add(texture); material.map = texture; material.needsUpdate = true;
  }
  fit(object = this.root) {
    object.updateWorldMatrix(true, true); const box = new THREE.Box3();
    // Hidden backdrop geometry must not expand the map bounds or enclose its camera.
    const visit = node => {
      if (!node.visible || node.userData.backdrop) return;
      if (node.isInstancedMesh) { node.computeBoundingBox(); box.union(node.boundingBox.clone().applyMatrix4(node.matrixWorld)); }
      else if (node.geometry) { node.geometry.computeBoundingBox(); box.union(node.geometry.boundingBox.clone().applyMatrix4(node.matrixWorld)); }
      for (const child of node.children) visit(child);
    };
    visit(object);
    if (box.isEmpty()) box.setFromCenterAndSize(new THREE.Vector3(), new THREE.Vector3(4, 4, 4));
    const center = box.getCenter(new THREE.Vector3()), size = Math.max(...box.getSize(new THREE.Vector3()).toArray(), .1);
    this.controls.target.copy(center); this.camera.position.copy(center).add(new THREE.Vector3(size * .9, size * .6, size * 1.1));
    this.camera.near = Math.max(.01, size / 10000); this.camera.far = Math.max(20000, size * 10); this.camera.updateProjectionMatrix(); this.controls.update();
  }
  select(id, editable = true) {
    const object = this.frames.get(id); if (!object) return;
    this.gizmo.detach(); if (editable && object.userData.frame.editable !== false) this.gizmo.attach(object);
    this.onSelect(object.userData.frame);
  }
  update(id, values) {
    const object = this.frames.get(id); if (!object) return;
    if (values.position) object.position.fromArray(values.position);
    if (values.scale) object.scale.fromArray(values.scale);
    if (values.rotation) fromLs3dRotation(values.rotation, object.quaternion);
  }
  addSceneObject(source, model = null) {
    const id = `scene:${source.id}`, object = new THREE.Group(); object.name = source.name;
    object.userData.frame = { id, name: source.name, sceneObject: source, editable: Boolean(source.fields.position) };
    object.position.fromArray(source.position ?? [0,0,0]); object.scale.fromArray(source.scale ?? [1,1,1]);
    fromLs3dRotation(source.rotation ?? [1,0,0,0], object.quaternion);
    this.root.add(object); this.frames.set(id, object);
    if (model) {
      const children = this.addModel(model, object, `${id}/`);
      for (const child of children.values()) { child.userData.frame.editable = false; child.userData.frame.ownerId = id; }
    } else {
      const material = new THREE.MeshBasicMaterial({ color: source.model ? 0xeea04c : 0x68a5ed }); this.materials.add(material);
      object.add(new THREE.Mesh(new THREE.SphereGeometry(.25, 8, 6), material));
    }
    return id;
  }
  linkScene() {
    if (!this.backdrop) { this.backdrop = new THREE.Group(); this.backdrop.userData.backdrop = true; this.backdrop.visible = false; this.root.add(this.backdrop); }
    const names = new Map(), links = new Map(), warnings = [];
    for (const object of this.frames.values()) if (!object.userData.frame.ownerId) {
      const name = object.name.toLowerCase();
      if (names.has(name)) names.set(name, null); else names.set(name, object);
    }
    for (const object of this.frames.values()) {
      const source = object.userData.frame.sceneObject; if (!source?.parent) continue;
      const name = source.parent.toLowerCase();
      const parent = name === 'primary sector' ? this.root : name === 'backdrop sector' ? this.backdrop : names.get(name);
      if (!parent) { warnings.push(`${source.name}: rodič ${source.parent} chybí nebo je nejednoznačný`); continue; }
      links.set(object, parent);
    }
    // Validate all proposed links before changing an existing valid 4DS hierarchy.
    for (const [object, parent] of links) {
      const visited = new Set([object]); let current = parent;
      while (current) { if (visited.has(current)) throw new Error('Scene: cyklická hierarchie objektů mapy.'); visited.add(current); current = links.get(current) ?? current.parent; }
    }
    for (const [object, parent] of links) parent.add(object);
    return warnings;
  }
  showBackdrop(value) { if (this.backdrop) this.backdrop.visible = value; }
  wireframe(value) { for (const material of this.materials) material.wireframe = value; }
  dispose() {
    this.disposed = true; this.observer.disconnect(); this.renderer.setAnimationLoop(null); this.controls.dispose(); this.gizmo.dispose();
    const geometries = new Set(); this.scene.traverse(o => { if (o.geometry) geometries.add(o.geometry); });
    this.scene.traverse(o => o.skeleton?.dispose());
    for (const geometry of geometries) geometry.dispose(); for (const material of this.materials) material.dispose(); for (const texture of this.textures) texture.dispose();
    this.renderer.domElement.removeEventListener('pointerdown', this.down); this.renderer.domElement.removeEventListener('pointerup', this.up);
    this.renderer.dispose(); this.renderer.domElement.remove();
  }
}
