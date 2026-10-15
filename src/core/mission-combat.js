import { relativeAssetPath } from './dta.js';
import { hash } from './files.js';
import { parseTextDb } from './textdb.js';
import { inspectScene } from './scene.js';
import { resolveMissionCombat, missionCombatScript } from '../shared/mission-combat.js';

export async function prepareMissionCombat(project, source, geometry, operation) {
  const combat = resolveMissionCombat({ ...inspectScene(source), geometry }, operation.combat, operation.name);
  const textPath = relativeAssetPath(combat.textDb);
  if (!/^tables\/textdb_[a-z]{2}\.def$/i.test(textPath)) throw new Error('Bojový úkol: vyberte jazykový TextDB.');
  const asset = project.asset(textPath), bytes = await project.read(asset.path);
  if (hash(bytes) !== combat.textHash) throw new Error('Bojový úkol: texty se od otevření změnily. Otevřete formulář znovu.');
  const entries = parseTextDb(bytes, asset.path).entries.slice(0, -1);
  const ids = [combat.objectiveId, combat.completeId, ...((combat.trigger ?? 'use') === 'use' ? [combat.interactionId] : []), ...(combat.failure ? [combat.failure.textId] : []), ...(combat.checkpointId != null ? [combat.checkpointId] : [])];
  for (const id of ids) {
    const matches = entries.filter(entry => entry.id === id);
    if (matches.length !== 1 || !matches[0].text.trim()) throw new Error('Bojový úkol: každé ID potřebuje jednoznačný existující neprázdný text, nikoli hraniční záznam.');
  }
  return { code: missionCombatScript(combat), dependencies: [{ path: asset.path, data: bytes, expectedHash: combat.textHash }] };
}
