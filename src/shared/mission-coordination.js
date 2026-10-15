import { missionFlowTargets } from './mission-flow.js';

const key = name => name.normalize('NFC').toLowerCase();
const validName = name => typeof name === 'string' && name.trim() && name.length <= 255 && !/["\x00-\x1f]/.test(name);
const prefix = '// Mafia Workbench coordination v1 ';
const fail = message => { throw new Error(`Řídicí bod: ${message}`); };

export function missionCoordinationOptions({ waitForSignal = true, match = 'all', signals = [], delaySeconds = 0, targets } = {}) {
  if (typeof waitForSignal !== 'boolean' || !['all', 'any'].includes(match)) fail('vyberte platné spuštění a spojení signálů.');
  if (!Number.isFinite(delaySeconds) || delaySeconds < 0 || delaySeconds > 86400 || Math.abs(delaySeconds * 1000 - Math.round(delaySeconds * 1000)) > 1e-7) fail('prodleva musí být 0–86400 sekund s nejvýše třemi desetinnými místy.');
  const list = (values, minimum, label) => {
    if (!Array.isArray(values) || values.length < minimum || values.length > 8 || values.some(name => !validName(name))) fail(`${label}: vyberte ${minimum}–8 skriptových bodů.`);
    if (new Set(values.map(key)).size !== values.length) fail(`${label}: stejný bod smí být v seznamu pouze jednou.`);
    return [...values];
  };
  return { waitForSignal, match, signals: list(signals, 0, 'Vstupy'), delaySeconds: Math.round(delaySeconds * 1000) / 1000, targets: list(targets, 1, 'Výstupy') };
}

// One-shot join/fan-out. Read flags are never consumed or latched separately:
// ALL requires them to be set together during a scan, not at unrelated times.
export function missionCoordinationScript(options) {
  const recipe = missionCoordinationOptions(options), names = [], slots = new Map();
  const index = name => { const canonical = key(name); if (!slots.has(canonical)) { slots.set(canonical, names.length); names.push(name); } return slots.get(canonical); };
  for (const name of [...recipe.signals, ...recipe.targets]) index(name);
  const code = [prefix + JSON.stringify(recipe), `dim_act ${names.length}`,
    'detector_issignal -1, 3, -1', 'detector_setsignal -1, 0', 'label 3', 'wait 2000'];
  if (recipe.waitForSignal) code.push('label 1', 'detector_issignal -1, 2, -1', 'wait 100', 'goto 1', 'label 2');
  code.push(...names.map((name, i) => `findactor ${i}, "${name}"`), 'label 10', 'commandblock 1');
  for (const [i, name] of recipe.signals.entries()) {
    const next = i === recipe.signals.length - 1 ? (recipe.match === 'all' ? 20 : 11) : 100 + i + 1;
    code.push(`label ${100 + i}`, `detector_issignal ${index(name)}, ${recipe.match === 'all' ? next : 20}, ${recipe.match === 'all' ? 11 : next}`);
  }
  if (!recipe.signals.length) code.push('goto 20');
  code.push('label 11', 'commandblock 0', 'wait 100', 'goto 10', 'label 20', 'commandblock 0');
  if (recipe.delaySeconds) code.push(`wait ${Math.round(recipe.delaySeconds * 1000)}`);
  code.push('commandblock 1', ...recipe.targets.map(name => `detector_setsignal ${index(name)}, 1`), 'commandblock 0', 'end');
  return code.join('\n');
}

export function inspectMissionCoordination(code) {
  if (typeof code !== 'string' || code.length > 1000000) return null;
  const source = code.replaceAll('\r\n', '\n');
  if (!source.startsWith(prefix)) return null;
  try {
    const options = missionCoordinationOptions(JSON.parse(source.slice(prefix.length, source.indexOf('\n'))));
    if (missionCoordinationScript(options) === source) return options;
  } catch { /* A metadata comment alone does not authorize source replacement. */ }
  return null;
}

export function editableMissionCoordination(scene, owner) {
  if (!validName(owner)) return null;
  const actors = (scene.actors ?? []).filter(actor => key(actor.name) === key(owner)), entries = (scene.entries ?? []).filter(entry => entry.actorScript && entry.actorKind === 5 && key(entry.value.name) === key(owner));
  if (actors.length !== 1 || actors[0].kind !== 5 || entries.length !== 1 || !missionFlowTargets(scene).some(actor => key(actor.name) === key(owner))) return null;
  const masks = scene.entries.filter(entry => entry.detectorParameter && entry.id.startsWith(actors[0].id + '/'));
  if (masks.length !== 1 || masks[0].value !== 1) return null;
  const coordination = inspectMissionCoordination(entries[0].value.code);
  return coordination ? { entry: entries[0], coordination } : null;
}

export function resolveMissionCoordination(scene, options, owner) {
  if (!validName(owner)) fail('zadejte platný název.');
  const recipe = missionCoordinationOptions(options), targets = new Map(missionFlowTargets(scene).map(actor => [key(actor.name), actor.name]));
  const detector = name => {
    const target = targets.get(key(name));
    if (!target || key(target) === key(owner)) fail('vstupy i výstupy musí být jiné jednoznačné skriptové body této mise.');
    return target;
  };
  return { ...recipe, signals: recipe.signals.map(detector), targets: recipe.targets.map(detector) };
}
