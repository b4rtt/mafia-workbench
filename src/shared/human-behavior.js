import { HUMAN_IDLE_SCRIPT } from './human-program.js';
import { dialogueSpeakers } from './mission-dialogue.js';
import { humanDrivingScript, inspectHumanDriving } from './human-driving.js';

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
  humanBehaviorScript('', options);
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

export function humanBehaviorScript(owner, options) {
  if (!options || !['idle', 'custom', 'attack', 'patrol', 'drive'].includes(options.mode)) throw new Error('Postava: vyberte platné chování.');
  if (options.mode === 'drive') return humanDrivingScript(owner, options);
  if (options.mode === 'idle') return HUMAN_IDLE_SCRIPT;
  if (options.mode === 'custom') {
    if (typeof options.code !== 'string' || options.code.includes('\0') || options.code.length > 1000000) throw new Error('Postava: neplatný vlastní program.');
    return options.code;
  }
  if (options.mode === 'patrol') {
    if (!Array.isArray(options.waypoints) || options.waypoints.length < 1 || options.waypoints.length > 32 || options.waypoints.some(stop => !stop || !integer(stop.id, 0, 65535) || !Number.isFinite(stop.pauseSeconds) || stop.pauseSeconds < 0 || stop.pauseSeconds > 86400)) throw new Error('Trasa: zadejte 1–32 bodů s platným ID a zastávkami 0–86400 sekund.');
    if (!['walk', 'run'].includes(options.pace) || typeof options.loop !== 'boolean' || !Number.isFinite(options.delaySeconds) || options.delaySeconds < 0 || options.delaySeconds > 86400) throw new Error('Trasa: vyberte chůzi/běh, opakování a platnou počáteční prodlevu.');
    if (options.loop && new Set(options.waypoints.map(stop => stop.id)).size < 2) throw new Error('Trasa: opakování potřebuje alespoň dva různé body.');
    return ['// Mafia Workbench human patrol v1', 'wait 2000', `wait ${Math.round(options.delaySeconds * 1000)}`, 'label 1', ...options.waypoints.flatMap(stop => [`enemy_move ${stop.id}, ${options.pace}`, `wait ${Math.round(stop.pauseSeconds * 1000)}`]), ...(options.loop ? ['wait 100', 'goto 1'] : ['label 2', 'wait 1000', 'goto 2']), ''].join('\r\n');
  }
  if (!validName(owner) || !validName(options.targetName) || key(owner) === key(options.targetName)) throw new Error('Postava: útok potřebuje jinou cílovou postavu.');
  if (!integer(options.itemId, 1, 65535) || !integer(options.clip, 1, 100000) || !integer(options.reserve, 0, 100000)) throw new Error('Postava: zadejte zbraň a platnou munici; zásobník musí být neprázdný.');
  if (!Number.isFinite(options.range) || (options.range !== -1 && (options.range <= 0 || options.range > 10000))) throw new Error('Postava: vzdálenost útoku musí být −1 nebo kladné číslo do 10000 m.');
  if (!Number.isFinite(options.delaySeconds) || options.delaySeconds < 0 || options.delaySeconds > 86400) throw new Error('Postava: prodleva musí být 0–86400 sekund.');
  return ['// Mafia Workbench human behavior v1', 'dim_act 2', 'wait 2000', `findactor 0, "${owner}"`, `human_addweapon 0, ${options.itemId}, ${options.clip}, ${options.reserve}`, `human_activateweapon 0, ${options.itemId}`, `wait ${Math.round(options.delaySeconds * 1000)}`, `findactor 1, "${options.targetName}"`, `enemy_action_fire 1, ${options.range}`, 'label 1', 'wait 1000', 'goto 1', ''].join('\r\n');
}

// Recognize only our exact generated recipe. Arbitrary programs stay custom.
export function inspectHumanBehavior(owner, code) {
  const normalized = code.replaceAll('\r\n', '\n');
  const driving=inspectHumanDriving(owner,code);if(driving)return driving;
  if (normalized === HUMAN_IDLE_SCRIPT.replaceAll('\r\n', '\n')) return { mode: 'idle' };
  const lines = normalized.split('\n');
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
  if (lines[0] === '// Mafia Workbench human behavior v1') {
    const weapon = /^human_addweapon 0, (\d+), (\d+), (\d+)$/.exec(lines[4] ?? '');
    const delay = /^wait (\d+)$/.exec(lines[6] ?? '');
    const target = /^findactor 1, "([^"\x00-\x1f]+)"$/.exec(lines[7] ?? '');
    const range = /^enemy_action_fire 1, (.+)$/.exec(lines[8] ?? '');
    if (weapon && delay && target && range) {
      const options = { mode: 'attack', itemId: Number(weapon[1]), clip: Number(weapon[2]), reserve: Number(weapon[3]), delaySeconds: Number(delay[1]) / 1000, targetName: target[1], range: Number(range[1]) };
      try { if (humanBehaviorScript(owner, options).replaceAll('\r\n', '\n') === normalized) return options; } catch { /* Keep edited code custom. */ }
    }
  }
  return { mode: 'custom', code };
}
