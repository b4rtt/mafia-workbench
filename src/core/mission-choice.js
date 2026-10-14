import { relativeAssetPath } from './dta.js';
import { hash } from './files.js';
import { parseTextDb } from './textdb.js';
import { inspectScene, editScene, changeSceneObject } from './scene.js';
import { resolveMissionChoice } from '../shared/mission-choice.js';

export async function prepareMissionChoice(project, source, geometry, operation) {
  const choice = operation.choice;
  if (!choice || typeof choice !== 'object') throw new Error('Volba: chybí konfigurace.');
  const plan = resolveMissionChoice({ ...inspectScene(source), geometry }, { ...choice, name: operation.name });
  const textPath = relativeAssetPath(choice.textDb);
  if (!/^tables\/textdb_[a-z]{2}\.def$/i.test(textPath)) throw new Error('Volba: vyberte jazykový TextDB.');
  const asset = project.asset(textPath), bytes = await project.read(asset.path);
  if (hash(bytes) !== choice.textHash) throw new Error('Volba: texty se od otevření změnily. Otevřete formulář znovu.');
  const entries = parseTextDb(bytes, asset.path).entries.slice(0, -1);
  for (const answer of choice.answers) {
    const matches = entries.filter(entry => entry.id === answer.textId);
    if (matches.length !== 1 || !matches[0].text.trim()) throw new Error('Volba: každá odpověď potřebuje jednoznačný existující neprázdný text, nikoli hraniční záznam.');
  }
  let data = editScene(source, plan.scriptId, plan.controller);
  for (const node of plan.nodes) data = changeSceneObject(data, { kind: 'add-detector', ...node, mask: 0, position: operation.position }, geometry.meshes.map(mesh => mesh.name), geometry.meshes);
  return { data, dependencies: [{ path: asset.path, data: bytes, expectedHash: choice.textHash }] };
}
