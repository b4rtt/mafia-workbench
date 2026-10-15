import * as THREE from 'three';
import { editableMissionTask } from '../shared/mission-task.js';
import { editableMissionDialogue } from '../shared/mission-dialogue.js';
import { editableMissionCombat } from '../shared/mission-combat.js';
import { editableMissionFinish } from '../shared/mission-finish.js';

const key = name => name.normalize('NFC').toLowerCase();

// Never infer an area from a matching command in an otherwise custom program.
// Transform drafts are applied by Viewport; program/mask drafts must still pass
// the whole recipe's recognition before their areas can be shown.
export function missionAreaSettings(file, owner, drafts = new Map()) {
  if (!owner || file.cacheSource) return null;
  const scene = { ...file, entries: file.entries.map(entry => drafts.has(entry.id) ? { ...entry, value: entry.actorScript ? { name: entry.value.name, code: drafts.get(entry.id)?.code } : drafts.get(entry.id) } : entry) };
  const task = editableMissionTask(scene, owner)?.task;
  const recipe = task ?? editableMissionDialogue(scene, owner)?.dialogue ?? editableMissionCombat(scene, owner)?.combat ?? editableMissionFinish(scene, owner)?.finish;
  if (!recipe) return null;
  const areas = [], warnings = [];
  function add(name, radius, role) {
    const objects = (file.objects ?? []).filter(object => key(object.name) === key(name));
    const meshes = (file.geometry?.meshes ?? []).filter(mesh => key(mesh.name) === key(name));
    if (objects.length > 1 || meshes.length > 1 || !objects.length && !meshes.length) {
      warnings.push(`Oblast ${name}: objekt chybí nebo je nejednoznačný.`); return;
    }
    if (objects.some(object => drafts.has(object.fields?.name) && drafts.get(object.fields.name) !== object.name)) {
      warnings.push(`Oblast ${name}: nejdřív uložte přejmenování objektu.`); return;
    }
    areas.push({ name, radius, role });
  }
  if (recipe.trigger === 'area') add(owner, recipe.triggerRadius, 'activation');
  if (task?.targetName) add(task.targetName, task.targetRadius, 'target');
  if (!areas.length && !warnings.length) return null;
  const labels = areas.map(area => `${area.role === 'activation' ? 'Modrá: spuštění' : 'Zelená: cíl'} ${area.name}, r = ${area.radius}`).join(' · ');
  return { areas, summary: labels, reason: [labels, ...warnings, 'Koule zahrnují výšku. Jde o prostorové podmínky vybraného receptu, nikoli stav jeho spuštění ve hře.'].filter(Boolean).join(' ') };
}

export function createMissionArea({ name, radius, role }) {
  const points = [], steps = 64;
  for (let plane = 0; plane < 3; plane++) for (let i = 0; i < steps; i++) {
    for (const n of [i, i + 1]) {
      const a = radius * Math.cos(n * 2 * Math.PI / steps), b = radius * Math.sin(n * 2 * Math.PI / steps);
      points.push(...(plane === 0 ? [a, b, 0] : plane === 1 ? [a, 0, b] : [0, a, b]));
    }
  }
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  const material = new THREE.LineBasicMaterial({ color: role === 'activation' ? 0x60a5fa : 0x34d399, transparent: true, opacity: .8, depthWrite: false, depthTest: false });
  const line = new THREE.LineSegments(geometry, material); line.name = name; line.userData.missionArea = role; line.renderOrder = 3;
  return line;
}
