import { dialogueSpeakers } from './mission-dialogue.js';
import { missionFlowTargets } from './mission-flow.js';
import { humanDrivingTargets } from './human-driving.js';

const key = name => name.normalize('NFC').toLowerCase();
const validName = name => typeof name === 'string' && name.trim() && name.length <= 255 && !/["\x00-\x1f]/.test(name);
export function humanFollowingDestinations(scene, owner) {
  const actors = new Set((scene.actors ?? []).filter(actor => actor.kind !== 5).map(actor => key(actor.name)));
  return humanDrivingTargets(scene, owner, '').filter(frame => !actors.has(key(frame.name)));
}

// Original Paulie/Sam programs pair enemy_followplayer with enemy_action_follow.
// return yields when close to the player, allowing the arrival check; nolink stays on foot.
// Keep the NPC's program alive after stopping: end disables its actor/colliders.
export function humanFollowingScript(owner, { startSignal = null, destinationName = null, destinationRadius = null, onComplete = null, delaySeconds = 0 } = {}) {
  if (!validName(owner) || key(owner) === 'tommy') throw new Error('Doprovod: vyberte NPC odlišnou od hráče Tommy.');
  for (const name of [startSignal, destinationName, onComplete]) if (name !== null && (!validName(name) || key(name) === key(owner))) throw new Error('Doprovod: neplatný název cíle nebo skriptového bodu.');
  if (!Number.isFinite(delaySeconds) || delaySeconds < 0 || delaySeconds > 86400) throw new Error('Doprovod: prodleva musí být 0–86400 sekund.');
  if (destinationName === null) {
    if (destinationRadius !== null || onComplete !== null) throw new Error('Doprovod: poloměr a dokončení potřebují cílový objekt.');
  } else if (key(destinationName) === 'tommy' || typeof destinationRadius !== 'number' || !Number.isFinite(destinationRadius) || destinationRadius <= 0 || !Number.isFinite(Math.fround(destinationRadius)) || Math.fround(destinationRadius) <= 0) throw new Error('Doprovod: vyberte cíl odlišný od hráče a kladný konečný poloměr.');
  const names = [...new Map([startSignal, onComplete].filter(name => name !== null).map(name => [key(name), name])).values()];
  const slot = name => 1 + names.findIndex(other => key(other) === key(name));
  return ['// Mafia Workbench human following v1', `dim_act ${names.length + 1}`, ...(destinationName === null ? [] : ['dim_frm 2', 'dim_flt 7']), 'wait 2000', 'enemy_followplayer no',
    'findactor 0, "Tommy"', ...names.map((name, index) => `findactor ${index + 1}, "${name}"`),
    ...(startSignal === null ? [] : ['label 1', `detector_issignal ${slot(startSignal)}, 2, -1`, 'wait 100', 'goto 1', 'label 2']),
    `wait ${Math.round(delaySeconds * 1000)}`, 'enemy_followplayer yes',
    ...(destinationName === null ? ['label 10', 'enemy_action_follow 0, 2, nolink, return', 'wait 100', 'goto 10'] : [`findframe 0, "${owner}"`, `findframe 1, "${destinationName}"`, 'label 10', 'enemy_action_follow 0, 2, nolink, return', 'frm_getworldpos 0, 0', 'frm_getworldpos 1, 3', 'vect_sub_vect 0, 3', 'vect_magnitude 0, 6', `if flt[6] < ${destinationRadius}, 20, -1`, 'wait 100', 'goto 10', 'label 20', 'enemy_followplayer no', ...(onComplete === null ? [] : [`detector_setsignal ${slot(onComplete)}, 1`])]),
    'label 99', 'wait 1000', 'goto 99', ''].join('\r\n');
}

export function inspectHumanFollowing(owner, code) {
  const source = code.replaceAll('\r\n', '\n');
  if (!source.startsWith('// Mafia Workbench human following v1\n')) return null;
  const actors = new Map([...source.matchAll(/^findactor (\d+), "([^"\x00-\x1f]+)"$/gm)].map(match => [Number(match[1]), match[2]]));
  const gate = /^detector_issignal (\d+), 2, -1$/m.exec(source), complete = /^detector_setsignal (\d+), 1$/m.exec(source);
  const destination = /^findframe 1, "([^"\x00-\x1f]+)"$/m.exec(source), radius = /^if flt\[6\] < ([\d.e+-]+), 20, -1$/m.exec(source), delay = /^wait (\d+)\nenemy_followplayer yes$/m.exec(source);
  const options = { mode: 'follow', startSignal: gate ? actors.get(Number(gate[1])) : null, destinationName: destination?.[1] ?? null, destinationRadius: radius ? Number(radius[1]) : null, onComplete: complete ? actors.get(Number(complete[1])) : null, delaySeconds: Number(delay?.[1]) / 1000 };
  try { if (humanFollowingScript(owner, options).replaceAll('\r\n', '\n') === source) return options; } catch { /* Altered source stays custom. */ }
  return null;
}

export function resolveHumanFollowing(scene, owner, options) {
  humanFollowingScript(owner, options);
  if (!dialogueSpeakers(scene).some(actor => actor.kind === 2 && key(actor.name) === 'tommy')) throw new Error('Doprovod: mise potřebuje jednoznačného hráče Tommy typu Player.');
  const points = new Map(missionFlowTargets(scene).map(actor => [key(actor.name), actor.name]));
  const result = { ...options };
  for (const field of ['startSignal', 'onComplete']) if (result[field] != null) {
    const actual = points.get(key(result[field]));
    if (!actual) throw new Error('Doprovod: vyberte jednoznačný skriptový bod této mise.');
    result[field] = actual;
  }
  if (result.destinationName != null) {
    const actual = humanFollowingDestinations(scene, owner).find(frame => key(frame.name) === key(result.destinationName));
    if (!actual) throw new Error('Doprovod: cíl musí být jednoznačný nepohyblivý objekt této mise.');
    result.destinationName = actual.name;
  }
  return result;
}
