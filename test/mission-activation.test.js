import test from 'node:test';
import assert from 'node:assert/strict';
import { missionActivation } from '../src/shared/mission-activation.js';
import { missionTaskScript, inspectMissionTask } from '../src/shared/mission-task.js';
import { missionDialogueScript, inspectMissionDialogue } from '../src/shared/mission-dialogue.js';
import { missionCombatScript, inspectMissionCombat } from '../src/shared/mission-combat.js';

const task = { objectiveId: null, interactionId: null, nextObjectiveId: 30, completeId: 40, targetName: 'Destination', checkpointId: 5050, failure: { timeoutSeconds: 10, textId: 50 }, flow: { waitForSignal: true, onComplete: 'Next', onFailure: 'Failed' } };
const dialogue = { lines: [{ speaker: 'First', listener: 'Tommy', textId: 60 }], camera: true, flow: { waitForSignal: true, onComplete: 'Next' } };
const combat = { targets: ['First'], objectiveId: 30, completeId: 40, checkpointId: 5050, failure: { timeoutSeconds: 10, textId: 50 }, flow: { waitForSignal: true, onComplete: 'Next', onFailure: 'Failed' } };

test('activation rejects invalid spheres, unsupported triggers and stray radius values', () => {
  for (const radius of [null, undefined, NaN, Infinity, -1, 0, 1e-99, 1e99, '3']) assert.throws(() => missionActivation('area', radius), /poloměr/);
  for (const trigger of ['auto', '', null, 3]) assert.throws(() => missionActivation(trigger), /Spuštění/);
  for (const trigger of ['load', 'use']) assert.throws(() => missionActivation(trigger, 3), /pouze k oblasti/);
});
test('all area recipes round trip exactly, gate on signal before range and initialize timers/checkpoints after activation', () => {
  for (const [generate, inspect, recipe] of [[missionTaskScript, inspectMissionTask, task], [missionDialogueScript, inspectMissionDialogue, dialogue], [missionCombatScript, inspectMissionCombat, combat]]) {
    for (const radius of [0.125, 3, 1e-8, 12.3456789]) {
      const code = generate({ ...recipe, trigger: 'area', triggerRadius: radius }), parsed = inspect(code);
      assert.equal(parsed.trigger, 'area'); assert.equal(parsed.triggerRadius, radius); assert.equal(generate(parsed), code); assert.equal(generate(inspect(code.replaceAll('\n', '\r\n'))), code);
      assert(code.indexOf('detector_issignal') < code.indexOf('detector_inrange'));
      assert(!code.includes('detector_waitforuse'));
      for (const command of ['getgametime 8', 'getgametime 1', 'autosavegamefull', 'human_talk', 'dialog_begin']) if (code.includes(command)) assert(code.indexOf('label 4') < code.indexOf(command));
      assert.equal(new Set([...code.matchAll(/^label (\d+)$/gm)].map(match => match[1])).size, [...code.matchAll(/^label (\d+)$/gm)].length);
      for (const changed of [code.replace('if flt[0] > 0, 4, -1', 'if flt[0] > 1, 4, -1'), code.replace('goto 3', 'goto 4'), code.replace('dim_flt', 'dim_frm'), code + '\n// custom']) assert.equal(inspect(changed), null);
    }
  }
});
test('automatic linear tasks omit unused action and first objective IDs while retaining inventory, failure and flow', () => {
  for (const inventory of [null, { itemId: 23, atTarget: false, consume: true }, { itemId: 23, atTarget: true, consume: false }]) {
    const code = missionTaskScript({ ...task, trigger: 'load', inventory, ...(inventory && !inventory.atTarget ? { targetName: null, targetRadius: null } : {}) }), parsed = inspectMissionTask(code);
    assert.equal(parsed.trigger, 'load'); assert.equal(parsed.objectiveId, null); assert.equal(parsed.interactionId, null); assert.equal(parsed.nextObjectiveId, 30); assert.equal(missionTaskScript(parsed), code);
    assert(!code.includes('detector_waitforuse')); assert.equal((code.match(/^mission_objectives /gm) ?? []).length, 1);
  }
  assert.throws(() => missionTaskScript({ ...task, trigger: 'load', objectiveId: 10 }), /nemá první zadání/);
});
