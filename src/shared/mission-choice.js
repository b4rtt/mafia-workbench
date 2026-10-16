import { dialogueSpeakers } from './mission-dialogue.js';
import { missionFlowTargets } from './mission-flow.js';
import { attachedInteraction } from './mission-interaction.js';
import { choiceMenuStatusMarkerBase } from './choice-menu-protocol.js';

const key = name => name.normalize('NFC').toLowerCase();
const validName = name => typeof name === 'string' && name.trim() && name.length <= 255 && !/["\x00-\x1f]/.test(name);
const ownerName = name => typeof name === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,54}$/.test(name);
const answerName = (owner, index) => `${owner}_ANSWER${index + 1}`;
// EVENT/SETEVENT parse custom IDs with atoi; names would all become zero.
const eventId = index => 1000 + index;
export const choiceMovementName = 'WB_CHOICE_MOVEMENT';

// One lease for the whole mission: overlapping answer menus must not save an
// already-zero speed, or restore movement while another menu still owns it.
export function choiceMovementProgram(choices) {
  const list = [...choices].sort((a, b) => key(a.name).localeCompare(key(b.name), 'en'));
  const actors = [...new Set(list.flatMap(choice => [`${choice.name}_CLAIM`, choice.controller]))];
  const index = name => actors.indexOf(name) + 1;
  return ['dim_act ' + (actors.length + 1), 'dim_flt 3', 'getactiveplayer 0',
    ...actors.map((name, i) => `findactor ${i + 1}, "${name}"`),
    'let flt[1] = 0', 'detector_setsignal -1, 0', 'label 1', 'wait 50', 'commandblock 1',
    'let flt[2] = 0', 'human_getproperty 0, 2, Energy', 'if flt[2] > 0, -1, 80',
    ...list.flatMap((choice, i) => ['let flt[2] = 0', `human_getproperty ${index(choice.controller)}, 2, Energy`,
      `if flt[2] > 0, -1, ${100 + i}`, `detector_issignal ${index(`${choice.name}_CLAIM`)}, 10, -1`, `label ${100 + i}`]),
    'goto 80', 'label 10', 'if flt[1] = 1, 20, -1', 'human_getproperty 0, 0, Speed', 'let flt[1] = 1',
    'label 20', 'human_setproperty 0, 0, Speed', 'detector_setsignal -1, 1', 'goto 90',
    'label 80', 'if flt[1] = 0, 85, -1', 'human_setproperty 0, flt[0], Speed', 'let flt[1] = 0',
    'label 85', 'detector_setsignal -1, 0', 'label 90', 'commandblock 0', 'goto 1'].join('\n');
}

function controllerProgram(groups) {
  const names = groups.flatMap(group => group.names);
  const code = [...(names.length ? [`dim_act ${names.length}`] : []), ...names.map((name, index) => `findactor ${index}, "${name}"`), 'label 1', 'wait 1000', 'goto 1'];
  let offset = 0;
  for (const [index, group] of groups.entries()) {
    code.push(`event ${eventId(index)}`, ...group.names.map((_, i) => `enemy_use_detector ${offset + i}`), 'return');
    offset += group.names.length;
  }
  return code.join('\n');
}

// Only extend a wholly generated controller or an empty program. No metadata
// comment grants ownership: the complete source must match the generator.
export function choiceControllerGroups(source) {
  if (typeof source !== 'string') return null;
  const code = source.replaceAll('\r\n', '\n').trim();
  if (code === '' || code === 'end' || code === controllerProgram([])) return [];
  const lines = code.split('\n'), count = /^dim_act (\d+)$/.exec(lines.shift());
  if (!count || Number(count[1]) < 2 || Number(count[1]) > 64) return null;
  const names = [];
  for (let index = 0; index < Number(count[1]); index++) {
    const match = new RegExp(`^findactor ${index}, "([^"]+)"$`).exec(lines.shift() ?? '');
    if (!match || !validName(match[1])) return null;
    names.push(match[1]);
  }
  if (lines.splice(0, 3).join('\n') !== 'label 1\nwait 1000\ngoto 1') return null;
  const groups = [];
  let offset = 0;
  while (lines.length) {
    if (groups.length >= 16 || lines.shift() !== `event ${eventId(groups.length)}`) return null;
    const start = offset;
    while (lines[0] === `enemy_use_detector ${offset}`) { lines.shift(); offset++; }
    if (offset - start < 2 || offset - start > 4 || lines.shift() !== 'return') return null;
    const groupNames = names.slice(start, offset), owner = /^(.*)_ANSWER1$/.exec(groupNames[0] ?? '')?.[1];
    if (!ownerName(owner) || groupNames.some((name, index) => name !== answerName(owner, index))) return null;
    groups.push({ owner, names: groupNames });
  }
  if (offset !== names.length || new Set(groups.map(group => key(group.owner))).size !== groups.length) return null;
  return controllerProgram(groups) === code ? groups : null;
}

export function choiceControllers(scene, { includeFull = false } = {}) {
  const targets = new Set(missionFlowTargets(scene).map(actor => key(actor.name)));
  return dialogueSpeakers(scene).filter(actor => actor.kind === 27).flatMap(actor => {
    const scripts = (scene.entries ?? []).filter(entry => entry.actorScript && entry.actorKind === 27 && key(entry.value.name) === key(actor.name));
    if (scripts.length !== 1) return [];
    const groups = choiceControllerGroups(scripts[0].value.code);
    if (!groups || (!includeFull && groups.length >= 16) || groups.some(group => [group.owner, `${group.owner}_CLAIM`, ...group.names].some(name => !targets.has(key(name))))) return [];
    return [{ name: actor.name, scriptId: scripts[0].id, groups }];
  });
}

export function missionChoicePrograms({ name, controller, waitForSignal = false, answers, atController = false, lockPlayer = false, autoOpen = false, promptId } = {}, groups = []) {
  if (!ownerName(name)) throw new Error('Volba: název musí mít 1–55 ASCII písmen, číslic nebo podtržítek a začínat písmenem či podtržítkem.');
  if (!validName(controller) || typeof waitForSignal !== 'boolean' || typeof atController !== 'boolean') throw new Error('Volba: vyberte řídicí postavu a platný způsob spuštění.');
  if (typeof lockPlayer !== 'boolean' || (lockPlayer && !atController)) throw new Error('Volba: zámek pohybu potřebuje nabídku u řídicí postavy.');
  if (typeof autoOpen !== 'boolean' || (autoOpen && (!atController || lockPlayer))) throw new Error('Volba: automatické otevření potřebuje odpovědi u postavy a vypnuté předčasné zastavení.');
  if (promptId !== undefined && (!Number.isSafeInteger(promptId) || promptId < 0 || promptId > 0x7fffffff)) throw new Error('Volba: pokyn potřebuje platné ID textu.');
  if (key(name) === key(choiceMovementName)) throw new Error('Volba: tento název je vyhrazen správě pohybu.');
  if (!Array.isArray(answers) || answers.length < 2 || answers.length > 4) throw new Error('Volba: zadejte 2–4 odpovědi.');
  for (const answer of answers) {
    if (!answer || !Number.isSafeInteger(answer.textId) || answer.textId < 0 || answer.textId > 0x7fffffff || !validName(answer.target)) throw new Error('Volba: každá odpověď potřebuje ID textu a cílový skriptový bod.');
  }
  if (new Set(answers.map(answer => answer.textId)).size !== answers.length) throw new Error('Volba: texty odpovědí musí mít různá ID.');
  if (!Array.isArray(groups) || groups.length >= 16) throw new Error('Volba: řídicí postava podporuje nejvýše 16 sad odpovědí.');
  const claim = `${name}_CLAIM`, names = answers.map((_, index) => answerName(name, index)), event = eventId(groups.length);
  const count = answers.length;
  const start = [`dim_act ${count + (lockPlayer ? 4 : autoOpen ? 1 : 0)}`, ...(lockPlayer ? ['dim_flt 1'] : autoOpen ? ['dim_flt 2'] : []), ...names.map((name, index) => `findactor ${index}, "${name}"`),
    ...(autoOpen ? [`findactor ${count}, "${claim}"`] : []),
    ...(lockPlayer ? [`findactor ${count}, "${choiceMovementName}"`, `findactor ${count + 1}, "${claim}"`, `getactiveplayer ${count + 2}`, `findactor ${count + 3}, "${controller}"`] : []),
    // Mark the program as saveable without discarding an early incoming signal.
    'detector_issignal -1, 3, -1', 'detector_setsignal -1, 0', 'label 3', 'wait 2000'];
  if (waitForSignal) start.push('label 1', 'detector_issignal -1, 2, -1', 'wait 100', 'goto 1', 'label 2');
  if (lockPlayer) start.push('label 4', `getactorsdist ${count + 2}, ${count + 3}, 0`, 'if flt[0] < 1.5, 5, -1', 'wait 100', 'goto 4', 'label 5',
    `detector_setsignal ${count + 1}, 1`, 'label 6', `detector_issignal ${count}, 7, -1`, 'wait 50', 'goto 6', 'label 7');
  start.push('detector_setsignal -1, 1', ...names.map((_, index) => `detector_setsignal ${index}, 1`));
  if (autoOpen) start.push('let flt[1] = 0', 'label 8', `detector_issignal ${count}, 9, -1`,
    'let flt[0] = -1', `human_candie ${choiceMenuStatusMarkerBase + count}`,
    'if flt[0] = 1, 9, -1', 'if flt[0] = -1, 10, -1',
    'let flt[1] = flt[1] + 1', 'if flt[1] < 20, 11, 10', 'label 11', 'wait 100', 'goto 8', 'label 10');
  start.push(...(promptId === undefined ? [] : [`subtitle_add ${promptId}`]), ...(autoOpen ? ['label 9'] : []), 'end');
  const nodes = [{ name, code: start.join('\n') }, { name: claim, code: 'detector_setsignal -1, 0\nlabel 1\nwait 1000\ngoto 1' }];
  for (const [index, answer] of answers.entries()) nodes.push({ name: names[index], code: [
    'dim_act 3', ...(atController ? ['dim_frm 2', 'dim_flt 3'] : []), `findactor 0, "${claim}"`, `findactor 1, "${controller}"`, `findactor 2, "${answer.target}"`,
    'detector_setsignal -1, 0', 'label 1', 'detector_issignal -1, 2, -1', 'wait 100', 'goto 1', 'label 2',
    ...(atController ? [attachedInteraction(controller).trimEnd()] : []), `detector_waitforuse ${answer.textId}`,
    ...(lockPlayer ? ['detector_issignal 0, 50, 90', 'label 50', 'detector_setsignal 0, 0'] : ['detector_issignal 0, 90, -1', 'detector_setsignal 0, 1']),
    `setevent 1, ${event}, -1`, 'detector_setsignal 2, 1', 'end', 'label 90', 'end'
  ].join('\n') });
  return { nodes, controller: { name: controller, code: controllerProgram([...groups, { owner: name, names }]) } };
}

export function resolveMissionChoice(scene, options) {
  const controller = typeof options?.controller === 'string' ? choiceControllers(scene).find(actor => key(actor.name) === key(options.controller)) : null;
  if (!controller) throw new Error('Volba: vyberte jednoznačnou NPC postavu s prázdným programem nebo řídicím programem voleb editoru.');
  const targets = new Map(missionFlowTargets(scene).map(actor => [key(actor.name), actor.name]));
  if (!Array.isArray(options.answers)) throw new Error('Volba: chybí odpovědi.');
  const answers = options.answers.map(answer => {
    const target = typeof answer?.target === 'string' ? targets.get(key(answer.target)) : null;
    if (!target) throw new Error('Volba: cílem musí být jednoznačný skriptový bod této mise.');
    return { ...answer, target };
  });
  const plan = missionChoicePrograms({ ...options, controller: controller.name, answers }, controller.groups);
  const existing = new Set([...(scene.actors ?? []), ...(scene.objects ?? []), ...(scene.geometry?.meshes ?? [])].filter(object => typeof object.name === 'string').map(object => key(object.name)));
  if (plan.nodes.some(node => existing.has(key(node.name)))) throw new Error('Volba: název volby nebo některého pomocného bodu již existuje.');
  return { ...plan, scriptId: controller.scriptId };
}

// A complete group must match all generated programs, not just its owner name.
function inspectChoiceGroup(scene, controller, index) {
  const group = controller.groups[index];
  if (!group) return null;
  const nodes = [group.owner, `${group.owner}_CLAIM`, ...group.names].map(name => {
    const actors = (scene.actors ?? []).filter(actor => key(actor.name) === key(name));
    const objects = (scene.objects ?? []).filter(object => key(object.name) === key(name));
    const scripts = (scene.entries ?? []).filter(entry => entry.actorScript && entry.actorKind === 5 && key(entry.value.name) === key(name));
    if (actors.length !== 1 || actors[0].kind !== 5 || objects.length !== 1 || objects[0].frameType !== 6 || scripts.length !== 1 || (scene.geometry?.meshes ?? []).some(mesh => key(mesh.name) === key(name))) return null;
    const masks = scene.entries.filter(entry => entry.detectorParameter && entry.id.startsWith(actors[0].id + '/'));
    return masks.length === 1 && masks[0].value === 0 ? { name, entry: scripts[0], object: objects[0] } : null;
  });
  if (nodes.some(node => !node)) return null;
  const answers = nodes.slice(2).map(node => {
    const code = node.entry.value.code.replaceAll('\r\n', '\n');
    const id = /^detector_waitforuse (\d+)$/m.exec(code), target = /^findactor 2, "([^"\x00-\x1f]+)"$/m.exec(code);
    return { textId: Number(id?.[1]), target: target?.[1] };
  });
  const prompt = /^subtitle_add (\d+)$/m.exec(nodes[0].entry.value.code.replaceAll('\r\n', '\n'));
  const choice = { ...(prompt ? { promptId: Number(prompt[1]) } : {}), ...(nodes[2].entry.value.code.includes('frm_linkto 1, 0') ? { atController: true } : {}), ...(nodes[0].entry.value.code.includes(`, "${choiceMovementName}"`) ? { lockPlayer: true } : {}), ...(nodes[0].entry.value.code.includes(`human_candie ${choiceMenuStatusMarkerBase + answers.length}`) ? { autoOpen: true } : {}), name: group.owner, controller: controller.name, waitForSignal: nodes[0].entry.value.code.replaceAll('\r\n', '\n').includes('label 1\ndetector_issignal -1, 2, -1\n'), answers };
  try {
    const expected = missionChoicePrograms(choice, controller.groups.slice(0, index));
    if (expected.nodes.some((node, i) => node.code !== nodes[i].entry.value.code.replaceAll('\r\n', '\n'))) return null;
    return { choice, nodes, controller, index };
  } catch { return null; }
}
export function editableMissionChoice(scene, selected) {
  if (typeof selected !== 'string') return null;
  const matches = choiceControllers(scene, { includeFull: true }).flatMap(controller => controller.groups.flatMap((group, index) =>
    [group.owner, `${group.owner}_CLAIM`, ...group.names].some(name => key(name) === key(selected)) ? [{ controller, index }] : []));
  return matches.length === 1 ? inspectChoiceGroup(scene, matches[0].controller, matches[0].index) : null;
}
export function resolveMissionChoiceEdit(scene, selected, options) {
  const current = editableMissionChoice(scene, selected);
  if (!current) throw new Error('Volba: vyberte úplnou nezměněnou skupinu volby odpovědí. Vlastní program upravte v inspektoru.');
  const controllers = choiceControllers(scene, { includeFull: true });
  const nextController = typeof options?.controller === 'string' ? controllers.find(actor => key(actor.name) === key(options.controller)) : null;
  if (!nextController) throw new Error('Volba: vyberte jednoznačnou NPC s prázdným nebo řídicím programem voleb.');
  const same = key(nextController.name) === key(current.controller.name);
  if (!same && nextController.groups.length >= 16) throw new Error('Volba: řídicí postava už obsluhuje 16 sad.');
  const owned = new Set(current.nodes.map(node => key(node.name))), targets = new Map(missionFlowTargets(scene).map(actor => [key(actor.name), actor.name]));
  if (!Array.isArray(options.answers)) throw new Error('Volba: chybí odpovědi.');
  const answers = options.answers.map(answer => {
    const target = typeof answer?.target === 'string' ? targets.get(key(answer.target)) : null;
    if (!target || owned.has(key(target))) throw new Error('Volba: cílem musí být jiný jednoznačný skriptový bod této mise.');
    return { ...answer, target };
  });
  const choice = { ...options, name: current.choice.name, controller: nextController.name, answers };
  const controllerPlans = [], nodes = [];
  for (const controller of same ? [current.controller] : [current.controller, nextController]) {
    const recipes = controller.groups.map(group => editableMissionChoice(scene, group.owner));
    if (recipes.some(recipe => !recipe)) throw new Error('Volba: jiná skupina řídicí postavy má vlastní nebo neúplný program. Nejdřív opravte její vazby v inspektoru.');
    const list = recipes.map(recipe => recipe.choice);
    if (key(controller.name) === key(current.controller.name)) {
      if (same) list[current.index] = choice; else list.splice(current.index, 1);
    } else list.push(choice);
    const groups = [];
    for (const recipe of list) {
      const plan = missionChoicePrograms(recipe, groups);
      nodes.push(...plan.nodes);
      groups.push({ owner: recipe.name, names: plan.nodes.slice(2).map(node => node.name) });
    }
    controllerPlans.push({ scriptId: controller.scriptId, name: controller.name, code: controllerProgram(groups) });
  }
  const existing = new Set([...(scene.actors ?? []), ...(scene.objects ?? []), ...(scene.geometry?.meshes ?? [])].map(object => key(object.name)));
  const additions = nodes.filter(node => !existing.has(key(node.name)));
  const selectedNodes = nodes.filter(node => node.name === choice.name || node.name === `${choice.name}_CLAIM` || answers.some((_, index) => node.name === answerName(choice.name, index)));
  if (selectedNodes.some(node => existing.has(key(node.name)) && !owned.has(key(node.name)))) throw new Error('Volba: název nové odpovědi již existuje.');
  const keep = new Set(selectedNodes.map(node => key(node.name))), removed = current.nodes.filter(node => !keep.has(key(node.name)));
  return { choice, current, nodes, additions, removed, controllers: controllerPlans };
}
