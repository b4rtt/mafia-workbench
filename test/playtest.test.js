import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Playtest, missionFolder, patchDirectLevelExe, synchronizeAssets, wineStartupError } from '../src/core/playtest.js';
import { ModProject } from '../src/core/project.js';
import { hash, writeSafe } from '../src/core/files.js';
test('playtest derives only a mission folder and refuses unverified executable builds', () => {
  assert.equal(missionFolder('MISSIONS/MISE06-AUTODROM/scene2.bin'), 'missions/MISE06-AUTODROM');
  for (const path of ['models/Tommy.4ds', 'missions/../Game.exe', '/missions/TUTORIAL/scene2.bin', 'missions/wbtest/scene2.bin']) assert.throws(() => missionFolder(path));
  const fake = Buffer.alloc(0x240000, 0x90), before = Buffer.from(fake);
  assert.throws(() => patchDirectLevelExe(fake), /ověřené GOG/); assert.deepEqual(fake, before);
});
test('Wine graphics startup failure is reported even when the process exits with zero', () => {
  assert.match(wineStartupError('00cc:err:winediag:nodrv_CreateWindow The explorer process failed to start.'), /grafické okno/);
  assert.match(wineStartupError('dyld: Library not loaded: libinotify'), /knihovnu/);
  assert.equal(wineStartupError('starting in experimental wow64 mode\nRead access denied for device'), undefined);
});
test('incremental playtest skips unchanged data and applies edits, undo, removals and missing files', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mafia-sync-'));
  try {
    const game = path.join(root, 'game'); await fs.mkdir(game);
    const assets = [{ path: 'maps/first.bmp', original: 'originals/first', sha256: hash(Buffer.from('first')) }, { path: 'models/second.4ds', original: 'originals/second', sha256: hash(Buffer.from('second')) }];
    for (const asset of assets) await writeSafe(root, asset.original, Buffer.from(asset.original.endsWith('first') ? 'first' : 'second'));
    const project = new ModProject(root, { assets, history: [] });
    const originalRead = project.read.bind(project), reads = [];
    project.read = async name => { reads.push(name); return originalRead(name); };
    let sync = await synchronizeAssets(project, game);
    assert.equal(sync.copied, 2); assert.equal((await fs.stat(path.join(game, assets[0].path))).nlink, 1);
    reads.length = 0; sync = await synchronizeAssets(project, game, sync.files);
    assert.deepEqual(reads, []); assert.equal(sync.copied, 0);
    await project.change(assets[0].path, Buffer.from('edited')); reads.length = 0;
    sync = await synchronizeAssets(project, game, sync.files);
    assert.deepEqual(reads, [assets[0].path]); assert.equal(sync.copied, 1);
    assert.equal(await fs.readFile(path.join(game, assets[0].path), 'utf8'), 'edited');
    await project.undo(); sync = await synchronizeAssets(project, game, sync.files);
    assert.equal(await fs.readFile(path.join(game, assets[0].path), 'utf8'), 'first');
    await project.change(assets[0].path, Buffer.from('edited-again')); sync = await synchronizeAssets(project, game, sync.files);
    await fs.unlink(path.join(root, 'mods', assets[0].path)); sync = await synchronizeAssets(project, game, sync.files);
    assert.equal(await fs.readFile(path.join(game, assets[0].path), 'utf8'), 'first');
    await fs.unlink(path.join(game, assets[1].path)); sync = await synchronizeAssets(project, game, sync.files);
    assert.equal(sync.copied, 1); assert.equal(await fs.readFile(path.join(game, assets[1].path), 'utf8'), 'second');
    await fs.symlink(path.join(root, 'originals/first'), path.join(game, 'escape'));
    await assert.rejects(synchronizeAssets(project, game, sync.files), /odkaz/);
    assert.equal((await project.original(assets[0])).toString(), 'first');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
test('playtest reattaches a live owned session and refuses to overwrite it', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mafia-playtest-'));
  try {
    const directory = path.join(root, 'playtest'); await fs.mkdir(directory);
    await fs.writeFile(path.join(directory, 'snapshot.json'), JSON.stringify({ format: 'mafia-workbench-playtest', project: root, level: 'missions/TUTORIAL' }));
    await fs.writeFile(path.join(directory, 'run.json'), JSON.stringify({ pid: process.pid, exited: false }));
    const manager = new Playtest({});
    assert.equal((await manager.attach({ root })).running, true);
    await assert.rejects(manager.prepare({ root }, 'missions/TUTORIAL/scene2.bin'), /ukončete běžící/);
    const other = new Playtest({});
    assert.equal((await other.attach({ root: root + '-other' })).running, false);
    await fs.writeFile(path.join(directory, 'run.json'), JSON.stringify({ pid: process.pid, exited: true }));
    assert.equal((await new Playtest({}).attach({ root })).running, false);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
