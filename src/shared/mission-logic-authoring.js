import { missionLogic } from './mission-logic.js';

const key = value => value.normalize('NFC').toLowerCase();
const prefixes = { task: 'WB_TASK', branch: 'WB_BRANCH', coordination: 'WB_CONTROL', finish: 'WB_FINISH', dialogue: 'WB_DIALOGUE', combat: 'WB_COMBAT', choice: 'WB_CHOICE', custom: 'WB_SCRIPT' };

export function newMissionLogicName(scene, kind) {
  if (!Object.hasOwn(prefixes, kind)) throw new Error('Vyberte druh nového bodu mise.');
  const prefix = prefixes[kind];
  const used = new Set([...scene.objects, ...(scene.geometry?.meshes ?? []), ...scene.actors, ...scene.entries.filter(entry => entry.kind === 'script').map(entry => entry.value)].map(object => key(object.name)));
  for (let index = 1; ; index++) {
    const name = index === 1 ? prefix : `${prefix}_${index}`;
    const names = kind === 'choice' ? [name, `${name}_CLAIM`, ...Array.from({ length: 4 }, (_, i) => `${name}_ANSWER${i + 1}`)] : [name];
    if (names.every(value => !used.has(key(value)))) return name;
  }
}

// Preserve panel/scroll preferences, but reveal a newly created node even when
// a previous search hid its row. This does not change any mission data.
export function createdMissionLogicSelection(scene, name, previous) {
  const matches = missionLogic(scene).nodes.filter(node => key(node.name) === key(name) && (node.actor || node.kind === 'choice'));
  if (matches.length !== 1) return { ...previous, focusSelection: false };
  const node = matches[0], search = previous.search ?? '';
  return { ...previous, selectedId: node.id, search: key(name).includes(key(search)) ? search : '', all: previous.all || node.kind === 'custom', focusSelection: true };
}
