import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';

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
      if (object) this.onChange(object.userData.frame, { position: object.position.toArray(), scale: object.scale.toArray(), rotation: [object.quaternion.w, object.quaternion.x, object.quaternion.y, object.quaternion.z] }, this.gizmo.mode);
    });
    this.root = new THREE.Group(); this.root.scale.z = -1; this.scene.add(this.root);
    this.scene.add(new THREE.HemisphereLight(0xe4edff, 0x55554a, 2));
    const light = new THREE.DirectionalLight(0xffffff, 2); light.position.set(5, 10, 7); this.scene.add(light);
    this.grid = new THREE.GridHelper(100, 50, 0x546658, 0x293832); this.scene.add(this.grid);
    this.scene.add(new THREE.AxesHelper(2));
    this.frames = new Map(); this.materials = new Set(); this.textures = new Set();
    this.raycaster = new THREE.Raycaster();
    this.down = event => { this.start = [event.clientX, event.clientY]; };
    this.up = event => {
      if (this.gizmo.dragging || this.gizmo.axis || !this.start || Math.hypot(event.clientX - this.start[0], event.clientY - this.start[1]) > 4) return;
      const rect = this.renderer.domElement.getBoundingClientRect();
      this.raycaster.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, 1 - (event.clientY - rect.top) / rect.height * 2), this.camera);
      const hit = this.raycaster.intersectObjects(this.root.children, true)[0];
      if (!hit) return;
      let object = hit.object; while (object && !object.userData.frame) object = object.parent;
      if (object) this.select(object.userData.frame.ownerId ?? object.userData.frame.id);
    };
    this.renderer.domElement.addEventListener('pointerdown', this.down); this.renderer.domElement.addEventListener('pointerup', this.up);
    this.observer = new ResizeObserver(() => this.resize()); this.observer.observe(container); this.resize();
    this.renderer.setAnimationLoop(() => { if (!this.disposed) { this.controls.update(); this.renderer.render(this.scene, this.camera); } });
  }
  resize() { const w = this.container.clientWidth, h = this.container.clientHeight; if (!w || !h) return; this.renderer.setSize(w, h); this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }
  addModel(model, parent = this.root, key = '', overrides = new Map()) {
    const frames = new Map(), geometry = new Map();
    for (const frame of model.meshes) {
      const object = new THREE.Group(), override = overrides.get(frame.name.toLowerCase());
      object.name = frame.name; object.userData.frame = { ...frame, id: `${key}${frame.id}`, sourceId: frame.id, sceneObject: override };
      object.position.fromArray(override?.position ?? frame.position); object.scale.fromArray(override?.scale ?? frame.scale);
      const rotation = override?.rotation ?? frame.rotation; object.quaternion.set(rotation[1], rotation[2], rotation[3], rotation[0]);
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
            material.userData.texture = source?.texture; materials.push(material); this.materials.add(material);
          }
          base.setIndex(indices); if (!lod.normals.some(n => n !== 0)) base.computeVertexNormals();
          geometry.set(lod, { base, materials });
        }
        const cached = geometry.get(lod); object.add(new THREE.Mesh(cached.base, cached.materials));
      }
      const ancestor = frames.get(frame.parent);
      if (frame.parent && (!ancestor || frame.parent === frame.id)) throw new Error('4DS: neplatná hierarchie.');
      (ancestor ?? parent).add(object);
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
        texture.colorSpace = THREE.SRGBColorSpace; texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
        this.textures.add(texture); material.map = texture; material.needsUpdate = true;
      } catch { /* Missing or unsupported texture leaves its material colour visible. */ }
    }));
  }
  fit(object = this.root) {
    object.updateWorldMatrix(true, true); const box = new THREE.Box3().setFromObject(object);
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
    if (values.rotation) object.quaternion.set(values.rotation[1], values.rotation[2], values.rotation[3], values.rotation[0]);
  }
  addSceneObject(source, model = null) {
    const id = `scene:${source.id}`, object = new THREE.Group(); object.name = source.name;
    object.userData.frame = { id, name: source.name, sceneObject: source, editable: Boolean(source.fields.position) };
    object.position.fromArray(source.position ?? [0,0,0]); object.scale.fromArray(source.scale ?? [1,1,1]);
    const rotation = source.rotation ?? [1,0,0,0]; object.quaternion.set(rotation[1], rotation[2], rotation[3], rotation[0]);
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
  wireframe(value) { for (const material of this.materials) material.wireframe = value; }
  dispose() {
    this.disposed = true; this.observer.disconnect(); this.renderer.setAnimationLoop(null); this.controls.dispose(); this.gizmo.dispose();
    const geometries = new Set(); this.scene.traverse(o => { if (o.geometry) geometries.add(o.geometry); });
    for (const geometry of geometries) geometry.dispose(); for (const material of this.materials) material.dispose(); for (const texture of this.textures) texture.dispose();
    this.renderer.domElement.removeEventListener('pointerdown', this.down); this.renderer.domElement.removeEventListener('pointerup', this.up);
    this.renderer.dispose(); this.renderer.domElement.remove();
  }
}
