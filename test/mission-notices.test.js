import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { missionTaskScript, inspectMissionTask } from '../src/shared/mission-task.js';
import { missionCombatScript, inspectMissionCombat } from '../src/shared/mission-combat.js';
import { ModProject } from '../src/core/project.js';
import { changeSceneObject, inspectScene } from '../src/core/scene.js';
import { addTextDbEntry } from '../src/core/textdb.js';
import { hash, writeSafe } from '../src/core/files.js';

// Frozen output from the version that displayed results through both HUD channels.
const fixtures = JSON.parse(await fs.readFile(new URL('./fixtures/legacy-mission-notices.json', import.meta.url)));
const generator = kind => kind === 'task' ? missionTaskScript : missionCombatScript;
const inspector = kind => kind === 'task' ? inspectMissionTask : inspectMissionCombat;
const withoutNotices = source => source.split('\n').filter(line => !/^(subtitle_add|console_addtext) /.test(line));

test('quest notices use native objective display and one outcome channel without changing decisions, timing or signals', () => {
  for (const fixture of fixtures) {
    const { kind, options, source } = fixture, current = generator(kind)(options);
    assert(!current.includes('subtitle_add'), 'Task notices must not enter the centered dialogue/intro channel');
    assert.deepEqual(withoutNotices(current), withoutNotices(source));
    const notices = [...current.matchAll(/^console_addtext (\d+)$/gm)].map(match => Number(match[1]));
    const expected = [options.completeId];
    if (options.failure) expected.push(options.failure.textId);
    assert.deepEqual(notices, expected, 'Only outcomes need explicit notifications; objectives display themselves');
    assert.equal(generator(kind)(inspector(kind)(current)), current);
  }
});

test('old notice recipes remain editable only when their entire program is an exact legacy match', () => {
  for (const { kind, source, options } of fixtures) {
    const inspect = inspector(kind), generate = generator(kind);
    for (const old of [source, source.replaceAll('\n', '\r\n')]) {
      assert(inspect(old));
      assert.equal(generate(inspect(old)), generate(options));
    }
    // Inserting or deleting a notice is still a custom program, not a wizard recipe.
    for (const edited of [source + '\nconsole_addtext 999', source.replace('wait 2000', 'wait 2001'), source.replace(/subtitle_add \d+\n/, ''), source.replace('console_addtext', 'subtitle_add')]) assert.equal(inspect(edited), null);
  }
});

const chunk = (type, data) => { const h = Buffer.alloc(6); h.writeUInt16LE(type); h.writeUInt32LE(data.length + 6, 2); return Buffer.concat([h, data]); };
for (const fixture of fixtures.filter((_, i) => i === 0 || i === 2)) test(`${fixture.kind}: explicitly saving an old recipe fixes notices, preserves siblings and supports exact export/reopen/undo`, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mafia-notices-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await writeSafe(root, 'workbench.json', JSON.stringify({ format: 'mafia-workbench', version: 2, name: 'Notices', assets: [], history: [] }));
  const p = await ModProject.open(root), name = 'missions/Test/scene2.bin', geometryPath = 'missions/Test/scene.4ds', textPath = 'tables/textdb_cz.def';
  const geometry = Buffer.alloc(19); geometry.write('4DS\0'); geometry.writeUInt16LE(29, 4); geometry[18] = 1;
  let scene = chunk(0x4c53, Buffer.concat([chunk(0x4000, Buffer.alloc(0)), chunk(0xbabe, Buffer.from('unknown sibling'))]));
  for (const npc of ['First', 'Second']) scene = changeSceneObject(scene, { kind: 'add-human', name: npc, model: 'human.i3d', position: [0, 0, 0], rotation: [1, 0, 0, 0], scale: [1, 1, 1], parameters: {}, code: 'wait 987\nend' });
  scene = changeSceneObject(scene, { kind: 'add-detector', name: 'DESTINATION', position: [8, 0, 0], mask: 0, code: 'wait 321\nend' });
  scene = changeSceneObject(scene, { kind: 'add-detector', name: 'Quest', position: [0, 0, 0], mask: 1, code: fixture.source });
  let text = Buffer.alloc(17); text.writeUInt32LE(1); text.writeUInt32LE(99999999, 8); text.writeUInt32LE(16, 12);
  for (const id of [10, 20, 30, 40]) text = addTextDbEntry(text, textPath, { id, text: 'Own text ' + id });
  await p.createFiles([{ path: name, data: scene }, { path: geometryPath, data: geometry }, { path: textPath, data: text }]);
  const history = p.manifest.history.length, original = inspectScene(scene);
  const request = { kind: 'configure-' + fixture.kind, target: 'Quest', [fixture.kind]: { ...inspector(fixture.kind)(fixture.source), textDb: textPath, textHash: hash(text) } };
  await p.changeSceneObject(name, request, hash(scene));
  const changed = await p.read(name), parsed = inspectScene(changed), entry = parsed.entries.find(e => e.actorScript && e.value.name === 'Quest');
  assert.equal(entry.value.code, generator(fixture.kind)(fixture.options));
  assert.deepEqual(parsed.entries.filter(e => e.id !== entry.id), original.entries.filter(e => e.id !== entry.id));
  assert.deepEqual(p.manifest.history.at(-1).files.map(f => f.path), [name]);
  await p.changeSceneObject(name, request, hash(changed));
  assert.equal(p.manifest.history.length, history + 1, 'Second save is a no-op');
  const reopened = await ModProject.open(root); await reopened.export(root + '/export');
  assert.deepEqual(await fs.readFile(root + '/export/' + name), changed);
  assert.deepEqual(await reopened.read(textPath), text); assert.deepEqual(await reopened.read(geometryPath), geometry);
  await reopened.undo(); assert.deepEqual(await reopened.read(name), scene); assert.equal(reopened.manifest.history.length, history);
});
