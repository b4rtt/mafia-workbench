import { relativeAssetPath } from './dta.js';
import { hash } from './files.js';
import { parseTextDb } from './textdb.js';
import { inspectScene, editScene, changeSceneObject, removeChoiceDetector } from './scene.js';
import { sceneWorld } from './model-collision.js';
import { resolveMissionChoice, resolveMissionChoiceEdit } from '../shared/mission-choice.js';

export async function prepareMissionChoice(project, source, geometry, operation) {
  const choice = operation.choice;
  if (!choice || typeof choice !== 'object') throw new Error('Volba: chybí konfigurace.');
  if (operation.dialogue || operation.task || operation.combat || operation.behavior) throw new Error('Volba: vyberte pouze jednu šablonu.');
  const scene = { ...inspectScene(source), geometry }, editing = operation.kind === 'configure-choice';
  const plan = editing ? resolveMissionChoiceEdit(scene, operation.target, choice) : resolveMissionChoice(scene, { ...choice, name: operation.name });
  const textPath = relativeAssetPath(choice.textDb);
  if (!/^tables\/textdb_[a-z]{2}\.def$/i.test(textPath)) throw new Error('Volba: vyberte jazykový TextDB.');
  const asset = project.asset(textPath), bytes = await project.read(asset.path);
  if (hash(bytes) !== choice.textHash) throw new Error('Volba: texty se od otevření změnily. Otevřete formulář znovu.');
  const entries = parseTextDb(bytes, asset.path).entries.slice(0, -1);
  for (const answer of choice.answers) {
    const matches = entries.filter(entry => entry.id === answer.textId);
    if (matches.length !== 1 || !matches[0].text.trim()) throw new Error('Volba: každá odpověď potřebuje jednoznačný existující neprázdný text, nikoli hraniční záznam.');
  }
  const dependencies = [{ path: asset.path, data: bytes, expectedHash: choice.textHash }], readDependencies = [];
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
  return { data, dependencies, readDependencies };
}
