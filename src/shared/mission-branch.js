import { dialogueSpeakers } from './mission-dialogue.js';
import { missionFlowTargets } from './mission-flow.js';
import { missionTaskVehicles } from './mission-task.js';

const key = name => name.normalize('NFC').toLowerCase();
const validName = name => typeof name === 'string' && name.trim() && name.length <= 255 && !/["\x00-\x1f]/.test(name);
const fail = message => { throw new Error(`Podmínka: ${message}`); };
const prefix = '// Mafia Workbench branch v1 ';

// A branch reads the state once, after its incoming signal (or initial delay).
// It neither consumes inventory nor clears any observed detector signal.
export function missionBranchOptions({ waitForSignal = true, match = 'all', conditions, onTrue, onFalse } = {}) {
  if (typeof waitForSignal !== 'boolean' || !['all', 'any'].includes(match)) fail('vyberte platné spuštění a spojení podmínek.');
  if (!validName(onTrue) || !validName(onFalse)) fail('vyberte oba výstupní skriptové body.');
  if (!Array.isArray(conditions) || !conditions.length || conditions.length > 8) fail('zadejte 1–8 podmínek.');
  const list = conditions.map(condition => {
    if (!condition || typeof condition.expected !== 'boolean') fail('každá podmínka potřebuje očekávaný stav.');
    const { kind, expected } = condition;
    if (kind === 'item') {
      if (!Number.isSafeInteger(condition.itemId) || condition.itemId < 2 || condition.itemId > 65535) fail('vyberte platné ID předmětu 2–65535.');
      return { kind, itemId: condition.itemId, expected };
    }
    if (kind === 'human' || kind === 'signal') {
      if (!validName(condition.name)) fail('vyberte postavu nebo skriptový bod.');
      return { kind, name: condition.name, expected };
    }
    if (kind === 'vehicle') {
      if (!validName(condition.name) || typeof condition.driverOnly !== 'boolean') fail('vyberte automobil a platné omezení na řidiče.');
      return { kind, name: condition.name, driverOnly: condition.driverOnly, expected };
    }
    if (kind === 'proximity') {
      if (!validName(condition.name) || !Number.isFinite(condition.radius) || condition.radius < 0.1 || condition.radius > 10000) fail('vyberte objekt a poloměr 0,1–10 000 metrů.');
      return { kind, name: condition.name, radius: condition.radius, expected };
    }
    fail('neznámý druh podmínky.');
  });
  return { waitForSignal, match, conditions: list, onTrue, onFalse };
}

export function missionBranchScript(options) {
  const branch = missionBranchOptions(options), names = [], slots = new Map();
  const index = name => { const canonical = key(name); if (!slots.has(canonical)) { slots.set(canonical, names.length); names.push(name); } return slots.get(canonical); };
  for (const condition of branch.conditions) {
    if (['item', 'vehicle'].includes(condition.kind)) index('Tommy');
    if (condition.kind !== 'item' && condition.kind !== 'proximity') index(condition.name);
  }
  const yes = index(branch.onTrue), no = index(branch.onFalse);
  const vehicle = branch.conditions.some(condition => condition.kind === 'vehicle'), proximity = branch.conditions.some(condition => condition.kind === 'proximity'), scratch = names.length;
  const code = [prefix + JSON.stringify(branch), `dim_act ${names.length + Number(vehicle)}`, `dim_flt ${proximity ? 7 : 1}`, ...(proximity ? ['dim_frm 3'] : []),
    // Preserve an early incoming signal; setting zero also makes a waiting
    // detector saveable. Never reset a signal already delivered at GameInit.
    'detector_issignal -1, 3, -1', 'detector_setsignal -1, 0', 'label 3', 'wait 2000'];
  if (branch.waitForSignal) code.push('label 1', 'detector_issignal -1, 2, -1', 'wait 100', 'goto 1', 'label 2');
  code.push(...names.map((name, i) => `findactor ${i}, "${name}"`));
  for (const [i, condition] of branch.conditions.entries()) {
    const next = i === branch.conditions.length - 1 ? (branch.match === 'all' ? 900 : 901) : 100 + i + 1;
    const success = branch.match === 'all' ? next : 900, failure = branch.match === 'all' ? 901 : next;
    const positive = condition.expected ? success : failure, negative = condition.expected ? failure : success;
    code.push(`label ${100 + i}`);
    if (condition.kind === 'signal') code.push(`detector_issignal ${index(condition.name)}, ${positive}, ${negative}`);
    else if (condition.kind === 'vehicle') {
      // Two NULL actor registers compare equal. Reject a missing car before
      // comparing it to the player's owner; never reuse an output's register.
      code.push(`setnullactor ${scratch}`, `compareactors ${index(condition.name)}, ${scratch}, 0`, `if flt[0] = 1, ${negative}, -1`,
        `human_getowner ${index('Tommy')}, ${scratch}`, `compareactors ${index(condition.name)}, ${scratch}, 0`,
        `if flt[0] = 1, ${condition.driverOnly ? 200 + i : positive}, ${negative}`);
      if (condition.driverOnly) code.push(`label ${200 + i}`, 'let flt[0] = -1', `human_getseatidx ${index('Tommy')}, 0`, `if flt[0] = 0, ${positive}, ${negative}`);
    }
    else if (condition.kind === 'proximity') {
      // Missing frames must not look like two coincident positions, nor reuse
      // a previous rule's frame/coordinates. A false predicate is then negated
      // normally when the rule asks for "not near".
      code.push('setnullframe 0', 'setnullframe 1', 'setnullframe 2', 'findframe 0, "Tommy"', `findframe 1, "${condition.name}"`,
        'compareframes 0, 2, 0', `if flt[0] = 1, ${negative}, -1`, 'compareframes 1, 2, 0', `if flt[0] = 1, ${negative}, -1`,
        'frm_getworldpos 0, 0', 'frm_getworldpos 1, 3', 'vect_sub_vect 0, 3', 'vect_magnitude 0, 6', `if flt[6] < ${condition.radius}, ${positive}, ${negative}`);
    }
    else {
      // A failed runtime human lookup must not retain an earlier item's 1.
      if (condition.kind === 'human') code.push('let flt[0] = 0');
      code.push(condition.kind === 'item' ? `human_isweapon ${index('Tommy')}, 0, ${condition.itemId}` : `human_getproperty ${index(condition.name)}, 0, Energy`);
      code.push(`if flt[0] ${condition.kind === 'item' ? '= 1' : '> 0'}, ${positive}, ${negative}`);
    }
  }
  code.push('label 900', `detector_setsignal ${yes}, 1`, 'end', 'label 901', `detector_setsignal ${no}, 1`, 'end');
  return code.join('\n');
}

// One geometry base plus one scene override names a single engine frame.
// Repeated names within either source are ambiguous and cannot be selected.
export function missionBranchFrames(scene, owner) {
  const groups = new Map();
  for (const [source, frames] of [[0, scene.geometry?.meshes ?? []], [1, scene.objects ?? []]]) for (const frame of frames) {
    if (!validName(frame.name)) continue;
    const identity = key(frame.name), group = groups.get(identity) ?? [[], []];
    group[source].push(frame); groups.set(identity, group);
  }
  return [...groups.entries()].filter(([identity, [base, overrides]]) => identity !== 'tommy' && identity !== key(owner ?? '') && base.length <= 1 && overrides.length <= 1)
    .map(([, [base, overrides]]) => overrides[0] ?? base[0]);
}

export function inspectMissionBranch(code) {
  if (typeof code !== 'string' || code.length > 1000000) return null;
  const source = code.replaceAll('\r\n', '\n');
  if (!source.startsWith(prefix)) return null;
  try {
    const options = missionBranchOptions(JSON.parse(source.slice(prefix.length, source.indexOf('\n'))));
    if (missionBranchScript(options) === source) return options;
  } catch { /* Metadata alone never grants permission to overwrite source. */ }
  return null;
}

export function editableMissionBranch(scene, owner) {
  if (!validName(owner)) return null;
  const actors = (scene.actors ?? []).filter(actor => key(actor.name) === key(owner)), entries = (scene.entries ?? []).filter(entry => entry.actorScript && entry.actorKind === 5 && key(entry.value.name) === key(owner));
  if (actors.length !== 1 || actors[0].kind !== 5 || entries.length !== 1 || !missionFlowTargets(scene).some(actor => key(actor.name) === key(owner))) return null;
  const masks = scene.entries.filter(entry => entry.detectorParameter && entry.id.startsWith(actors[0].id + '/'));
  if (masks.length !== 1 || masks[0].value !== 1) return null;
  const branch = inspectMissionBranch(entries[0].value.code);
  return branch ? { entry: entries[0], branch } : null;
}

export function resolveMissionBranch(scene, options, owner) {
  if (!validName(owner)) fail('zadejte platný název podmínkového bodu.');
  const branch = missionBranchOptions(options), humans = new Map(dialogueSpeakers(scene).map(actor => [key(actor.name), actor])), targets = new Map(missionFlowTargets(scene).map(actor => [key(actor.name), actor.name]));
  const vehicles = new Map(missionTaskVehicles(scene).map(actor => [key(actor.name), actor])), frames = new Map(missionBranchFrames(scene, owner).map(frame => [key(frame.name), frame]));
  const detector = name => {
    const target = targets.get(key(name));
    if (!target || key(target) === key(owner)) fail('vyberte jiný jednoznačný skriptový bod této mise.');
    return target;
  };
  const conditions = branch.conditions.map(condition => {
    if (condition.kind === 'signal') return { ...condition, name: detector(condition.name) };
    if (condition.kind === 'human') {
      const actor = humans.get(key(condition.name));
      if (!actor) fail('postava musí mít jednoznačného lidského aktéra a frame.');
      return { ...condition, name: actor.name };
    }
    if (humans.get('tommy')?.kind !== 2) fail('inventář, vzdálenost a automobil potřebují jednoznačného hráče Tommy typu Player.');
    if (condition.kind === 'vehicle' || condition.kind === 'proximity') {
      const target = (condition.kind === 'vehicle' ? vehicles : frames).get(key(condition.name));
      if (!target) fail(condition.kind === 'vehicle' ? 'automobil musí mít jednoznačného aktéra typu Car a modelový frame.' : 'vyberte jiný jednoznačný objekt s frame této mise.');
      return { ...condition, name: target.name };
    }
    return condition;
  });
  return { ...branch, conditions, onTrue: detector(branch.onTrue), onFalse: detector(branch.onFalse) };
}

export function missionBranchConditionLabel(condition) {
  if (condition.kind === 'item') return `Hráč ${condition.expected ? 'má' : 'nemá'} předmět ID ${condition.itemId}`;
  if (condition.kind === 'human') return `${condition.name}: ${condition.expected ? 'žije' : 'nežije'}`;
  if (condition.kind === 'vehicle') return `Hráč ${condition.expected ? 'je' : 'není'} v ${condition.name}${condition.driverOnly ? ' na místě řidiče' : ' na libovolném sedadle'}`;
  if (condition.kind === 'proximity') return `Hráč ${condition.expected ? 'je' : 'není'} blíž než ${condition.radius} m od ${condition.name}`;
  return `${condition.name}: signál ${condition.expected ? 'zapnutý' : 'vypnutý'}`;
}
