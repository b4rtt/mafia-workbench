import { missionActivation, inspectMissionActivation } from './mission-activation.js';
import { missionFlow, missionFlowTargets } from './mission-flow.js';
import { validMissionDestination } from './mission-destinations.js';

const key = name => name.normalize('NFC').toLowerCase();
const validId = id => Number.isSafeInteger(id) && id >= 0 && id <= 0x7fffffff;

// A terminal detector has no outgoing signal: it either ends this mission or
// loads another one. The gate and area must both pass before the terminal call.
export function missionFinishScript({ outcome = 'success', completeId = null, nextMission = null, trigger = 'load', triggerRadius = null, interactionId = null, waitForSignal = true } = {}) {
  if (!['success', 'failure', 'mission'].includes(outcome)) throw new Error('Zakončení: vyberte úspěch, neúspěch nebo další misi.');
  const activation = missionActivation(trigger, triggerRadius, 'Zakončení');
  if (trigger === 'use' ? !validId(interactionId) : interactionId !== null) throw new Error('Zakončení: ID akce patří pouze spuštění tlačítkem akce.');
  if (outcome === 'mission') {
    if (!validMissionDestination(nextMission) || completeId !== null) throw new Error('Zakončení: přechod potřebuje další misi bez ID výsledku.');
  } else if (!validId(completeId) || nextMission !== null) throw new Error('Zakončení: výsledek potřebuje ID textu bez další mise.');
  const link = missionFlow({ waitForSignal });
  const terminal = outcome === 'mission' ? `change_mission "${nextMission}", "", -1` : `endofmission ${outcome === 'success' ? 1 : 0}, ${completeId}`;
  return `// Mafia Workbench mission finish\n${trigger === 'area' ? 'dim_flt 1\n' : ''}wait 2000\n${link.gate}${activation}${trigger === 'use' ? `detector_waitforuse ${interactionId}\n` : ''}${terminal}\nend`;
}

export function inspectMissionFinish(code) {
  if (typeof code !== 'string' || code.length > 1000000) return null;
  const source = code.replaceAll('\r\n', '\n'), ending = /^endofmission ([01]), (\d+)$/m.exec(source), next = /^change_mission "([^"]+)", "", -1$/m.exec(source), use = /^detector_waitforuse (\d+)$/m.exec(source);
  const finish = { ...inspectMissionActivation(source), outcome: next ? 'mission' : ending?.[1] === '1' ? 'success' : 'failure', completeId: ending ? Number(ending[2]) : null, nextMission: next?.[1] ?? null, interactionId: use ? Number(use[1]) : null, waitForSignal: source.includes('label 1\ndetector_issignal -1, 2, -1\n') };
  try { if (missionFinishScript(finish) === source) return finish; } catch { /* Edited source stays in the source editor. */ }
  return null;
}

export function editableMissionFinish(scene, owner) {
  if (typeof owner !== 'string' || !owner.trim()) return null;
  const actors = (scene.actors ?? []).filter(actor => key(actor.name) === key(owner)), entries = (scene.entries ?? []).filter(entry => entry.actorScript && entry.actorKind === 5 && key(entry.value.name) === key(owner));
  if (actors.length !== 1 || actors[0].kind !== 5 || entries.length !== 1 || !missionFlowTargets(scene).some(actor => key(actor.name) === key(owner))) return null;
  const masks = scene.entries.filter(entry => entry.detectorParameter && entry.id.startsWith(actors[0].id + '/'));
  if (masks.length !== 1 || masks[0].value !== 1) return null;
  const finish = inspectMissionFinish(entries[0].value.code);
  return finish ? { entry: entries[0], finish } : null;
}
