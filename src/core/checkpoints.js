import fs from 'node:fs/promises';
import path from 'node:path';
import { hash, readSafe, safePath, writeSafe } from './files.js';

const validHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export function checkpointFile(slot) {
  if (!Number.isSafeInteger(slot) || slot < 0 || slot > 599) throw new Error('Neplatný slot checkpointu.');
  return `savegame/mafia000.${String(slot).padStart(3, '0')}`;
}
// G_Stream decrypts each Read block separately; unaligned tail bytes are plain.
// This reader deliberately does not interpret or rewrite opaque actor state.
export function inspectCheckpoint(source) {
  const bytes = Buffer.from(source);
  if (bytes.length < 344 || bytes.length > 64 * 1024 * 1024 || bytes.readUInt32LE(0) !== 0x53617647 || bytes.readUInt32LE(8) !== 1) throw new Error('Checkpoint: neplatný stream.');
  let at = 24, first = 0x23101976, second = 0x10072002;
  const read = size => {
    if (!Number.isSafeInteger(size) || size < 0 || size > bytes.length - at) throw new Error('Checkpoint: blok je mimo soubor.');
    const block = Buffer.from(bytes.subarray(at, at + size)); at += size;
    for (let offset = 0; offset + 4 <= size; offset += 4) {
      const value = (block.readUInt32LE(offset) ^ first) >>> 0;
      block.writeUInt32LE(value, offset); second = (second + value) >>> 0; first = (first + second) >>> 0;
    }
    return block;
  };
  const head = read(24), state = read(32), meta = read(264), slot = head.readUInt32LE(8), id = head.readUInt32LE(20);
  checkpointFile(slot);
  if (head.readUInt32LE(0) !== 0x47766153 || head.readUInt32LE(4) !== 16 || state.readUInt32LE(0) !== slot || id !== slot + 5000) throw new Error('Checkpoint: nepodporovaná hlavička.');
  const end = meta.subarray(0, 32).indexOf(0);
  if (end < 1) throw new Error('Checkpoint: chybí jméno mise.');
  const mission = meta.toString('ascii', 0, end), energy = state.readUInt32LE(16), gameSize = meta.readUInt32LE(32);
  if (!meta.subarray(0, end).equals(Buffer.from('wbtest')) || !gameSize) throw new Error('Checkpoint: nejde o úplný save testovací mise.');
  read(gameSize);
  for (const offset of [240, 244]) read(meta.readUInt32LE(offset));
  let actors = 0, player = false;
  while (at < bytes.length) {
    if (++actors > 100000) throw new Error('Checkpoint: příliš mnoho aktérů.');
    const actor = read(140), size = actor.readUInt32LE(132);
    if (actor.readUInt32LE(128) === 2 && actor.subarray(0, 6).equals(Buffer.from('Tommy\0'))) player = true;
    read(size);
  }
  if (!player) throw new Error('Checkpoint: chybí uložený hráč.');
  return { slot, id, mission, energy, actors };
}
export function playtestRevision(level, files) {
  const rows = Object.entries(files).map(([name, value]) => {
    if (!validHash(value.applied)) throw new Error('Checkpoint: neplatná revize souboru.');
    return [name, value.applied];
  }).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  return hash(Buffer.from(JSON.stringify([level.toLowerCase(), rows])));
}
export const projectCheckpointState = project => hash(Buffer.from(JSON.stringify([project.manifest.assets, project.manifest.history])));
export async function checkpointInventory(game) {
  let names;
  try { names = await fs.readdir(path.dirname(await safePath(game, 'savegame/mafia000.000'))); }
  catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
  const result = {};
  for (const name of names) {
    const match = /^mafia000\.(\d{3})$/.exec(name);
    if (!match || Number(match[1]) > 599) continue;
    const filename = checkpointFile(Number(match[1])), stat = await fs.stat(await safePath(game, filename));
    if (stat.size > 64 * 1024 * 1024) throw new Error('Checkpoint: soubor je příliš velký.');
    const bytes = await readSafe(game, filename);
    result[Number(match[1])] = { sha256: hash(bytes), bytes };
  }
  return result;
}
async function index(root) {
  let value;
  try { value = JSON.parse((await readSafe(root, 'checkpoints.json')).toString()); }
  catch (error) { if (error.code === 'ENOENT') return { format: 'mafia-workbench-checkpoints', version: 1, saves: {} }; throw error; }
  if (value.format !== 'mafia-workbench-checkpoints' || value.version !== 1 || !value.saves || typeof value.saves !== 'object' || Array.isArray(value.saves)) throw new Error('Neplatný index checkpointů.');
  return value;
}
export async function collectCheckpoints(root, game, context) {
  if (!context) return; // Older attached sessions have no trustworthy provenance.
  if (!validHash(context.revision) || !validHash(context.projectState) || typeof context.level !== 'string' || !context.baseline) throw new Error('Neplatná evidence testovacího běhu.');
  const saved = await index(root), inventory = await checkpointInventory(game);
  for (const [slot, file] of Object.entries(inventory)) {
    if (context.baseline[slot] === file.sha256) continue;
    let metadata;
    try { metadata = inspectCheckpoint(file.bytes); } catch { continue; } // Incomplete/quick saves are not full checkpoints.
    if (metadata.slot !== Number(slot)) continue;
    saved.saves[slot] = { ...metadata, sha256: file.sha256, level: context.level, revision: context.revision, projectState: context.projectState, recorded: new Date().toISOString() };
  }
  await writeSafe(root, 'checkpoints.json', JSON.stringify(saved));
}
export async function availableCheckpoints(root, game, project, level) {
  const saved = await index(root), inventory = await checkpointInventory(game), current = projectCheckpointState(project), result = [];
  for (const [slot, record] of Object.entries(saved.saves)) {
    if (record.slot !== Number(slot) || !validHash(record.sha256) || !validHash(record.revision) || record.level?.toLowerCase() !== level.toLowerCase() || inventory[slot]?.sha256 !== record.sha256) continue;
    const metadata = inspectCheckpoint(inventory[slot].bytes);
    if (metadata.slot !== record.slot) continue;
    result.push({ ...metadata, sha256: record.sha256, revision: record.revision, recorded: record.recorded, compatible: record.projectState === current });
  }
  return result.sort((a, b) => b.slot - a.slot);
}
