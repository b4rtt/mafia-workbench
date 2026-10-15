import { HUMAN_IDLE_SCRIPT } from './human-program.js';
import { dialogueSpeakers } from './mission-dialogue.js';
import { humanDrivingScript, inspectHumanDriving } from './human-driving.js';
import { humanFollowingScript, inspectHumanFollowing } from './human-following.js';
import { missionFlowTargets } from './mission-flow.js';

const key = name => name.normalize('NFC').toLowerCase();
const validName = name => typeof name === 'string' && name.trim() && name.length <= 255 && !/["\x00-\x1f]/.test(name);
const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
export const humanWeapons = catalog => (catalog?.items ?? []).filter(item => [1, 2, 3].includes(item.itemType) && item.clip > 0);
export const humanAttackTargets = (scene, owner) => dialogueSpeakers(scene).filter(actor => key(actor.name) !== key(owner));

// enemy_move uses the stored ID, not the point's array index. Duplicate IDs
// cannot be selected safely because the engine resolves the first matching ID.
export function humanRoutePoints(navigation) {
  const points = navigation?.points ?? [], counts = new Map();
  for (const point of points) counts.set(point.id, (counts.get(point.id) ?? 0) + 1);
  return points.filter(point => integer(point.id, 0, 65535) && counts.get(point.id) === 1 && (point.type & 0x13));
}

export function validateHumanRoute(options, navigation) {
  validatePatrol(options);
  const available = humanRoutePoints(navigation), selected = options.waypoints.map(stop => available.find(point => point.id === stop.id));
  if (selected.some(point => !point)) throw new Error('Trasa: každý bod musí mít jednoznačné ID a kategorii pro chodce v check.bin této mise.');
  const byIndex = new Map(navigation.points.map(point => [point.index, point]));
  const reachable = (from, to) => {
    const seen = new Set([from.index]), queue = [from.index];
    for (let at = 0; at < queue.length; at++) {
      const point = byIndex.get(queue[at]);
      if (point.index === to.index) return true;
      for (const link of point.links) if ((link.type & 0x13) && !(link.type & 0x4080) && byIndex.has(link.target) && !seen.has(link.target)) { seen.add(link.target); queue.push(link.target); }
    }
    return false;
  };
  const legs = selected.slice(1).map((point, i) => [selected[i], point]);
  if (options.loop) legs.push([selected.at(-1), selected[0]]);
  for (const [from, to] of legs) if (!reachable(from, to)) throw new Error(`Trasa: mezi ID ${from.id} a ${to.id} chybí průchozí navigační spojení pro chodce.`);
}

function validatePatrol(options) {
  if (!Array.isArray(options.waypoints) || options.waypoints.length < 1 || options.waypoints.length > 32 || options.waypoints.some(stop => !stop || !integer(stop.id, 0, 65535) || !Number.isFinite(stop.pauseSeconds) || stop.pauseSeconds < 0 || stop.pauseSeconds > 86400)) throw new Error('Trasa: zadejte 1–32 bodů s platným ID a zastávkami 0–86400 sekund.');
  if (!['walk', 'run'].includes(options.pace) || typeof options.loop !== 'boolean' || !Number.isFinite(options.delaySeconds) || options.delaySeconds < 0 || options.delaySeconds > 86400) throw new Error('Trasa: vyberte chůzi/běh, opakování a platnou počáteční prodlevu.');
  if (options.loop && new Set(options.waypoints.map(stop => stop.id)).size < 2) throw new Error('Trasa: opakování potřebuje alespoň dva různé body.');
  for (const name of [options.startSignal, options.onComplete]) if (name != null && !validName(name)) throw new Error('Trasa: neplatný název skriptového bodu.');
  if (options.loop && options.onComplete != null) throw new Error('Trasa: signál dokončení patří pouze jednorázovému průchodu.');
}

export function resolveHumanPatrol(scene, owner, options) {
  humanBehaviorScript(owner, options);
  const targets = new Map(missionFlowTargets(scene).map(actor => [key(actor.name), actor.name])), result = { ...options };
  for (const field of ['startSignal', 'onComplete']) if (result[field] != null) {
    const name = targets.get(key(result[field]));
    if (!name || key(name) === key(owner)) throw new Error('Trasa: vyberte jiný jednoznačný skriptový bod této mise.');
    result[field] = name;
  }
  return result;
}

export function resolveHumanAttack(scene, owner, options) {
  humanBehaviorScript(owner, options);
  const target = humanAttackTargets(scene, owner).find(actor => key(actor.name) === key(options.targetName));
  if (!target) throw new Error('Postava: cíl musí být jednoznačný lidský aktér této mise.');
  const result = { ...options, targetName: target.name };
  if (result.startSignal != null) {
    const gate = missionFlowTargets(scene).find(actor => key(actor.name) === key(result.startSignal));
    if (!gate || key(gate.name) === key(owner)) throw new Error('Útok: vyberte jiný jednoznačný skriptový bod této mise.');
    result.startSignal = gate.name;
  }
  return result;
}

export function humanBehaviorScript(owner, options) {
  if (!options || !['idle', 'custom', 'attack', 'patrol', 'drive', 'follow'].includes(options.mode)) throw new Error('Postava: vyberte platné chování.');
  if (options.mode === 'follow') return humanFollowingScript(owner, options);
  if (options.mode === 'drive') return humanDrivingScript(owner, options);
  if (options.mode === 'idle') return HUMAN_IDLE_SCRIPT;
  if (options.mode === 'custom') {
    if (typeof options.code !== 'string' || options.code.includes('\0') || options.code.length > 1000000) throw new Error('Postava: neplatný vlastní program.');
    return options.code;
  }
  if (options.mode === 'patrol') {
    validatePatrol(options);
    const names = [...new Map([options.startSignal, options.onComplete].filter(name => name != null).map(name => [key(name), name])).values()];
    if (names.length && (!validName(owner) || names.some(name => key(name) === key(owner)))) throw new Error('Trasa: vyberte skriptový bod odlišný od postavy.');
    const slot = name => names.findIndex(other => key(other) === key(name));
    return [`// Mafia Workbench human patrol v${names.length ? 2 : 1}`, ...(names.length ? [`dim_act ${names.length}`] : []), 'wait 2000', ...names.map((name, i) => `findactor ${i}, "${name}"`),
      ...(options.startSignal == null ? [] : ['label 100', `detector_issignal ${slot(options.startSignal)}, 200, -1`, 'wait 100', 'goto 100', 'label 200']),
      `wait ${Math.round(options.delaySeconds * 1000)}`, 'label 1', ...options.waypoints.flatMap(stop => [`enemy_move ${stop.id}, ${options.pace}`, `wait ${Math.round(stop.pauseSeconds * 1000)}`]),
      ...(options.loop ? ['wait 100', 'goto 1'] : [...(options.onComplete == null ? [] : [`detector_setsignal ${slot(options.onComplete)}, 1`]), 'label 2', 'wait 1000', 'goto 2']), ''].join('\r\n');
  }
  if (!validName(owner) || !validName(options.targetName) || key(owner) === key(options.targetName)) throw new Error('Postava: útok potřebuje jinou cílovou postavu.');
  if (!integer(options.itemId, 1, 65535) || !integer(options.clip, 1, 100000) || !integer(options.reserve, 0, 100000)) throw new Error('Postava: zadejte zbraň a platnou munici; zásobník musí být neprázdný.');
  if (!Number.isFinite(options.range) || (options.range !== -1 && (options.range <= 0 || options.range > 10000))) throw new Error('Postava: vzdálenost útoku musí být −1 nebo kladné číslo do 10000 m.');
  if (!Number.isFinite(options.delaySeconds) || options.delaySeconds < 0 || options.delaySeconds > 86400) throw new Error('Postava: prodleva musí být 0–86400 sekund.');
  if (options.startSignal != null) {
    if (!validName(options.startSignal) || key(options.startSignal) === key(owner)) throw new Error('Útok: vyberte platný skriptový bod odlišný od postavy.');
    // Do not clear the gate: dialogue may send its signal before initialization.
    // Equip only after the gate, then retain the existing attack/active-idle flow.
    return ['// Mafia Workbench human behavior v2', 'dim_act 3', 'wait 2000', `findactor 0, "${owner}"`, `findactor 2, "${options.startSignal}"`,
      'label 100', 'detector_issignal 2, 200, -1', 'wait 100', 'goto 100', 'label 200',
      `human_addweapon 0, ${options.itemId}, ${options.clip}, ${options.reserve}`, `human_activateweapon 0, ${options.itemId}`, `wait ${Math.round(options.delaySeconds * 1000)}`,
      `findactor 1, "${options.targetName}"`, `enemy_action_fire 1, ${options.range}`, 'label 1', 'wait 1000', 'goto 1', ''].join('\r\n');
  }
  return ['// Mafia Workbench human behavior v1', 'dim_act 2', 'wait 2000', `findactor 0, "${owner}"`, `human_addweapon 0, ${options.itemId}, ${options.clip}, ${options.reserve}`, `human_activateweapon 0, ${options.itemId}`, `wait ${Math.round(options.delaySeconds * 1000)}`, `findactor 1, "${options.targetName}"`, `enemy_action_fire 1, ${options.range}`, 'label 1', 'wait 1000', 'goto 1', ''].join('\r\n');
}

// Recognize only our exact generated recipe. Arbitrary programs stay custom.
export function inspectHumanBehavior(owner, code) {
  const normalized = code.replaceAll('\r\n', '\n');
  const driving=inspectHumanDriving(owner,code);if(driving)return driving;
  const following=inspectHumanFollowing(owner,code);if(following)return following;
  if (normalized === HUMAN_IDLE_SCRIPT.replaceAll('\r\n', '\n')) return { mode: 'idle' };
  const lines = normalized.split('\n');
  if (lines[0] === '// Mafia Workbench human patrol v2') {
    const actors = new Map([...normalized.matchAll(/^findactor (\d+), "([^"\x00-\x1f]+)"$/gm)].map(match => [Number(match[1]), match[2]]));
    const start = /^detector_issignal (\d+), 200, -1$/m.exec(normalized), complete = /^detector_setsignal (\d+), 1$/m.exec(normalized), delay = /^wait (\d+)\nlabel 1$/m.exec(normalized);
    const moves = [...normalized.matchAll(/^enemy_move (\d+), (walk|run)\nwait (\d+)$/gm)];
    const options = { mode: 'patrol', waypoints: moves.map(move => ({ id: Number(move[1]), pauseSeconds: Number(move[3]) / 1000 })), pace: moves[0]?.[2], loop: normalized.includes('wait 100\ngoto 1\n'), delaySeconds: Number(delay?.[1]) / 1000, startSignal: start ? actors.get(Number(start[1])) : null, onComplete: complete ? actors.get(Number(complete[1])) : null };
    try { if (humanBehaviorScript(owner, options).replaceAll('\r\n', '\n') === normalized) return options; } catch { /* Altered source stays custom. */ }
  }
  if (lines[0] === '// Mafia Workbench human patrol v1') {
    const waypoints = [], delay = /^wait (\d+)$/.exec(lines[2] ?? ''); let pace, at = 4;
    while (/^enemy_move /.test(lines[at] ?? '')) {
      const move = /^enemy_move (\d+), (walk|run)$/.exec(lines[at]), pause = /^wait (\d+)$/.exec(lines[at + 1] ?? '');
      if (!move || !pause || pace && pace !== move[2]) break;
      pace = move[2]; waypoints.push({ id: Number(move[1]), pauseSeconds: Number(pause[1]) / 1000 }); at += 2;
    }
    const options = { mode: 'patrol', waypoints, pace, loop: lines[at] === 'wait 100', delaySeconds: Number(delay?.[1]) / 1000 };
    try { if (humanBehaviorScript(owner, options).replaceAll('\r\n', '\n') === normalized) return options; } catch { /* Keep edited code custom. */ }
  }
  if (/^\/\/ Mafia Workbench human behavior v[12]$/.test(lines[0])) {
    const gated = lines[0].endsWith('v2'), offset = gated ? 6 : 0;
    const weapon = /^human_addweapon 0, (\d+), (\d+), (\d+)$/.exec(lines[4 + offset] ?? '');
    const delay = /^wait (\d+)$/.exec(lines[6 + offset] ?? '');
    const target = /^findactor 1, "([^"\x00-\x1f]+)"$/.exec(lines[7 + offset] ?? '');
    const range = /^enemy_action_fire 1, (.+)$/.exec(lines[8 + offset] ?? '');
    if (weapon && delay && target && range) {
      const options = { mode: 'attack', itemId: Number(weapon[1]), clip: Number(weapon[2]), reserve: Number(weapon[3]), delaySeconds: Number(delay[1]) / 1000, targetName: target[1], range: Number(range[1]) };
      if (gated) options.startSignal = /^findactor 2, "([^"\x00-\x1f]+)"$/.exec(lines[4] ?? '')?.[1];
      try { if (humanBehaviorScript(owner, options).replaceAll('\r\n', '\n') === normalized) return options; } catch { /* Keep edited code custom. */ }
    }
  }
  return { mode: 'custom', code };
}
