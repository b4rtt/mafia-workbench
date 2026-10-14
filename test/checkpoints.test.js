import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { hash, writeSafe } from '../src/core/files.js';
import { availableCheckpoints, checkpointFile, checkpointInventory, collectCheckpoints, inspectCheckpoint, playtestRevision, projectCheckpointState } from '../src/core/checkpoints.js';
import { Playtest, patchDirectLevelExe } from '../src/core/playtest.js';

function save({ slot = 42, id = slot + 5000, energy = 21, mission = 'wbtest', player = true, gameSize = 3, version = 16 } = {}) {
  const outer = Buffer.alloc(24); outer.writeUInt32LE(0x53617647); outer.writeUInt32LE(1, 8);
  const head = Buffer.alloc(24); head.write('SavG'); head.writeUInt32LE(version, 4); head.writeUInt32LE(slot, 8); head.writeUInt32LE(id, 20);
  const state = Buffer.alloc(32); state.writeUInt32LE(slot); state.writeUInt32LE(energy, 16);
  const meta = Buffer.alloc(264); meta.write(mission); meta.writeUInt32LE(gameSize, 32); meta.writeUInt32LE(5, 240); meta.writeUInt32LE(2, 244);
  const actor = Buffer.alloc(140); actor.write(player ? 'Tommy' : 'Other'); actor.writeUInt32LE(2, 128); actor.writeUInt32LE(9, 132);
  const detector = Buffer.alloc(140); detector.writeUInt32LE(5, 128); detector.writeUInt32LE(7, 132);
  let first = 0x23101976, second = 0x10072002;
  const encrypted = [head, state, meta, Buffer.alloc(gameSize, 0x41), Buffer.alloc(5, 0x42), Buffer.alloc(2, 0x43), actor, Buffer.alloc(9, 0x44), detector, Buffer.alloc(7, 0x45)].map(plain => {
    const block = Buffer.from(plain);
    for (let at = 0; at + 4 <= block.length; at += 4) {
      const value = plain.readUInt32LE(at); block.writeUInt32LE((value ^ first) >>> 0, at); second = (second + value) >>> 0; first = (first + second) >>> 0;
    }
    return block;
  });
  return Buffer.concat([outer, ...encrypted]);
}
test('full checkpoint reader follows encrypted block boundaries and preserves all input', () => {
  const bytes = save(), before = Buffer.from(bytes);
  assert.deepEqual(inspectCheckpoint(bytes), { slot: 42, id: 5042, mission: 'wbtest', energy: 21, actors: 2 });
  assert.deepEqual(bytes, before);
  for (const options of [{ slot: 600 }, { id: 5999 }, { mission: 'tutorial' }, { player: false }, { gameSize: 0 }, { version: 15 }]) assert.throws(() => inspectCheckpoint(save(options)), /Checkpoint|slot/);
  for (const length of [0, 24, 344, bytes.length - 1]) assert.throws(() => inspectCheckpoint(bytes.subarray(0, length)));
  assert.throws(() => inspectCheckpoint(Buffer.concat([bytes, Buffer.from([1])])), /mimo soubor/);
  for (const slot of [-1, 600, 0.5, NaN, '42']) {
    assert.throws(() => checkpointFile(slot)); assert.throws(() => patchDirectLevelExe(Buffer.alloc(20), slot), /slot/);
  }
});
test('only new full saves from the owned run gain provenance; project changes and save replacement block loading', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mafia-checkpoints-')), game = path.join(root, 'game'); await fs.mkdir(game);
  try {
    const project = { root, manifest: { assets: [{ path: 'models/a.4ds', sha256: hash(Buffer.from('model')) }], history: [] } }, level = 'missions/CUSTOM';
    const files = { 'models/a.4ds': { applied: hash(Buffer.from('model')) }, 'missions/custom/scene2.bin': { applied: hash(Buffer.from('scene')) } };
    const revision = playtestRevision(level, files);
    assert.equal(playtestRevision(level.toLowerCase(), Object.fromEntries(Object.entries(files).reverse())), revision);
    assert.notEqual(playtestRevision(level, { ...files, extra: { applied: hash(Buffer.from('extra')) } }), revision);
    assert.throws(() => playtestRevision(level, { invalid: { applied: '../escape' } }));
    await writeSafe(game, checkpointFile(42), save());
    const original = await checkpointInventory(game), context = { level, revision, projectState: projectCheckpointState(project), baseline: { 42: original[42].sha256 } };
    await collectCheckpoints(root, game, context);
    assert.deepEqual(await availableCheckpoints(root, game, project, level), []);
    await writeSafe(game, checkpointFile(42), save({ energy: 61 }));
    await writeSafe(game, checkpointFile(43), save({ slot: 43, gameSize: 0 })); // light/incomplete saves are not selectable
    await collectCheckpoints(root, game, context);
    const [record] = await availableCheckpoints(root, game, project, level);
    assert.equal(record.slot, 42); assert.equal(record.energy, 61); assert.equal(record.compatible, true); assert.equal(record.revision, revision);
    assert.deepEqual(await availableCheckpoints(root, game, project, 'missions/OTHER'), []);
    project.manifest.history.push({ change: 'scene' });
    assert.equal((await availableCheckpoints(root, game, project, level))[0].compatible, false);
    project.manifest.history.pop(); assert.equal((await availableCheckpoints(root, game, project, level))[0].compatible, true);
    await writeSafe(game, checkpointFile(42), save({ energy: 71 }));
    assert.deepEqual(await availableCheckpoints(root, game, project, level), []);
    await fs.unlink(path.join(game, checkpointFile(42))); await fs.symlink(path.join(game, checkpointFile(43)), path.join(game, checkpointFile(42)));
    await assert.rejects(checkpointInventory(game), /odkaz/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
test('checkpoint launch rejects unknown or changed saves before preparing game data', { skip: process.platform !== 'darwin' }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mafia-checkpoint-reject-'));
  try {
    const project = { root, manifest: { gameRoot: root, assets: [], history: [] } }, playtest = new Playtest({});
    assert.deepEqual(await playtest.checkpoints(project, 'missions/CUSTOM/scene2.bin'), []);
    await assert.rejects(playtest.prepare(project, 'missions/CUSTOM/scene2.bin', () => {}, { slot: 42, sha256: hash(save()) }), /aktuální verzi/);
    await assert.rejects(fs.access(path.join(root, 'playtest')));
    await assert.rejects(playtest.prepare(project, 'missions/CUSTOM/scene2.bin', () => {}, { slot: '../escape', sha256: hash(save()) }), /slot/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
test('reattached playtest records new checkpoints on stop and clears a stopped session even if its index is invalid', { skip: process.platform === 'win32' }, async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mafia-checkpoint-attach-')), root = path.join(projectRoot, 'playtest'), game = path.join(root, 'game');
  try {
    await fs.mkdir(game, { recursive: true });
    const project = { root: projectRoot, manifest: { assets: [], history: [] } }, level = 'missions/CUSTOM', context = { baseline: {}, level, revision: playtestRevision(level, {}), projectState: projectCheckpointState(project) };
    const server = path.join(projectRoot, 'server'); await fs.writeFile(server, '#!/bin/sh\nexit 0\n', { mode: 0o700 }); // own stand-in; never terminates the test runner
    await writeSafe(game, checkpointFile(42), save());
    await writeSafe(root, 'snapshot.json', JSON.stringify({ format: 'mafia-workbench-playtest', project: projectRoot, level }));
    const running = () => writeSafe(root, 'run.json', JSON.stringify({ pid: process.pid, exited: false, checkpoints: context }));
    await running(); const test = new Playtest({ server });
    assert.equal((await test.attach(project)).running, true); assert.equal((await test.stop()).running, false);
    assert.equal((await test.checkpoints(project, level + '/scene2.bin'))[0].compatible, true);
    await writeSafe(root, 'checkpoints.json', JSON.stringify({ format: 'invalid' })); await running(); await test.attach(project);
    await assert.rejects(test.stop(), /index checkpointů/); assert.equal(test.state().running, false);
    assert.equal(JSON.parse(await fs.readFile(root + '/run.json', 'utf8')).exited, true);
  } finally { await fs.rm(projectRoot, { recursive: true, force: true }); }
});
