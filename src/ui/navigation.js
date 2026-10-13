import * as THREE from 'three';
import { Viewport } from './viewport.js';

export class NavigationViewport extends Viewport {
  loadNavigation(file) {
    this.navigationEditable = file.editable !== false;
    this.positions = file.points.map(point => [...point.position]); this.edges = []; this.incident = file.points.map(() => []); this.selectedPoint = null;
    const material = new THREE.MeshBasicMaterial(), geometry = new THREE.SphereGeometry(.35, 8, 6);
    this.markers = new THREE.InstancedMesh(geometry, material, file.points.length); this.markers.userData.navigation = true;
    this.root.add(this.markers); this.materials.add(material);
    const matrix = new THREE.Matrix4();
    for (const point of file.points) {
      this.markers.setMatrixAt(point.index, matrix.makeTranslation(...point.position)); this.setType(point.index, point.type);
      for (const link of point.links) { const index = this.edges.length; this.edges.push([point.index, link.target]); this.incident[point.index].push(index); if (point.index !== link.target) this.incident[link.target].push(index); }
    }
    const vertices = new Float32Array(this.edges.length * 6);
    this.edges.forEach(([source,target],i) => { vertices.set(this.positions[source],i*6); vertices.set(this.positions[target],i*6+3); });
    const lines = new THREE.BufferGeometry(); lines.setAttribute('position',new THREE.BufferAttribute(vertices,3));
    const lineMaterial = new THREE.LineBasicMaterial({color:0x72908d,transparent:true,opacity:.35}); this.materials.add(lineMaterial);
    this.lines = new THREE.LineSegments(lines,lineMaterial); this.lines.raycast = () => {}; this.root.add(this.lines);
    const selectedMaterial = new THREE.MeshBasicMaterial({color:0xffffff,wireframe:true}); this.materials.add(selectedMaterial);
    this.proxy = new THREE.Group(); this.proxy.visible = false;
    const halo = new THREE.Mesh(new THREE.SphereGeometry(.6,8,6),selectedMaterial); halo.raycast = () => {}; this.proxy.add(halo); this.root.add(this.proxy);
    const highlightMaterial = new THREE.LineBasicMaterial({color:0x63e6ad}); this.materials.add(highlightMaterial);
    this.highlight = new THREE.LineSegments(new THREE.BufferGeometry(),highlightMaterial); this.highlight.raycast = () => {}; this.root.add(this.highlight);
    this.markers.instanceMatrix.needsUpdate = true; this.fit();
  }
  setType(index, type) {
    const color = type & 8 ? 0xb78cff : type & 4 ? 0xff8c6c : type & 2 ? 0xffd56a : type & 1 ? 0x5fcaff : 0x8cbd9b;
    this.markers.setColorAt(index,new THREE.Color(color)); this.markers.instanceColor.needsUpdate = true;
  }
  select(id, _editable, focus=this.focusOnSelect) {
    const index = Number(id); if (!Number.isInteger(index) || !this.positions[index]) return;
    this.selectedPoint = index; this.proxy.visible = true; this.proxy.position.fromArray(this.positions[index]);
    this.proxy.userData.frame = {id:String(index),navigationIndex:index,editable:this.navigationEditable};
    if(this.navigationEditable)this.gizmo.attach(this.proxy);else this.gizmo.detach();
    this.drawHighlight(); this.onSelect(this.proxy.userData.frame);
    if(focus)this.fit(this.proxy);
  }
  drawHighlight() {
    const vertices = [];
    for (const edge of this.incident[this.selectedPoint] ?? []) { const [source,target] = this.edges[edge]; vertices.push(...this.positions[source],...this.positions[target]); }
    this.highlight.geometry.dispose(); this.highlight.geometry = new THREE.BufferGeometry(); this.highlight.geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
  }
  updatePoint(index, position) {
    if (!this.positions[index] || position.length !== 3 || position.some(n => !Number.isFinite(n))) return;
    this.positions[index] = [...position]; this.markers.setMatrixAt(index,new THREE.Matrix4().makeTranslation(...position));
    this.markers.instanceMatrix.needsUpdate = true; this.markers.boundingSphere = this.markers.boundingBox = null;
    const attribute = this.lines.geometry.getAttribute('position');
    for (const edge of this.incident[index]) { const [source,target] = this.edges[edge]; attribute.array.set(this.positions[source],edge*6); attribute.array.set(this.positions[target],edge*6+3); }
    attribute.needsUpdate = true;
    if (this.selectedPoint === index) this.proxy.position.fromArray(position);
    this.drawHighlight();
  }
  updateTarget(index, target) {
    const edge = this.edges[index]; if (!edge || !this.positions[target]) return;
    const [source,oldTarget] = edge;
    this.incident[oldTarget] = this.incident[oldTarget].filter(i=>i!==index);
    this.incident[source] = this.incident[source].filter(i=>i!==index); this.incident[source].push(index);
    if (target !== source) this.incident[target].push(index);
    edge[1] = target; const attribute = this.lines.geometry.getAttribute('position'); attribute.array.set(this.positions[target],index*6+3); attribute.needsUpdate = true; this.drawHighlight();
  }
}
