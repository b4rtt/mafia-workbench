import { HUMAN_IDLE_SCRIPT } from './human-program.js';
import { dialogueSpeakers } from './mission-dialogue.js';

const key = name => name.normalize('NFC').toLowerCase();
const validName = name => typeof name === 'string' && name.trim() && name.length <= 255 && !/["\x00-\x1f]/.test(name);
const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
export const humanWeapons = catalog => (catalog?.items ?? []).filter(item => [1, 2, 3].includes(item.itemType) && item.clip > 0);
export const humanAttackTargets = (scene, owner) => dialogueSpeakers(scene).filter(actor => key(actor.name) !== key(owner));

export function humanBehaviorScript(owner, options) {
  if (!options || !['idle', 'custom', 'attack'].includes(options.mode)) throw new Error('Postava: vyberte platné chování.');
  if (options.mode === 'idle') return HUMAN_IDLE_SCRIPT;
  if (options.mode === 'custom') {
    if (typeof options.code !== 'string' || options.code.includes('\0') || options.code.length > 1000000) throw new Error('Postava: neplatný vlastní program.');
    return options.code;
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
  if (normalized === HUMAN_IDLE_SCRIPT.replaceAll('\r\n', '\n')) return { mode: 'idle' };
  const lines = normalized.split('\n');
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
