import { hash } from './files.js';
import { inspectScene } from './scene.js';
import { humanAttackTargets, humanBehaviorScript, humanWeapons, validateHumanRoute, resolveHumanPatrol } from '../shared/human-behavior.js';
import { parseNavigation } from './navigation.js';
import { parseRoads } from './roads.js';
import { resolveHumanDriving } from '../shared/human-driving.js';
import { resolveHumanFollowing } from '../shared/human-following.js';

export async function prepareHumanBehavior(project, before, geometry, operation, scenePath) {
  const scene = { ...inspectScene(before), geometry }, owner = operation.kind === 'configure-human' ? operation.target : operation.name;
  const entries = scene.entries.filter(entry => entry.actorScript && entry.actorKind === 27 && entry.value.name.normalize('NFC').toLowerCase() === owner?.normalize('NFC').toLowerCase());
  if (operation.kind === 'configure-human' && (entries.length !== 1 || !scene.actors.some(actor => actor.kind === 27 && actor.name === entries[0].value.name) || !humanAttackTargets(scene, '').some(actor => actor.name === entries[0].value.name))) throw new Error('Postava: vyberte jednoznačnou NPC s podporovaným programem.');
  const name = operation.kind === 'configure-human' ? entries[0].value.name : owner;
  let options = operation.behavior;
  humanBehaviorScript(name, options);
  const dependencies = [];
  if (options.mode === 'follow') options = resolveHumanFollowing(scene, name, options);
  if (options.mode === 'drive') {
    const asset=project.asset(scenePath.replace(/scene2\.bin$/i,'road.bin')),data=await project.read(asset.path);
    if(options.roadHash!==hash(data))throw new Error('Jízda: silniční síť se od otevření změnila. Otevřete dialog znovu.');
    options=resolveHumanDriving(scene,name,options,parseRoads(data));
    dependencies.push({path:asset.path,data,expectedHash:options.roadHash});
  }
  if (options.mode === 'patrol') {
    options = resolveHumanPatrol(scene, name, options);
    const navigationName = scenePath.replace(/scene2\.bin$/i, 'check.bin'), asset = project.asset(navigationName), data = await project.read(asset.path);
    if (options.navigationHash !== hash(data)) throw new Error('Trasa: navigace se od otevření změnila. Otevřete dialog znovu.');
    validateHumanRoute(options, parseNavigation(data));
    dependencies.push({ path: asset.path, data, expectedHash: options.navigationHash });
  }
  if (options.mode === 'attack') {
    const target = humanAttackTargets(scene, name).find(actor => actor.name.normalize('NFC').toLowerCase() === options.targetName.normalize('NFC').toLowerCase());
    if (!target) throw new Error('Postava: cíl musí být jednoznačný lidský aktér této mise.');
    const catalog = await project.pickupItems();
    if (options.tableHash !== catalog.sha256) throw new Error('Postava: tabulka zbraní se od otevření změnila. Otevřete dialog znovu.');
    const item = humanWeapons(catalog).find(item => item.itemId === options.itemId);
    if (!item || options.clip > item.clip) throw new Error('Postava: vyberte dostupnou střelnou zbraň a munici nejvýše do kapacity zásobníku.');
    if (options.modelHash !== item.modelHash) throw new Error('Postava: model zbraně se od otevření změnil. Otevřete dialog znovu.');
    for (const path of ['tables/predmety.def', item.model]) {
      const asset = project.asset(path), data = await project.read(asset.path);
      const expectedHash = path === item.model ? item.modelHash : catalog.sha256;
      if (hash(data) !== expectedHash) throw new Error('Postava: výzbroj se během přípravy změnila. Otevřete dialog znovu.');
      dependencies.push({ path: asset.path, data, expectedHash });
    }
    options = { ...options, targetName: target.name };
  }
  return { code: humanBehaviorScript(name, options), entry: entries[0], dependencies };
}
