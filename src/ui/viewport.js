import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { bindSkin } from './animation.js';
import { fromLs3dRotation, toLs3dRotation } from './transforms.js';
import { materialTransparency, bmpTransparency, textureWithMask } from './materials.js';
import { createSoundExtent } from './sound-extent.js';

export class Viewport {
  constructor(container, onSelect = () => {}, onChange = () => {}) {
    this.container = container; this.onSelect = onSelect; this.onChange = onChange; this.disposed = false;
    this.scene = new THREE.Scene(); this.scene.background = new THREE.Color('#141e20');
    this.camera = new THREE.PerspectiveCamera(50, 1, .02, 20000);
    this.renderer = new THREE.WebGLRenderer({ antialias: true }); this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.domElement.setAttribute('aria-label', '3D pohled: levé tlačítko otáčí, pravé posouvá, kolečko přibližuje');
    container.append(this.renderer.domElement);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement); this.controls.enableDamping = true;
    this.controls.zoomToCursor = true; this.controls.minDistance = .02;
    this.controls.addEventListener('change', () => {
      this.camera.near = Math.max(.001, Math.min(.02, this.camera.position.distanceTo(this.controls.target) / 1000));
      this.camera.updateProjectionMatrix();
    });
    this.gizmo = new TransformControls(this.camera, this.renderer.domElement); this.scene.add(this.gizmo.getHelper());
    this.gizmo.addEventListener('dragging-changed', event => { this.controls.enabled = !event.value; });
    this.gizmo.addEventListener('objectChange', () => {
      const object = this.gizmo.object;
      if (object) this.onChange(object.userData.frame, { position: object.position.toArray(), scale: object.scale.toArray(), rotation: toLs3dRotation(object.quaternion) }, this.gizmo.mode);
      this.syncSoundExtent();
    });
    this.root = new THREE.Group(); this.root.scale.z = -1; this.scene.add(this.root);
    this.scene.add(new THREE.HemisphereLight(0xe4edff, 0x55554a, 2));
    const light = new THREE.DirectionalLight(0xffffff, 2); light.position.set(5, 10, 7); this.scene.add(light);
    this.grid = new THREE.GridHelper(100, 50, 0x546658, 0x293832); this.scene.add(this.grid);
    this.scene.add(new THREE.AxesHelper(2));
    this.frames = new Map(); this.materials = new Set(); this.textures = new Set(); this.skinWarnings = [];
    this.raycaster = new THREE.Raycaster();
    this.down = event => this.beginPick(event); this.up = event => this.finishPick(event);
    this.renderer.domElement.addEventListener('pointerdown', this.down); this.renderer.domElement.addEventListener('pointerup', this.up);
    this.observer = new ResizeObserver(() => this.resize()); this.observer.observe(container); this.resize();
    this.renderer.setAnimationLoop(time => { if (!this.disposed) { this.onFrame?.(time); if (this.controls.enabled) this.controls.update(); this.renderer.render(this.scene, this.camera); } });
  }
  beginPick(event) { this.start = event.button === 0 ? [event.clientX, event.clientY, event.pointerId] : null; }
  finishPick(event) {
    const start = this.start; this.start = null;
    if (event.button !== 0 || this.gizmo.dragging || this.gizmo.axis || !start || event.pointerId !== start[2] || Math.hypot(event.clientX - start[0], event.clientY - start[1]) > 4) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.raycaster.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, 1 - (event.clientY - rect.top) / rect.height * 2), this.camera);
    const hit = this.raycaster.intersectObjects(this.root.children, true).find(hit => { for (let o = hit.object; o; o = o.parent) if (!o.visible) return false; return true; });
    if (!hit) return;
    if (hit.object.userData.navigation && hit.instanceId !== undefined) { this.select(String(hit.instanceId)); return; }
    let object = hit.object; while (object && !object.userData.frame) object = object.parent;
    if (object) this.select(object.userData.frame.ownerId ?? object.userData.frame.id);
  }
  resize() { const w = this.container.clientWidth, h = this.container.clientHeight; if (!w || !h) return; this.renderer.setSize(w, h); this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }
  addModel(model, parent = this.root, key = '', overrides = new Map()) {
    const frames = new Map(), geometry = new Map(), skins = [];
    for (const frame of model.meshes) {
      const object = frame.type === 10 ? new THREE.Bone() : new THREE.Group(), override = overrides.get(frame.name.toLowerCase());
      object.name = frame.name; object.userData.frame = { ...frame, id: `${key}${frame.id}`, sourceId: frame.id, sceneObject: override };
      // CF_ENABLED also disables children. Keep the frame for hierarchy/editing.
      object.visible = frame.culling === undefined || Boolean(frame.culling & 1);
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
            const alpha = materialTransparency(source);
            const material = new THREE.MeshStandardMaterial({ color: source ? new THREE.Color(...source.diffuse) : 0xb0bc9e, emissive:source?new THREE.Color(...(source.emission??[0,0,0])):0, roughness: .85, side: THREE.DoubleSide, opacity: source?.opacity ?? 1, transparent: alpha.transparent, alphaTest: alpha.alphaTest, depthWrite: alpha.depthWrite, blending: alpha.blending });
            material.userData.alpha = alpha;
            material.userData.texture = source?.texture;
            material.userData.textureColored = Boolean(source?.flags & 0x08000000);
            material.userData.source=source;material.userData.materialIndex=face.material-1;material.userData.modelKey=key;
            materials.push(material); this.materials.add(material);
          }
          base.setIndex(indices); if (!lod.normals.some(n => n !== 0)) base.computeVertexNormals();
          geometry.set(lod, { base, materials });
        }
        const cached = geometry.get(lod), skin = frame.skin?.[0];
        const mesh = skin ? new THREE.SkinnedMesh(cached.base, cached.materials) : new THREE.Mesh(cached.base, cached.materials);
        // RF_HIDEMESH hides this visual only; its child frames stay enabled.
        // Legacy maps also encode sector volumes as visual meshes with the
        // SECT property. Hide their surfaces, retaining their visible children.
        mesh.visible = !(frame.renderFlags & 0x40) && !/(?:^|\s)SECT(?:\s|$)/i.test(frame.properties ?? '');
        object.add(mesh); if (skin) skins.push({ mesh, object, skin });
      }
      const ancestor = frames.get(frame.parent);
      if (frame.parent && (!ancestor || frame.parent === frame.id)) throw new Error('4DS: neplatná hierarchie.');
      (ancestor ?? parent).add(object);
    }
    for (const { mesh, object, skin } of skins) if (!bindSkin(mesh, object, frames, skin)) {
      // Keep unsupported skin data visible in its static bind pose.
      const fallback = new THREE.Mesh(mesh.geometry, mesh.material); fallback.visible = mesh.visible;
      object.remove(mesh); object.add(fallback);
      this.skinWarnings?.push(object.name);
    }
    return frames;
  }
  async loadTextures(resolveUrl, selection = null) {
    const loader = new THREE.TextureLoader(), cache = new Map(), variants = new Map(), warnings = new Set();
    const load = name => {
      const key = name.toLowerCase();
      if (!cache.has(key)) cache.set(key,(async()=>{
        const url=await resolveUrl(name);if(!url)return null;
        const texture=await loader.loadAsync(url);if(this.disposed){texture.dispose();return null;}
        this.textures.add(texture);return {texture,url};
      })());
      return cache.get(key);
    };
    const materials = [...this.materials].filter(material => !selection || material.userData.materialIndex === selection.index && material.userData.modelKey === (selection.modelKey ?? ''));
    await Promise.all(materials.map(async material => {
      const name = material.userData.texture; if (!name) return;
      const revision=material.userData.revision??0,valid=()=>!this.disposed&&(material.userData.revision??0)===revision;
      try {
        const loaded=await load(name);if(!valid())return;if(!loaded){warnings.add('Chybí textura: '+name);return;}let texture=loaded.texture;
        const alpha=material.userData.alpha??{};
        if(alpha.colorKey||alpha.inTexture){
          const key=name.toLowerCase()+'#'+Number(alpha.colorKey)+Number(alpha.inTexture);
          if(!variants.has(key))variants.set(key,(async()=>{
            const response=await fetch(loaded.url);if(!response.ok)throw new Error('BMP není dostupné.');
            const metadata=bmpTransparency(await response.arrayBuffer());
            if(alpha.colorKey&&!metadata?.key)warnings.add('Nelze přečíst barevný klíč: '+name);
            if(this.disposed)return null;
            const masked=textureWithMask(loaded.texture,metadata,alpha);this.textures.add(masked);return masked;
          })());
          texture=await variants.get(key);if(!texture||!valid())return;
        }
        if(!valid())return;
        const wrap=material.userData.source?.flags&0x30000;
        if(wrap){const key=name.toLowerCase()+'#wrap'+wrap+Number(alpha.colorKey)+Number(alpha.inTexture);if(!variants.has(key)){const copy=texture.clone();this.textures.add(copy);variants.set(key,copy);}texture=variants.get(key);}
        this.applyTexture(material, texture);
        if(alpha.alphaTexture){
          const mask=await load(alpha.alphaTexture);if(!valid())return;if(!mask){warnings.add('Chybí alpha textura: '+alpha.alphaTexture);return;}
          const key=alpha.alphaTexture.toLowerCase()+'#alpha'+wrap;
          if(!variants.has(key)){
            const texture=mask.texture.clone();texture.colorSpace=THREE.NoColorSpace;texture.wrapS=wrap&0x10000?THREE.ClampToEdgeWrapping:THREE.RepeatWrapping;texture.wrapT=wrap&0x20000?THREE.ClampToEdgeWrapping:THREE.RepeatWrapping;texture.needsUpdate=true;
            this.textures.add(texture);variants.set(key,texture);
          }
          material.alphaMap=variants.get(key);material.needsUpdate=true;
        }
      } catch { if(valid())warnings.add('Nelze načíst texturu nebo masku: '+name); }
    }));
    this.textureWarnings=[...warnings];return this.textureWarnings;
  }
  applyTexture(material, texture) {
    texture.colorSpace = THREE.SRGBColorSpace;const flags=material.userData.source?.flags??0;
    texture.wrapS=flags&0x10000?THREE.ClampToEdgeWrapping:THREE.RepeatWrapping;texture.wrapT=flags&0x20000?THREE.ClampToEdgeWrapping:THREE.RepeatWrapping;
    // LS3D diffuse RGB tints a diffuse texture only with MTL_DIFFUSE_COLORED.
    // Otherwise authoring colours (e.g. blue face/legs) must not stain the image.
    if (!material.userData.textureColored) material.color.set(0xffffff);
    this.textures.add(texture); material.map = texture; material.needsUpdate = true;
  }
  updateMaterial(index,source,modelKey=''){
    let reload=false;
    for(const material of this.materials){
      if(material.userData.materialIndex!==index||material.userData.modelKey!==modelKey)continue;
      const before=material.userData.source,changed=before?.texture!==source.texture||before?.alphaTexture!==source.alphaTexture||((before?.flags??0)^source.flags)&0xe1038000;
      const alpha=materialTransparency(source);material.userData.source={...source};material.userData.alpha=alpha;material.userData.texture=source.texture;material.userData.textureColored=Boolean(source.flags&0x08000000);
      material.color.setRGB(...source.diffuse);material.emissive.setRGB(...source.emission);material.opacity=source.opacity;
      Object.assign(material,{transparent:alpha.transparent,alphaTest:alpha.alphaTest,depthWrite:alpha.depthWrite,blending:alpha.blending});
      if(changed){material.userData.revision=(material.userData.revision??0)+1;material.map=material.alphaMap=null;reload=true;}
      else if(material.map&&!material.userData.textureColored)material.color.set(0xffffff);
      material.needsUpdate=true;
    }
    return reload;
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
    if (box.isEmpty()) box.setFromCenterAndSize(object.getWorldPosition(new THREE.Vector3()), new THREE.Vector3(1, 1, 1));
    const center = box.getCenter(new THREE.Vector3()), size = Math.max(box.getSize(new THREE.Vector3()).length(), .1);
    const direction = object === this.root ? new THREE.Vector3(.9,.6,1.1) : this.camera.position.clone().sub(this.controls.target);
    if (direction.lengthSq() < 1e-10) direction.set(.9,.6,1.1);
    direction.normalize();
    const right = new THREE.Vector3().crossVectors(this.camera.up, direction);
    if (right.lengthSq() < 1e-10) right.set(1,0,0);
    right.normalize(); const up = new THREE.Vector3().crossVectors(direction, right).normalize();
    const vertical = Math.tan(THREE.MathUtils.degToRad(this.camera.getEffectiveFOV()) / 2), horizontal = vertical * this.camera.aspect;
    let distance = .1;
    for (const x of [box.min.x,box.max.x]) for (const y of [box.min.y,box.max.y]) for (const z of [box.min.z,box.max.z]) {
      const corner = new THREE.Vector3(x,y,z).sub(center);
      distance = Math.max(distance, corner.dot(direction) + 1.15 * Math.max(Math.abs(corner.dot(right)) / horizontal, Math.abs(corner.dot(up)) / vertical));
    }
    this.restoreCamera({ position: center.clone().addScaledVector(direction, distance).toArray(), target: center.toArray(), near: Math.max(.001, Math.min(.02, distance / 1000)), far: Math.max(20000, size * 10) });
  }
  captureCamera() {
    return { position: this.camera.position.toArray(), target: this.controls.target.toArray(), near: this.camera.near, far: this.camera.far };
  }
  restoreCamera(value) {
    // Flush pending orbit/pan damping before installing an explicit view.
    const damping = this.controls.enableDamping; this.controls.enableDamping = false; this.controls.update();
    this.camera.position.fromArray(value.position); this.controls.target.fromArray(value.target);
    this.camera.near = value.near; this.camera.far = value.far; this.camera.updateProjectionMatrix();
    this.controls.update(); this.controls.enableDamping = damping;
  }
  select(id, editable = true, focus = this.focusOnSelect) {
    const object = this.frames.get(id); if (!object) return;
    this.gizmo.detach(); if (editable && object.userData.frame.editable !== false) this.gizmo.attach(object);
    this.onSelect(object.userData.frame);
    if (focus) this.fit(object);
  }
  update(id, values) {
    const object = this.frames.get(id); if (!object) return;
    if (values.position) object.position.fromArray(values.position);
    if (values.scale) object.scale.fromArray(values.scale);
    if (values.rotation) fromLs3dRotation(values.rotation, object.quaternion);
    if (values.culling !== undefined) object.visible = Boolean(values.culling & 1);
    this.syncSoundExtent();
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
    this.syncSoundExtent();
    return warnings;
  }
  showBackdrop(value) { if (this.backdrop) this.backdrop.visible = value; this.syncSoundExtent(); }
  showSoundExtent(id, settings, visible = true) {
    if(this.soundOverlay){this.soundOverlay.traverse(node=>{node.geometry?.dispose();if(node.material){node.material.dispose();this.materials.delete(node.material);}});this.soundOverlay.removeFromParent();this.soundOverlay=null;}
    this.soundExtentVisible=visible;this.soundExtentId=id;
    if(!settings?.mode||!this.frames.has(id))return;
    this.soundOverlay=createSoundExtent(settings);this.soundOverlay.matrixAutoUpdate=false;
    this.soundOverlay.traverse(node=>{if(node.material)this.materials.add(node.material);});
    // Outside root: sound ranges cannot capture picking or expand framing.
    this.scene.add(this.soundOverlay);this.syncSoundExtent();
  }
  syncSoundExtent() {
    const object=this.frames.get(this.soundExtentId);if(!object||!this.soundOverlay)return;
    object.updateWorldMatrix(true,false);this.soundOverlay.matrix.copy(object.matrixWorld);this.soundOverlay.matrixWorldNeedsUpdate=true;
    let visible=Boolean(this.soundExtentVisible);for(let node=object;node;node=node.parent)visible&&=node.visible;
    this.soundOverlay.visible=visible;
  }
  showCollisionBoxes(boxes, visible, surfaces = []) {
    if(!this.collisionOverlay){this.collisionOverlay=new THREE.Group();this.collisionOverlay.scale.z=-1;this.scene.add(this.collisionOverlay);
      for(const box of boxes){const helper=new THREE.Box3Helper(new THREE.Box3(new THREE.Vector3(...box.min),new THREE.Vector3(...box.max)),0xf59e0b);helper.name=box.name;this.materials.add(helper.material);this.collisionOverlay.add(helper);}
      for(const surface of surfaces){const points=[];for(let i=0;i<surface.positions.length;i+=9){const triangle=surface.positions.slice(i,i+9);points.push(...triangle.slice(0,3),...triangle.slice(3,6),...triangle.slice(3,6),...triangle.slice(6,9),...triangle.slice(6,9),...triangle.slice(0,3));}
        const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(points,3));const material=new THREE.LineBasicMaterial({color:0x10b981}),helper=new THREE.LineSegments(geometry,material);helper.name=surface.name;this.materials.add(material);this.collisionOverlay.add(helper);
      }}
    // Outside root: helpers cannot capture object picking or alter framing.
    this.collisionOverlay.visible=visible;
  }
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
