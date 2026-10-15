import { relativeAssetPath } from './dta.js';
import { hash } from './files.js';
import { inspectScene } from './scene.js';
import { parseFourDs } from './fourds.js';
import { parseCollision } from './collision.js';
import { parseTextDb } from './textdb.js';
import { parseItems } from './items.js';
import { dialogueSoundPath } from './dialogue-audio.js';
import { dialogueSpeakers, dialogueInteractionHumans } from '../shared/mission-dialogue.js';
import { missionTaskVehicles, resolveMissionTaskEscort } from '../shared/mission-task.js';
import { resolveMissionBranch } from '../shared/mission-branch.js';
import { resolveMissionCoordination } from '../shared/mission-coordination.js';
import { missionLogic } from '../shared/mission-logic.js';
import { validateHumanRoute, resolveHumanAttack, humanWeapons } from '../shared/human-behavior.js';
import { resolveHumanFollowing } from '../shared/human-following.js';
import { parseNavigation } from './navigation.js';
import { resolveHumanDriving } from '../shared/human-driving.js';
import { parseRoads } from './roads.js';

const key = name => name.replaceAll('\\', '/').normalize('NFC').toLowerCase();

// A saved-data check, not an LS3D interpreter. Only exact editor recipes expose
// script dependencies; arbitrary programs and their execution remain unknown.
export async function checkMission(project, name, textDb = null) {
  const match = /^missions\/([^/]+)\/[^/]+$/i.exec(relativeAssetPath(name));
  if (!match) throw new Error('Vyberte soubor konkrétní mise.');
  if (project.busy) throw new Error('Probíhá ukládání projektu.');
  const revision = JSON.stringify(project.manifest), assets = new Map(project.manifest.assets.map(asset => [key(asset.path), asset]));
  const languages = project.manifest.assets.filter(asset => /^tables\/textdb_[a-z]{2}\.def$/i.test(asset.path)).map(asset => asset.path).sort();
  if (textDb !== null && !languages.some(path => key(path) === key(textDb))) throw new Error('Vyberte jazykový TextDB tohoto projektu.');
  textDb = textDb === null ? languages.find(path => /textdb_cz\.def$/i.test(path)) ?? languages[0] ?? null : assets.get(key(textDb)).path;
  const folder = `missions/${match[1]}`, issues = [], reads = new Map();
  function issue(severity, code, message, location = {}) { issues.push({ severity, code, message, ...location }); }
  async function read(path) {
    const asset = assets.get(key(path));
    if (!asset) throw new Error(`Soubor chybí: ${path}`);
    if (!reads.has(key(path))) reads.set(key(path), { path: asset.path, data: await project.read(asset.path) });
    return reads.get(key(path));
  }
  async function parsed(path, parser, location = {}, code = 'file') {
    try { const file = await read(path); return parser(file.data, file.path); }
    catch (error) { issue('error', code, error.message, { path: assets.get(key(path))?.path ?? path, ...location }); return null; }
  }
  const scenePath = assets.get(key(`${folder}/scene2.bin`))?.path ?? `${folder}/scene2.bin`;
  const rawScene = await parsed(scenePath, inspectScene);
  const geometry = await parsed(`${folder}/scene.4ds`, bytes => parseFourDs(bytes, true));
  await parsed(`${folder}/tree.klz`, parseCollision);
  const models = new Set(), textures = new Set();
  async function materialFiles(model, modelPath) {
    const references = new Map();
    for (const [index, material] of model.materials.entries()) {
      for (const field of ['texture', 'alphaTexture', 'environmentTexture']) if (material[field]) {
        const name = material[field], uses = references.get(key(name)) ?? { name, materials: [] };
        uses.materials.push(index + 1); references.set(key(name), uses);
      }
    }
    for (const { name, materials } of references.values()) {
      try {
        const safe = relativeAssetPath(name), path = /^maps\//i.test(safe) ? safe : `maps/${safe}`;
        textures.add(key(path)); await read(path);
      } catch (error) { issue('error', 'texture', `Textura ${name} · materiály ${[...new Set(materials)].join(', ')}: ${error.message}`, { path: modelPath }); }
    }
    if (model.materials.some(material => material.flags & 0x04000000)) issue('info', 'texture-animation', 'Animované textury: kontrola zahrnuje pouze uložený základní název, další snímky sekvence se nekontrolují.', { path: modelPath });
  }
  if (geometry) await materialFiles(geometry, assets.get(key(`${folder}/scene.4ds`)).path);
  if (rawScene) {
    const references = new Map();
    for (const object of rawScene.objects) if (object.frameType === 9 && object.model) {
      const uses = references.get(key(object.model)) ?? { name: object.model, objects: [] };
      uses.objects.push(object.name); references.set(key(object.model), uses);
    }
    for (const { name, objects } of references.values()) {
      try {
        const safe = relativeAssetPath(name.replace(/\.(?:i3d|4ds)$/i, '.4ds'));
        if (!/\.4ds$/i.test(safe)) throw new Error('Odkaz nemá podporovanou příponu I3D/4DS.');
        const path = /^models\//i.test(safe) ? safe : `models/${safe}`;
        models.add(key(path)); const file = await read(path), model = parseFourDs(file.data);
        await materialFiles(model, file.path);
      } catch (error) { issue('error', 'model', `Model ${name} · objekty ${objects.slice(0, 8).join(', ')}${objects.length > 8 ? ` a dalších ${objects.length - 8}` : ''}: ${error.message}`, { path: scenePath, object: objects[0] }); }
    }
  }
  let recipes = 0, custom = 0, textReferences = 0, voices = 0;
  if (rawScene && geometry) {
    const scene = { ...rawScene, geometry }, speakers = dialogueSpeakers(scene), graph = missionLogic(scene);
    if (speakers.filter(actor => actor.kind === 2 && key(actor.name) === 'tommy').length !== 1) issue('error', 'player', 'Chybí jednoznačný hráč Tommy typu Player s vazbou na frame.', { path: scenePath });
    const references = new Map(), voiceReferences = new Map();
    function text(id, node, spoken = false) {
      if (id === null || id === undefined) return;
      const location = { path: scenePath, entryId: node.entryId, object: node.name };
      if (!references.has(id)) references.set(id, []);
      references.get(id).push(location);
      if (spoken) { if (!voiceReferences.has(id)) voiceReferences.set(id, []); voiceReferences.get(id).push(location); }
    }
    for (const node of graph.nodes) {
      const location = { path: scenePath, entryId: node.entryId, object: node.name }, recipe = node.recipe;
      for (const message of node.warnings) {
        const origin = node.kind === 'unresolved' ? graph.nodes.find(source => source.entryId && graph.edges.some(edge => ['signal', 'read'].includes(edge.kind) ? edge.from === node.id && edge.to === source.id : edge.from === source.id && edge.to === node.id)) : node;
        issue(node.kind === 'unresolved' ? 'error' : 'warning', 'flow', `${node.name}: ${message}`, { ...location, entryId: origin?.entryId });
      }
      if (node.kind === 'custom') { custom++; continue; }
      if (!recipe) continue;
      recipes++;
      if (node.kind === 'coordination') {
        try { resolveMissionCoordination(scene, recipe, node.name); } catch (error) { issue('error', 'coordination', `${node.name}: ${error.message}`, location); }
        continue;
      }
      if (node.kind === 'branch') {
        try { resolveMissionBranch(scene, recipe, node.name); } catch (error) { issue('error', 'branch', `${node.name}: ${error.message}`, location); }
        const itemConditions = recipe.conditions.filter(condition => condition.kind === 'item');
        if (itemConditions.length) {
          const items = await parsed('tables/predmety.def', parseItems, location, 'inventory');
          if (items) for (const condition of itemConditions) if (!items.records[condition.itemId]?.name.trim()) issue('error', 'inventory', `${node.name}: předmět ID ${condition.itemId} nemá pojmenovanou definici.`, location);
        }
        continue;
      }
      if (node.kind === 'attack') {
        try { resolveHumanAttack(scene, node.name, recipe); } catch (error) { issue('error', 'npc-attack', `${node.name}: ${error.message}`, location); }
        const items = await parsed('tables/predmety.def', parseItems, location, 'npc-weapon');
        if (items) {
          const item = humanWeapons({ items: items.records.filter(item => item.name.trim()).map(item => ({ ...item, itemId: item.index, clip: item.magazine })) }).find(item => item.itemId === recipe.itemId);
          if (!item || recipe.clip > item.clip) issue('error', 'npc-weapon', `${node.name}: zbraň ID ${recipe.itemId} není dostupná střelná zbraň nebo zásobník přesahuje kapacitu.`, location);
          else {
            try {
              const path = relativeAssetPath(item.model.replace(/\.(?:i3d|4ds)$/i, '.4ds'));
              const model = await read(/^models\//i.test(path) ? path : `models/${path}`); models.add(key(model.path)); await materialFiles(parseFourDs(model.data), model.path);
            } catch (error) { issue('error', 'npc-weapon', `${node.name}: model zbraně: ${error.message}`, location); }
          }
        }
        continue;
      }
      if (node.kind === 'patrol') {
        const navigation = await parsed(`${folder}/check.bin`, parseNavigation, location, 'npc-route');
        if (navigation) try { validateHumanRoute(recipe, navigation); } catch (error) { issue('error', 'npc-route', `${node.name}: ${error.message}`, location); }
        continue;
      }
      if (node.kind === 'follow') {
        try { resolveHumanFollowing(scene, node.name, recipe); } catch (error) { issue('error', 'npc-follow', `${node.name}: ${error.message}`, location); }
        continue;
      }
      if (node.kind === 'drive') {
        const roads = await parsed(`${folder}/road.bin`, parseRoads, location, 'npc-drive');
        if (roads) try { resolveHumanDriving(scene, node.name, recipe, roads); } catch (error) { issue('error', 'npc-drive', `${node.name}: ${error.message}`, location); }
        continue;
      }
      for (const field of ['objectiveId', 'interactionId', 'nextObjectiveId', 'completeId', 'checkpointId', 'promptId']) text(recipe[field], node);
      text(recipe.failure?.textId, node);
      for (const answer of recipe.answers ?? []) text(answer.textId, node);
      for (const line of recipe.lines ?? []) {
        text(line.textId, node, true);
        for (const participant of [line.speaker, ...(recipe.camera ? [line.listener] : [])]) if (!speakers.some(actor => key(actor.name) === key(participant))) issue('error', 'speaker', `${node.name}: postava ${participant} nemá jednoznačnou lidskou vazbu.`, location);
      }
      if (recipe.interactionHuman && !dialogueInteractionHumans(scene).some(actor => key(actor.name) === key(recipe.interactionHuman))) issue('error', 'interaction', `${node.name}: akce nemá jednoznačnou NPC ${recipe.interactionHuman}.`, location);
      if ((recipe.lockPlayer || recipe.inventory || recipe.interruptOnDeath) && !speakers.some(actor => actor.kind === 2 && key(actor.name) === 'tommy')) issue('error', 'player', `${node.name}: zámek, inventář nebo kontrola života potřebuje hráče Tommy typu Player.`, location);
      if (recipe.failure?.humanName && !speakers.some(actor => key(actor.name) === key(recipe.failure.humanName))) issue('error', 'human', `${node.name}: hlídaná postava ${recipe.failure.humanName} chybí nebo není jednoznačná.`, location);
      for (const target of recipe.targets ?? []) if (!speakers.some(actor => actor.kind === 27 && key(actor.name) === key(target))) issue('error', 'human', `${node.name}: protivník ${target} chybí nebo není jednoznačná NPC.`, location);
      if (recipe.targetName) {
        const frames = [...scene.objects, ...geometry.meshes].filter(frame => key(frame.name) === key(recipe.targetName));
        if (frames.length !== 1 || key(recipe.targetName) === 'tommy') issue('error', 'target', `${node.name}: cílový objekt ${recipe.targetName} chybí nebo není jednoznačný cíl odlišný od hráče.`, location);
      }
      if (recipe.escort) try { resolveMissionTaskEscort(scene, recipe); } catch (error) { issue('error', 'escort', `${node.name}: ${error.message}`, location); }
      if (recipe.vehicle && !missionTaskVehicles(scene).some(actor => key(actor.name) === key(recipe.vehicle.name))) issue('error', 'vehicle', `${node.name}: auto ${recipe.vehicle.name} nemá jednoznačného aktéra vozidla a model.`, location);
      if (recipe.inventory) {
        const items = await parsed('tables/predmety.def', parseItems, location, 'inventory');
        if (items && !items.records[recipe.inventory.itemId]?.name.trim()) issue('error', 'inventory', `${node.name}: předmět ID ${recipe.inventory.itemId} nemá pojmenovanou definici.`, location);
      }
      if (recipe.nextMission) {
        const destination = `missions/${recipe.nextMission}`;
        if (key(destination) === key(folder)) issue('error', 'destination', `${node.name}: přechod míří do stejné mise.`, location);
        const nextScene = await parsed(`${destination}/scene2.bin`, inspectScene, location, 'destination');
        const nextGeometry = await parsed(`${destination}/scene.4ds`, bytes => parseFourDs(bytes, true), location, 'destination');
        await parsed(`${destination}/tree.klz`, parseCollision, location, 'destination');
        if (nextScene && nextGeometry && !dialogueSpeakers({ ...nextScene, geometry: nextGeometry }).some(actor => actor.kind === 2 && key(actor.name) === 'tommy')) issue('error', 'destination', `${node.name}: další mise ${recipe.nextMission} nemá jednoznačného hráče Tommy.`, location);
      }
    }
    textReferences = references.size; voices = voiceReferences.size;
    if (references.size) {
      const texts = textDb ? await parsed(textDb, parseTextDb) : null;
      if (!textDb) issue('error', 'texts', 'Projekt nemá jazykový TextDB pro texty rozpoznaných šablon.', { path: scenePath });
      const byId = new Map();
      for (const entry of texts?.entries.slice(0, -1) ?? []) byId.set(entry.id, [...(byId.get(entry.id) ?? []), entry]);
      if (texts) for (const [id, uses] of references) {
        const matches = byId.get(id) ?? [];
        if (matches.length !== 1) issue('error', 'text-id', `Text ID ${id} v ${textDb} ${matches.length ? 'není jednoznačný' : 'chybí nebo je pouze hraničním záznamem'}. Používá: ${[...new Set(uses.map(use => use.object))].join(', ')}.`, { path: textDb, textId: id });
        else if (!matches[0].text.trim()) issue('warning', 'text-empty', `Text ID ${id} je prázdný. Používá: ${[...new Set(uses.map(use => use.object))].join(', ')}.`, { path: textDb, textId: id });
      }
    }
    for (const [id, uses] of voiceReferences) {
      try {
        const file = await read(dialogueSoundPath(id)), bytes = file.data;
        if (bytes.length < 44 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') throw new Error(`Dabing ${id} nemá WAV hlavičku.`);
      } catch (error) { issue('error', 'voice', `${error.message} Používá: ${[...new Set(uses.map(use => use.object))].join(', ')}.`, uses[0]); }
    }
    if (custom) issue('info', 'custom', `${custom} vlastních skriptů není analyzováno. Mohou přidávat aktivace, návaznosti a další závislosti.`, { path: scenePath });
  } else issue('info', 'incomplete', 'Vazby a šablony nelze prověřit bez čitelné scény a geometrie.', { path: scenePath });
  // Reject mixed revisions, including an externally changed overlay, instead of
  // presenting a successful check of files that never existed together.
  for (const file of reads.values()) if (hash(await project.read(file.path)) !== hash(file.data)) throw new Error('Data se během kontroly změnila. Spusťte kontrolu znovu.');
  if (project.busy || JSON.stringify(project.manifest) !== revision) throw new Error('Projekt se během kontroly změnil. Spusťte kontrolu znovu.');
  return { name: match[1], path: scenePath, textDb, languages, recipes, custom, textReferences, voices, models: models.size, textures: textures.size, issues,
    files: [...reads.values()].map(file => ({ path: file.path, sha256: hash(file.data) })) };
}
