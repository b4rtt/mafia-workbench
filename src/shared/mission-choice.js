import { dialogueSpeakers } from './mission-dialogue.js';
import { missionFlowTargets } from './mission-flow.js';

const key = name => name.normalize('NFC').toLowerCase();
const validName = name => typeof name === 'string' && name.trim() && name.length <= 255 && !/["\x00-\x1f]/.test(name);
const ownerName = name => typeof name === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,54}$/.test(name);
const answerName = (owner, index) => `${owner}_ANSWER${index + 1}`;
// EVENT/SETEVENT parse custom IDs with atoi; names would all become zero.
const eventId = index => 1000 + index;

function controllerProgram(groups) {
  const names = groups.flatMap(group => group.names);
  const code = [`dim_act ${names.length}`, ...names.map((name, index) => `findactor ${index}, "${name}"`), 'label 1', 'wait 1000', 'goto 1'];
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
  if (code === '' || code === 'end') return [];
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

export function choiceControllers(scene) {
  const targets = new Set(missionFlowTargets(scene).map(actor => key(actor.name)));
  return dialogueSpeakers(scene).filter(actor => actor.kind === 27).flatMap(actor => {
    const scripts = (scene.entries ?? []).filter(entry => entry.actorScript && entry.actorKind === 27 && key(entry.value.name) === key(actor.name));
    if (scripts.length !== 1) return [];
    const groups = choiceControllerGroups(scripts[0].value.code);
    if (!groups || groups.length >= 16 || groups.some(group => [group.owner, `${group.owner}_CLAIM`, ...group.names].some(name => !targets.has(key(name))))) return [];
    return [{ name: actor.name, scriptId: scripts[0].id, groups }];
  });
}

export function missionChoicePrograms({ name, controller, waitForSignal = false, answers } = {}, groups = []) {
  if (!ownerName(name)) throw new Error('Volba: název musí mít 1–55 ASCII písmen, číslic nebo podtržítek a začínat písmenem či podtržítkem.');
  if (!validName(controller) || typeof waitForSignal !== 'boolean') throw new Error('Volba: vyberte řídicí postavu a platný způsob spuštění.');
  if (!Array.isArray(answers) || answers.length < 2 || answers.length > 4) throw new Error('Volba: zadejte 2–4 odpovědi.');
  for (const answer of answers) {
    if (!answer || !Number.isSafeInteger(answer.textId) || answer.textId < 0 || answer.textId > 0x7fffffff || !validName(answer.target)) throw new Error('Volba: každá odpověď potřebuje ID textu a cílový skriptový bod.');
  }
  if (new Set(answers.map(answer => answer.textId)).size !== answers.length) throw new Error('Volba: texty odpovědí musí mít různá ID.');
  if (!Array.isArray(groups) || groups.length >= 16) throw new Error('Volba: řídicí postava podporuje nejvýše 16 sad odpovědí.');
  const claim = `${name}_CLAIM`, names = answers.map((_, index) => answerName(name, index)), event = eventId(groups.length);
  const start = [`dim_act ${answers.length}`, ...names.map((name, index) => `findactor ${index}, "${name}"`),
    // Mark the program as saveable without discarding an early incoming signal.
    'detector_issignal -1, 3, -1', 'detector_setsignal -1, 0', 'label 3', 'wait 2000'];
  if (waitForSignal) start.push('label 1', 'detector_issignal -1, 2, -1', 'wait 100', 'goto 1', 'label 2');
  start.push('detector_setsignal -1, 1', ...names.map((_, index) => `detector_setsignal ${index}, 1`), 'end');
  const nodes = [{ name, code: start.join('\n') }, { name: claim, code: 'detector_setsignal -1, 0\nlabel 1\nwait 1000\ngoto 1' }];
  for (const [index, answer] of answers.entries()) nodes.push({ name: names[index], code: [
    'dim_act 3', `findactor 0, "${claim}"`, `findactor 1, "${controller}"`, `findactor 2, "${answer.target}"`,
    'detector_setsignal -1, 0', 'label 1', 'detector_issignal -1, 2, -1', 'wait 100', 'goto 1', 'label 2',
    `detector_waitforuse ${answer.textId}`, 'detector_issignal 0, 90, -1', 'detector_setsignal 0, 1',
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
