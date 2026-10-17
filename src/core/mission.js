import { inflateRawSync } from 'node:zlib';
import { hash } from './files.js';
import { inspectScene, editScene } from './scene.js';
import { parseFourDs } from './fourds.js';
import { inspectCache } from './cache.js';
import { configureMissionPopulation } from './mission-population.js';
import { missionNamePattern, missionNameHint } from '../shared/mission-name.js';

export const EMPTY_MISSION_SHA256 = '30e85b0f896de45945b445d83fe02a8f8405f832f4764c3cbb449ebe10e85e2e';
const filenames = ['cache.bin', 'car_table.dat', 'check.bin', 'effects.bin', 'road.bin', 'scene.4ds', 'scene2.bin', 'tree.klz'];
// This importer deliberately accepts the supplied, reviewed community template.
// No archive paths are extracted to disk and no template data is bundled with the app.
export function readEmptyMissionZip(source) {
  const bytes = Buffer.from(source);
  if (hash(bytes) !== EMPTY_MISSION_SHA256) throw new Error('Vyberte původní Empty_Mission.zip z odkazu v průvodci. Archiv neodpovídá ověřené šabloně.');
  let end = bytes.length - 22;
  while (end >= Math.max(0, bytes.length - 65557) && bytes.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0 || bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6)) throw new Error('Šablona má neplatný ZIP index.');
  const count = bytes.readUInt16LE(end + 10), result = new Map(); let offset = bytes.readUInt32LE(end + 16);
  for (let i = 0; i < count; i++) {
    if (offset + 46 > end || bytes.readUInt32LE(offset) !== 0x02014b50) throw new Error('Šablona má neplatnou ZIP položku.');
    const flags = bytes.readUInt16LE(offset + 8), method = bytes.readUInt16LE(offset + 10), compressed = bytes.readUInt32LE(offset + 20), size = bytes.readUInt32LE(offset + 24);
    const nameLength = bytes.readUInt16LE(offset + 28), extra = bytes.readUInt16LE(offset + 30), comment = bytes.readUInt16LE(offset + 32), local = bytes.readUInt32LE(offset + 42);
    const name = bytes.subarray(offset + 46, offset + 46 + nameLength).toString('utf8'); offset += 46 + nameLength + extra + comment;
    if (name === 'Empty Mission/') continue;
    const filename = name.replace(/^Empty Mission\//, '');
    if (name !== `Empty Mission/${filename}` || !filenames.includes(filename) || result.has(filename) || flags & 1 || ![0,8].includes(method) || size > 8 * 1024 * 1024 || local + 30 > end || bytes.readUInt32LE(local) !== 0x04034b50) throw new Error('Šablona obsahuje neočekávaná data.');
    const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    if (start + compressed > end) throw new Error('Šablona obsahuje useknutý soubor.');
    const payload = bytes.subarray(start, start + compressed), data = method === 8 ? inflateRawSync(payload, { maxOutputLength: size }) : Buffer.from(payload);
    if (data.length !== size) throw new Error('Šablona má neplatnou velikost souboru.');
    result.set(filename, data);
  }
  if (result.size !== filenames.length) throw new Error('Šablona neobsahuje všech osm souborů mise.');
  return result;
}

const validMissionName = new RegExp('^(?:'+missionNamePattern+')$','v');
export function missionName(value) {
  if (typeof value !== 'string' || !validMissionName.test(value)) throw new Error(missionNameHint);
  return value;
}
export function configureEmptyMission(template, options) {
  missionName(options?.name);
  const { position, heading, model, sun, ambient, initializePolice } = options;
  if (!Array.isArray(position) || position.length !== 3 || position.some(v => typeof v !== 'number' || !Number.isFinite(v) || !Number.isFinite(Math.fround(v))) || typeof heading !== 'number' || !Number.isFinite(heading) || [sun, ambient].some(v => typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 10) || typeof initializePolice !== 'boolean') throw new Error('Neplatné nastavení startu nebo osvětlení mise.');
  if (typeof model !== 'string' || !/^models\/[a-zA-Z0-9_# -]+\.4ds$/i.test(model)) throw new Error('Vyberte model hráče z hlavní složky models.');
  const files = new Map([...template].map(([name, bytes]) => [name, Buffer.from(bytes)]));
  if (files.size !== filenames.length || filenames.some(name => !files.has(name))) throw new Error('Neúplná šablona mise.');
  parseFourDs(files.get('scene.4ds'), true); inspectCache(files.get('cache.bin'));
  const scene = inspectScene(files.get('scene2.bin'));
  const findObject = name => { const matches = scene.objects.filter(o => o.name === name); if (matches.length !== 1) throw new Error(`Šablona nemá jednoznačný objekt ${name}.`); return matches[0]; };
  const changes = [], start = findObject('start'), player = findObject('Tommy');
  const radians = heading % 360 * Math.PI / 180, rotation = [Math.cos(radians / 2), 0, Math.sin(radians / 2), 0];
  // Both actors begin at the requested start transform; the start actor's opaque
  // script/settings stay intact and can still initialise the player as in the template.
  for (const object of [start, player]) for (const [field, value] of [['position', position], ['rotation', rotation]]) {
    if (!object.fields[field]) throw new Error(`Šablona nemá pole ${field} objektu ${object.name}.`);
    changes.push([object.fields[field], value]);
  }
  if (!player.fields.model) throw new Error('Šablona nemá model hráče.');
  changes.push([player.fields.model, model.slice(7).replace(/\.4ds$/i, '.i3d')]);
  for (const [name, value] of [['light_sun', sun], ['light_ambient', ambient]]) {
    const object = findObject(name), matches = scene.entries.filter(e => e.id.startsWith(object.id + '/') && e.label === 'Síla světla');
    if (matches.length !== 1) throw new Error(`Šablona nemá jednoznačné osvětlení ${name}.`);
    changes.push([matches[0].id, value]);
  }
  if (!initializePolice) {
    const scripts = scene.entries.filter(e => e.kind === 'script' && e.value.name === 'GameInitEnd');
    if (scripts.length !== 1) throw new Error('Šablona nemá jednoznačný inicializační skript.');
    changes.push([scripts[0].id, { ...scripts[0].value, code: '' }]);
  }
  let data = files.get('scene2.bin'); for (const [id, value] of changes) data = editScene(data, id, value);
  files.set('scene2.bin', configureMissionPopulation(data, options)); return files;
}
