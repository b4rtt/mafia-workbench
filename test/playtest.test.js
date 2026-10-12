import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Playtest, missionFolder, patchDirectLevelExe } from '../src/core/playtest.js';
test('playtest derives only a mission folder and refuses unverified executable builds', () => {
  assert.equal(missionFolder('MISSIONS/MISE06-AUTODROM/scene2.bin'), 'missions/MISE06-AUTODROM');
  for (const path of ['models/Tommy.4ds', 'missions/../Game.exe', '/missions/TUTORIAL/scene2.bin', 'missions/wbtest/scene2.bin']) assert.throws(() => missionFolder(path));
  const fake = Buffer.alloc(0x240000, 0x90), before = Buffer.from(fake);
  assert.throws(() => patchDirectLevelExe(fake), /ověřené GOG/); assert.deepEqual(fake, before);
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
