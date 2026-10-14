import { dialogueSpeakers } from './mission-dialogue.js';
import { missionFlow, resolveMissionFlow } from './mission-flow.js';

const key = name => name.normalize('NFC').toLowerCase();
const validName = name => typeof name === 'string' && name.trim() && name.length <= 255 && !/["\x00-\x1f]/.test(name);
const validId = id => Number.isSafeInteger(id) && id >= 0 && id <= 0x7fffffff;

export function combatTargets(scene) {
  return dialogueSpeakers(scene).filter(actor => actor.kind === 27 && key(actor.name) !== 'tommy');
}

// The task observes existing actors; it never replaces their AI programs or
// removes them. Energy is an unquoted engine property and is zero for dead actors.
export function missionCombatScript({ targets, trigger = 'use', interactionId, objectiveId, completeId, checkpointId = null, failure = null, flow = null, exitToMenu = false } = {}) {
  if (!Array.isArray(targets) || targets.length < 1 || targets.length > 16 || targets.some(name => !validName(name) || key(name) === 'tommy') || new Set(targets.map(key)).size !== targets.length) throw new Error('Bojový úkol: vyberte 1–16 různých NPC postav.');
  if (!['use', 'load'].includes(trigger)) throw new Error('Bojový úkol: neplatný způsob spuštění.');
  if (![objectiveId, completeId, ...(trigger === 'use' ? [interactionId] : [])].every(validId)) throw new Error('Bojový úkol: ID textů musí být celá čísla 0–2147483647.');
  if (typeof exitToMenu !== 'boolean') throw new Error('Bojový úkol: neplatná volba návratu do menu.');
  if (checkpointId !== null && (!Number.isSafeInteger(checkpointId) || checkpointId < 5000 || checkpointId > 5599)) throw new Error('Bojový úkol: checkpoint musí mít ID textu 5000–5599.');
  let timeout = null, guard = null;
  if (failure !== null) {
    if (typeof failure !== 'object' || Array.isArray(failure)) throw new Error('Bojový úkol: neplatné podmínky neúspěchu.');
    timeout = failure.timeoutSeconds ?? null; guard = failure.humanName ?? null;
    if (timeout !== null && (typeof timeout !== 'number' || !Number.isFinite(timeout) || timeout < .1 || timeout > 86400)) throw new Error('Bojový úkol: časový limit musí být 0,1–86400 sekund.');
    if (guard !== null && (!validName(guard) || key(guard) === 'tommy' || targets.some(name => key(name) === key(guard)))) throw new Error('Bojový úkol: hlídaná NPC musí být odlišná od cílů a hráče.');
    if (timeout === null && guard === null) throw new Error('Bojový úkol: vyberte alespoň jednu podmínku neúspěchu.');
    if (!validId(failure.textId)) throw new Error('Bojový úkol: neplatné ID textu neúspěchu.');
    if (failure.endMission !== undefined && typeof failure.endMission !== 'boolean') throw new Error('Bojový úkol: neplatná volba konce mise při neúspěchu.');
  }
  const offset = targets.length + (guard === null ? 0 : 1);
  const link = missionFlow(flow, { actorOffset: offset, allowFailure: failure !== null, exitOnComplete: exitToMenu, endOnFailure: Boolean(failure?.endMission) });
  const bindings = targets.map((name, i) => `findactor ${i}, "${name}"\n`).join('') + (guard === null ? '' : `findactor ${targets.length}, "${guard}"\n`);
  const failed = failure === null ? '' : `\nlabel 30\nmission_objectivesremove ${objectiveId}\nsubtitle_add ${failure.textId}\nconsole_addtext ${failure.textId}\nwait 4000\n${link.failure}${failure.endMission ? `endofmission 0, ${failure.textId}\n` : ''}end`;
  const checks = (guard === null ? '' : `human_getproperty ${targets.length}, 0, Energy\nif flt[0] > 0, -1, 30\n`) + (timeout === null ? '' : `getgametime 2\nlet flt[2] = flt[2] - flt[1]\nif flt[2] > ${timeout * 1000}, 30, -1\n`);
  const poll = targets.map((_, i) => `human_getproperty ${i}, 0, Energy\nif flt[0] > 0, 40, -1\n`).join('');
  return `dim_act ${offset + link.actors}\ndim_flt ${timeout === null ? 1 : 3}\nwait 2000\n${link.gate}${link.start}mission_objectives ${objectiveId}\nsubtitle_add ${objectiveId}\n${trigger === 'use' ? `detector_waitforuse ${interactionId}\n` : ''}${bindings}${timeout === null ? '' : 'getgametime 1\n'}${checkpointId === null ? '' : `autosavegamefull ${checkpointId}, 1\n`}label 10\n${checks}${poll}goto 20\nlabel 40\nwait 100\ngoto 10\nlabel 20\nmission_objectivesremove ${objectiveId}\nsubtitle_add ${completeId}\nconsole_addtext ${completeId}\nwait 4000\n${link.complete}${exitToMenu ? `endofmission 1, ${completeId}\n` : ''}end${failed}`;
}

export function resolveMissionCombat(scene, combat, owner) {
  missionCombatScript(combat);
  const candidates = new Map(combatTargets(scene).map(actor => [key(actor.name), actor.name]));
  const resolve = name => {
    const actual = candidates.get(key(name));
    if (!actual) throw new Error('Bojový úkol: vyberte jednoznačné existující NPC postavy této mise.');
    return actual;
  };
  const result = { ...combat, targets: combat.targets.map(resolve), failure: combat.failure == null ? null : { ...combat.failure, ...(combat.failure.humanName == null ? {} : { humanName: resolve(combat.failure.humanName) }) }, flow: resolveMissionFlow(scene, combat.flow, owner) };
  missionCombatScript(result);
  return result;
}
