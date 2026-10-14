import * as THREE from 'three';

// Editor wire outlines, not visibility/lighting simulation. Coordinates are
// stored in the sector frame, with the usual LS3D transform applied by Viewport.
export function createSectorPreview(sector) {
  const group = new THREE.Group(); group.userData.sectorPreview = true; group.name = 'Sektor a portály';
  const warnings = [];
  const valid = positions => Array.isArray(positions) && positions.length % 3 === 0 && positions.every(v => Number.isFinite(v) && Number.isFinite(Math.fround(v)));
  function lines(points, color, portal = null) {
    if (!points.length) return;
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    const line = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color })); line.userData.sectorPortal = portal; group.add(line);
  }
  if (valid(sector.positions) && Array.isArray(sector.indices) && sector.indices.length % 3 === 0 && sector.indices.every(i => Number.isInteger(i) && i >= 0 && i < sector.positions.length / 3)) {
    const points = [], seen = new Set();
    for (let i = 0; i < sector.indices.length; i += 3) for (const [a, b] of [[i, i + 1], [i + 1, i + 2], [i + 2, i]]) {
      const first = sector.indices[a], second = sector.indices[b], key = first < second ? `${first}/${second}` : `${second}/${first}`;
      if (seen.has(key)) continue; seen.add(key); points.push(...sector.positions.slice(first * 3, first * 3 + 3), ...sector.positions.slice(second * 3, second * 3 + 3));
    }
    lines(points, sector.flags[0] & 1 ? 0x36c5d0 : 0x81909a);
  } else warnings.push('Sektor má neplatné vrcholy nebo indexy; jeho obrys se nevykreslí.');
  for (const [i, portal] of sector.portals.entries()) {
    if (!valid(portal.positions) || portal.positions.length < 9) { warnings.push(`Portál ${i + 1} nemá platný polygon; jeho obrys se nevykreslí.`); continue; }
    const points = [], vertices = portal.positions.length / 3;
    for (let j = 0; j < vertices; j++) points.push(...portal.positions.slice(j * 3, j * 3 + 3), ...portal.positions.slice((j + 1) % vertices * 3, (j + 1) % vertices * 3 + 3));
    lines(points, portal.flags & 4 ? 0xc58bff : 0x81909a, i);
  }
  group.userData.warnings = warnings; return group;
}
