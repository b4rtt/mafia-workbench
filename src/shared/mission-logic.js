import { editableMissionTask } from './mission-task.js';
import { editableMissionDialogue } from './mission-dialogue.js';
import { editableMissionCombat } from './mission-combat.js';
import { choiceControllers, editableMissionChoice } from './mission-choice.js';
import { missionFlowTargets } from './mission-flow.js';

const key = name => name.normalize('NFC').toLowerCase();
export const logicKinds = { task: 'Úkol', dialogue: 'Rozhovor', combat: 'Bojový úkol', choice: 'Volba odpovědi', custom: 'Vlastní skript', unresolved: 'Nedostupný bod', mission: 'Další mise', ending: 'Konec mise' };

// Edges come only from complete, previously verified editor recipes. Arbitrary
// LS3D programs remain visible source nodes; we do not infer their execution.
export function missionLogic(scene) {
  const nodes = [], edges = [], aliases = new Map(), owned = new Set(), controllers = choiceControllers(scene, { includeFull: true });
  const add = node => { node.warnings = []; nodes.push(node); return node; };
  const alias = (name, node) => { const canonical = key(name); aliases.set(canonical, [...(aliases.get(canonical) ?? []), node]); };
  for (const controller of controllers) {
    let complete = true;
    for (const group of controller.groups) {
      const recovered = editableMissionChoice(scene, group.owner);
      if (!recovered) { complete = false; continue; }
      const entry = recovered.nodes[0].entry, node = add({ id: `script:${entry.id}`, name: group.owner, kind: 'choice', entryId: entry.id, recipe: recovered.choice, members: recovered.nodes.map(member => member.name), trigger: 'use', waiting: recovered.choice.waitForSignal });
      for (const member of recovered.nodes) { owned.add(member.entry.id); alias(member.name, node); }
    }
    // A partially modified controller must remain inspectable as custom source.
    if (complete && controller.groups.length) owned.add(controller.scriptId);
  }
  for (const entry of scene.entries ?? []) {
    if (entry.kind !== 'script' || owned.has(entry.id)) continue;
    const name = entry.value.name;
    const detector = entry.actorScript && entry.actorKind === 5;
    const task = detector ? editableMissionTask(scene, name) : null, dialogue = detector && !task ? editableMissionDialogue(scene, name) : null, combat = detector && !task && !dialogue ? editableMissionCombat(scene, name) : null;
    const kind = task ? 'task' : dialogue ? 'dialogue' : combat ? 'combat' : 'custom';
    const recipe = task?.task ?? dialogue?.dialogue ?? combat?.combat ?? null;
    const node = add({ id: `script:${entry.id}`, name, kind, entryId: entry.id, actor: Boolean(entry.actorScript), recipe, members: [name], trigger: kind === 'task' ? 'use' : recipe?.trigger ?? null, waiting: recipe?.flow?.waitForSignal ?? false });
    if (entry.actorScript) alias(name, node);
  }
  const targets = new Set(missionFlowTargets(scene).map(actor => key(actor.name)));
  function target(name) {
    const matches = aliases.get(key(name)) ?? [], actors = (scene.actors ?? []).filter(actor => key(actor.name) === key(name));
    if (matches.length === 1 && actors.length === 1 && targets.has(key(name))) return matches[0];
    const id = `unresolved:${key(name)}`;
    let node = nodes.find(node => node.id === id);
    if (!node) {
      node = add({ id, name, kind: 'unresolved', members: [] });
      node.warnings.push(actors.length ? 'Bod nemá jednoznačný program nebo platnou vazbu na scénu.' : 'Cílový bod v misi chybí.');
    }
    return node;
  }
  function link(source, name, kind, label) {
    const destination = target(name), helper = destination.kind === 'choice' && key(destination.name) !== key(name);
    edges.push({ id: `edge:${edges.length}`, from: source.id, to: destination.id, kind, label, targetName: name, helper });
    if (helper) source.warnings.push(`Signál míří přímo na pomocný bod ${name}, nikoli na začátek volby ${destination.name}.`);
  }
  function terminal(source, name, kind, branch, label) {
    const id = kind === 'mission' ? `mission:${key(name)}` : `ending:${source.id}:${branch}`;
    let destination = nodes.find(node => node.id === id);
    if (!destination) destination = add({ id, name, kind, members: [] });
    edges.push({ id: `edge:${edges.length}`, from: source.id, to: destination.id, kind: branch, label });
  }
  for (const node of [...nodes]) {
    const recipe = node.recipe;
    if (!recipe) continue;
    if (node.kind === 'choice') {
      recipe.answers.forEach((answer, index) => link(node, answer.target, 'answer', `Odpověď ${index + 1} · text ${answer.textId}`));
      continue;
    }
    if (recipe.flow?.onComplete) link(node, recipe.flow.onComplete, 'success', 'Dokončení');
    if (recipe.flow?.onFailure) link(node, recipe.flow.onFailure, 'failure', 'Neúspěch');
    if (recipe.nextMission) terminal(node, recipe.nextMission, 'mission', 'success', 'Přejít do mise');
    if (recipe.exitToMenu) terminal(node, 'Návrat do menu', 'ending', 'success', 'Dokončení');
    if (recipe.failure?.endMission) terminal(node, 'Neúspěšné ukončení', 'ending', 'failure', 'Neúspěch');
  }
  for (const node of nodes) {
    if (node.waiting && !edges.some(edge => edge.to === node.id && !edge.helper)) node.warnings.push('Čeká na signál; v rozpoznaných návaznostech nemá odesílatele. Může jej spouštět vlastní skript.');
  }
  for (const cycle of layoutMissionLogic({ nodes, edges }).cycles) {
    for (const id of cycle) nodes.find(node => node.id === id).warnings.push('Cyklus návazností. Počáteční aktivaci může zajistit hráč nebo vnější signál; diagram běh skriptů nesimuluje.');
  }
  return { nodes, edges };
}

// Condense strongly connected components before laying out the DAG. Iterative
// traversal also supports long quest chains without exhausting the JS stack.
export function layoutMissionLogic({ nodes, edges }) {
  const ids = nodes.map(node => node.id), forward = new Map(ids.map(id => [id, []])), backward = new Map(ids.map(id => [id, []]));
  for (const edge of edges) if (forward.has(edge.from) && forward.has(edge.to)) { forward.get(edge.from).push(edge.to); backward.get(edge.to).push(edge.from); }
  const visited = new Set(), order = [];
  for (const id of ids) {
    if (visited.has(id)) continue;
    visited.add(id); const stack = [[id, 0]];
    while (stack.length) {
      const frame = stack.at(-1), children = forward.get(frame[0]);
      if (frame[1] < children.length) { const child = children[frame[1]++]; if (!visited.has(child)) { visited.add(child); stack.push([child, 0]); } }
      else { order.push(frame[0]); stack.pop(); }
    }
  }
  const component = new Map(), groups = [];
  for (const id of order.reverse()) {
    if (component.has(id)) continue;
    const group = [], index = groups.length, stack = [id]; component.set(id, index);
    while (stack.length) { const current = stack.pop(); group.push(current); for (const previous of backward.get(current)) if (!component.has(previous)) { component.set(previous, index); stack.push(previous); } }
    groups.push(group);
  }
  const links = groups.map(() => new Set()), degree = groups.map(() => 0), levels = groups.map(() => 0);
  for (const edge of edges) {
    const from = component.get(edge.from), to = component.get(edge.to);
    if (from !== undefined && to !== undefined && from !== to && !links[from].has(to)) { links[from].add(to); degree[to]++; }
  }
  const queue = degree.flatMap((count, index) => count ? [] : [index]);
  for (let i = 0; i < queue.length; i++) for (const next of links[queue[i]]) { levels[next] = Math.max(levels[next], levels[queue[i]] + 1); if (!--degree[next]) queue.push(next); }
  const rows = new Map(), positions = new Map();
  for (const id of ids) { const column = levels[component.get(id)], row = rows.get(column) ?? 0; rows.set(column, row + 1); positions.set(id, { x: 32 + column * 340, y: 96 + row * 164 }); }
  return { positions, width: Math.max(640, 340 * (Math.max(0, ...levels) + 1)), height: Math.max(360, 164 * Math.max(0, ...rows.values()) + 96), cycles: groups.filter(group => group.length > 1 || forward.get(group[0]).includes(group[0])) };
}
