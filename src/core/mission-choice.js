import { relativeAssetPath } from './dta.js';
import { hash } from './files.js';
import { parseTextDb, addTextDbEntry } from './textdb.js';
import { inspectScene, editScene, changeSceneObject, removeChoiceDetector } from './scene.js';
import { sceneWorld } from './model-collision.js';
import { resolveMissionChoice, resolveMissionChoiceEdit, choiceControllers, editableMissionChoice, choiceMovementName, choiceMovementProgram } from '../shared/mission-choice.js';

const key = name => name.normalize('NFC').toLowerCase();
function movementState(scene) {
  const choices = choiceControllers(scene, { includeFull: true }).flatMap(controller => controller.groups.flatMap(group => {
    const current = editableMissionChoice(scene, group.owner);
    return current?.choice.lockPlayer ? [current.choice] : [];
  }));
  const scripts = scene.entries.filter(entry => entry.actorScript && key(entry.value.name) === key(choiceMovementName));
  const actors = scene.actors.filter(actor => key(actor.name) === key(choiceMovementName));
  const objects = scene.objects.filter(object => key(object.name) === key(choiceMovementName));
  const entry = scripts[0];
  if (scripts.length || actors.length || objects.length || scene.geometry.meshes.some(mesh => key(mesh.name) === key(choiceMovementName))) {
    const masks = actors.length === 1 ? scene.entries.filter(item => item.detectorParameter && item.id.startsWith(actors[0].id + '/')) : [];
    if (scripts.length !== 1 || actors.length !== 1 || actors[0].kind !== 5 || objects.length !== 1 || objects[0].frameType !== 6 ||
        scene.geometry.meshes.some(mesh => key(mesh.name) === key(choiceMovementName)) || masks.length !== 1 || masks[0].value !== 0 ||
        entry.value.code.replaceAll('\r\n', '\n') !== choiceMovementProgram(choices)) throw new Error('Volba: správce pohybu nebo jeho skupina obsahuje vlastní či neúplný program. Nebude přepsán.');
  } else if (choices.length) throw new Error('Volba: chybí správce zámku pohybu.');
  return { choices, entry };
}

export async function prepareMissionChoice(project, source, geometry, operation) {
  const choice = operation.choice;
  if (!choice || typeof choice !== 'object') throw new Error('Volba: chybí konfigurace.');
  if (operation.dialogue || operation.task || operation.combat || operation.behavior) throw new Error('Volba: vyberte pouze jednu šablonu.');
  const scene = { ...inspectScene(source), geometry }, editing = operation.kind === 'configure-choice';
  const plan = editing ? resolveMissionChoiceEdit(scene, operation.target, choice) : resolveMissionChoice(scene, { ...choice, name: operation.name });
  const hasMovement = scene.actors.some(actor => key(actor.name) === key(choiceMovementName));
  const movement = choice.lockPlayer || hasMovement ? movementState(scene) : null;
  if (choice.lockPlayer && scene.actors.filter(actor => actor.kind === 2).length !== 1) throw new Error('Volba: zámek pohybu potřebuje právě jednoho hráče v misi.');
  const textPath = relativeAssetPath(choice.textDb);
  if (!/^tables\/textdb_[a-z]{2}\.def$/i.test(textPath)) throw new Error('Volba: vyberte jazykový TextDB.');
  const asset = project.asset(textPath), bytes = await project.read(asset.path);
  if (hash(bytes) !== choice.textHash) throw new Error('Volba: texty se od otevření změnily. Otevřete formulář znovu.');
  const entries = parseTextDb(bytes, asset.path).entries.slice(0, -1);
  let textData = bytes;
  if (choice.promptId !== undefined) {
    const matches = entries.filter(entry => entry.id === choice.promptId);
    if (matches.length === 1 && matches[0].text.trim()) {
      if (choice.promptText !== undefined && choice.promptText !== matches[0].text) throw new Error('Volba: existující text pokynu se nepřepisuje. Vyberte volné ID nebo jej upravte v Texty.');
    } else if (!matches.length && typeof choice.promptText === 'string' && choice.promptText.trim() && choice.promptText.length <= 1024) {
      textData = addTextDbEntry(bytes, asset.path, { id: choice.promptId, text: choice.promptText });
    } else throw new Error('Volba: pokyn potřebuje jednoznačný neprázdný text nebo nový text pro volné ID.');
  } else if (choice.promptText !== undefined) throw new Error('Volba: nový text pokynu potřebuje ID.');
  for (const answer of choice.answers) {
    const matches = entries.filter(entry => entry.id === answer.textId);
    if (matches.length !== 1 || !matches[0].text.trim()) throw new Error('Volba: každá odpověď potřebuje jednoznačný existující neprázdný text, nikoli hraniční záznam.');
  }
  const dependencies = [{ path: asset.path, data: textData, expectedHash: choice.textHash }], readDependencies = [];
  let data = source;
  if (editing) {
    for (const controller of plan.controllers) {
      const entry = scene.entries.find(entry => entry.id === controller.scriptId);
      if (entry.value.code.replaceAll('\r\n', '\n') !== controller.code) data = editScene(data, entry.id, { ...entry.value, code: controller.code });
    }
    for (const node of plan.nodes.filter(node => !plan.additions.includes(node))) {
      const entry = scene.entries.find(entry => entry.actorScript && entry.value.name.normalize('NFC').toLowerCase() === node.name.normalize('NFC').toLowerCase());
      if (entry.value.code.replaceAll('\r\n', '\n') !== node.code) data = editScene(data, entry.id, { ...entry.value, code: node.code });
    }
    if (plan.removed.length) {
      // These names are ASCII. Conservatively refuse structural deletion when
      // any other mission or recorded-scene payload still mentions the frame.
      const folder = project.asset(operation.scenePath).path.split('/').slice(0, -1).join('/').toLowerCase();
      const files = project.manifest.assets.filter(asset => asset.path !== project.asset(operation.scenePath).path && (asset.path.toLowerCase().startsWith(folder + '/') || /\.(rep|chg)$/i.test(asset.path)));
      for (const file of files) {
        const original = await project.read(file.path), text = original.toString('latin1').toLowerCase();
        if (plan.removed.some(node => text.includes(node.name.toLowerCase()))) throw new Error(`Volba: na odebíranou odpověď odkazuje ${file.path}. Nejdřív upravte její odkaz.`);
        readDependencies.push({ path: file.path, expectedHash: hash(original) });
      }
      for (const node of plan.removed) data = removeChoiceDetector(data, node.name, node.entry.value.code);
    }
    if (plan.additions.length) {
      const position = sceneWorld(scene, geometry)(plan.current.choice.name).elements.slice(12, 15);
      for (const node of plan.additions) data = changeSceneObject(data, { kind: 'add-detector', ...node, mask: 0, position }, geometry.meshes.map(mesh => mesh.name), geometry.meshes);
    }
  } else {
    data = editScene(source, plan.scriptId, plan.controller);
    for (const node of plan.nodes) data = changeSceneObject(data, { kind: 'add-detector', ...node, mask: 0, position: operation.position }, geometry.meshes.map(mesh => mesh.name), geometry.meshes);
  }
  if (movement || choice.lockPlayer) {
    const nextScene = { ...inspectScene(data), geometry };
    const choices = choiceControllers(nextScene, { includeFull: true }).flatMap(controller => controller.groups.flatMap(group => {
      const recovered = editableMissionChoice(nextScene, group.owner);
      return recovered?.choice.lockPlayer ? [recovered.choice] : [];
    }));
    const code = choiceMovementProgram(choices);
    if (movement?.entry) {
      const entry = nextScene.entries.find(entry => entry.actorScript && key(entry.value.name) === key(choiceMovementName));
      if (entry.value.code.replaceAll('\r\n', '\n') !== code) data = editScene(data, entry.id, { ...entry.value, code });
    } else if (choices.length) {
      const owner = editing ? plan.current.choice.name : operation.name;
      const position = sceneWorld(nextScene, geometry)(owner).elements.slice(12, 15);
      data = changeSceneObject(data, { kind: 'add-detector', name: choiceMovementName, mask: 0, code, position }, geometry.meshes.map(mesh => mesh.name), geometry.meshes);
    }
  }
  return { data, dependencies, readDependencies };
}
