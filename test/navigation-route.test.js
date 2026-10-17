import test from 'node:test';
import assert from 'node:assert/strict';
import { findNavigationRoute } from '../src/shared/navigation-route.js';
import { parseNavigation, changeNavigationConnection } from '../src/core/navigation.js';
import { MissionViews } from '../src/ui/mission-views.js';
import * as THREE from 'three';
import { NavigationViewport } from '../src/ui/navigation.js';

function graph(points) {
  return { positions: points.map(p => p.position), edges: points.flatMap(p => p.links.map(link => [p.index, link.target])), types: points.flatMap(p => p.links.map(link => link.type)) };
}
test('route diagnosis respects native directed connections, repeated IDs and category flags without writes', () => {
  let bytes = Buffer.alloc(8 + 4 * 30); bytes.writeUInt32LE(0x01abcedf); bytes.writeUInt32LE(4, 4);
  for (let i = 0; i < 4; i++) { bytes.writeFloatLE(i * 3, 8 + i * 30); bytes.writeFloatLE(i * 4, 12 + i * 30); bytes.writeUInt16LE(1, 20 + i * 30); bytes.writeUInt16LE(42, 22 + i * 30); }
  bytes = changeNavigationConnection(bytes, { action: 'connect', from: 0, to: 1, direction: 'forward' });
  bytes = changeNavigationConnection(bytes, { action: 'connect', from: 1, to: 2 });
  const before = Buffer.from(bytes), parsed = parseNavigation(bytes), input = graph(parsed.points);
  assert.deepEqual(findNavigationRoute(input, 0, 2), { indices: [0, 1, 2], distance: 10 });
  assert.deepEqual(findNavigationRoute(input, 2, 0), { indices: [], distance: null });
  assert.deepEqual(findNavigationRoute(input, 0, 3), { indices: [], distance: null });
  assert.deepEqual(findNavigationRoute(input, 2, 2), { indices: [2], distance: 0 });
  assert.equal(findNavigationRoute(input, 0, 2, 2).distance, null);
  input.types[0] |= 0x40; assert.equal(findNavigationRoute(input, 0, 2).distance, 10);
  input.types[0] |= 0x80; assert.equal(findNavigationRoute(input, 0, 2, 0x17).distance, null);
  assert.deepEqual(bytes, before);
});
test('shortest paths use XYZ length and react to draft positions, targets and category filters', () => {
  const input = { positions: [[0, 0, 0], [1, 10, 0], [1, 0, 1], [2, 0, 0]], edges: [[0, 1], [1, 3], [0, 2], [2, 3]], types: [1, 1, 2, 2] };
  assert.deepEqual(findNavigationRoute(input, 0, 3, 3).indices, [0, 2, 3]);
  assert.deepEqual(findNavigationRoute(input, 0, 3, 1).indices, [0, 1, 3]);
  input.positions[1] = [1, 0, 0]; assert.equal(findNavigationRoute(input, 0, 3, 3).distance, 2);
  input.edges[1][1] = 0; assert.equal(findNavigationRoute(input, 0, 3, 1).distance, null);
  input.types[2] = input.types[3] = 4; assert.equal(findNavigationRoute(input, 0, 3, 2).distance, null); assert.equal(findNavigationRoute(input, 0, 3, 4).indices.length, 3);
  input.types[2] = input.types[3] = 16; assert.equal(findNavigationRoute(input, 0, 3, 16).indices.length, 3);
});
test('zero length cycles, equal alternatives and stale heap entries do not corrupt shortest paths', () => {
  const input = { positions: [[0, 0, 0], [0, 0, 0], [1, 1, 0], [2, 0, 0]], edges: [[0, 1], [1, 0], [1, 1], [0, 2], [2, 3], [1, 3]], types: [1, 1, 1, 1, 1, 1] };
  assert.deepEqual(findNavigationRoute(input, 0, 3), { indices: [0, 1, 3], distance: 2 });
  input.edges.reverse(); input.types.reverse(); assert.deepEqual(findNavigationRoute(input, 0, 3), { indices: [0, 1, 3], distance: 2 });
});
test('heap search agrees with an independent relaxation oracle on deterministic directed multigraphs', () => {
  let seed = 3247; const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  for (let trial = 0; trial < 25; trial++) {
    const positions = Array.from({ length: 30 }, () => Array.from({ length: 3 }, () => random() * 100)), edges = [], types = [];
    for (let i = 0; i < 180; i++) { edges.push([Math.floor(random() * 30), Math.floor(random() * 30)]); types.push((random() < .3 ? 0x80 : 0) | (random() < .7 ? 1 : 2)); }
    const input = { positions, edges, types };
    for (const mask of [1, 2, 3]) {
      const distance = Array(30).fill(Infinity); distance[0] = 0;
      for (let pass = 0; pass < 29; pass++) edges.forEach(([a, b], i) => { if (!(types[i] & 0x80) && (types[i] & mask)) distance[b] = Math.min(distance[b], distance[a] + Math.hypot(...positions[a].map((n, j) => n - positions[b][j]))); });
      const result = findNavigationRoute(input, 0, 29, mask);
      if (distance[29] === Infinity) assert.equal(result.distance, null); else assert(Math.abs(result.distance - distance[29]) < 1e-9);
    }
  }
});
test('large native point range remains usable and invalid input is refused', () => {
  const input = { positions: Array.from({ length: 65536 }, (_, i) => [i, 0, 0]), edges: Array.from({ length: 65535 }, (_, i) => [i, i + 1]), types: Array(65535).fill(1) };
  const result = findNavigationRoute(input, 0, 65535); assert.equal(result.indices.length, 65536); assert.equal(result.distance, 65535);
  for (const index of [-1, 65536, .5, NaN]) assert.throws(() => findNavigationRoute(input, index, 0), /začátek/);
  for (const mask of [0, 8, 128, -1, 1.5]) assert.throws(() => findNavigationRoute(input, 0, 1, mask), /typ/);
  assert.throws(() => findNavigationRoute({ positions: [[0, Infinity, 0]], edges: [], types: [] }, 0, 0), /XYZ/);
  assert.throws(() => findNavigationRoute({ positions: [[0, 0, 0]], edges: [[0, 1]], types: [1] }, 0, 0), /Neplatný/);
  assert.throws(() => findNavigationRoute({ positions: [[0, 0, 0]], edges: [[0, 0]], types: [] }, 0, 0), /Neúplné/);
});
test('route endpoints are retained with their source hash, scoped to mission and project', () => {
  const views = new MissionViews(), route = { sha256: 'source', from: '0', to: '12', mask: '1', open: true };
  views.remember({ projectRoot: '/a', navigationPath: 'missions/T/check.bin', navigationRoute: route, captureCamera: () => ({ position: [1, 2, 3] }) });
  assert.deepEqual(views.get('/a', { path: 'missions/t/CHECK.BIN', type: 'navigation' }).route, route);
  assert.equal(views.get('/b', { path: 'missions/T/check.bin', type: 'navigation' }), null);
});
test('route overlay follows Mafia handedness without intercepting picking, changing camera or leaking replaced geometry', () => {
  const view = Object.create(NavigationViewport.prototype);
  Object.assign(view, { root: new THREE.Group(), materials: new Set(), frames: new Map(), camera: new THREE.PerspectiveCamera(), controls: { target: new THREE.Vector3(), update() {} }, gizmo: { attach() {} }, onSelect() {} });
  view.root.scale.z = -1;
  const file = { points: [{ index: 0, position: [10, 1, 20], type: 1, links: [{ target: 1, type: 1 }] }, { index: 1, position: [20, 2, 30], type: 1, links: [] }] }, before = structuredClone(file);
  view.loadNavigation(file); view.select('0'); const camera = view.captureCamera();
  view.showRoute([0, 1]); assert.equal(view.routeLine.material.side, THREE.DoubleSide);
  view.root.updateMatrixWorld(true); assert.deepEqual(view.routeEnds[1].getWorldPosition(new THREE.Vector3()).toArray(), [20, 2, -30]);
  const hits = new THREE.Raycaster(new THREE.Vector3(10, 1, -10), new THREE.Vector3(0, 0, -1)).intersectObject(view.routeOverlay, true); assert.equal(hits.length, 0);
  let replaced = false; view.routeLine.geometry.addEventListener('dispose', () => { replaced = true; });
  let updates = 0; view.onNavigationChange = () => updates++;
  view.updatePoint(1, [20, 3, 30]); view.updateTarget(0, 0); view.updateLinkType(0, 129); assert.equal(updates, 3);
  view.showRoute([0]); assert(replaced); assert(!view.routeLine.visible); assert(view.routeOverlay.visible);
  view.showRoute([]); assert(!view.routeOverlay.visible); assert.equal(view.selectedPoint, 0); assert.deepEqual(view.captureCamera(), camera); assert.deepEqual(file, before);
  view.root.traverse(object => object.geometry?.dispose()); for (const material of view.materials) material.dispose();
});
