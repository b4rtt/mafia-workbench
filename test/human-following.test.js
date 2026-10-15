import test from 'node:test';
import assert from 'node:assert/strict';
import { humanBehaviorScript, inspectHumanBehavior } from '../src/shared/human-behavior.js';
import { humanFollowingDestinations, resolveHumanFollowing } from '../src/shared/human-following.js';

const following = { mode: 'follow', startSignal: 'Start', destinationName: 'Finish', destinationRadius: 2.5, onComplete: 'Done', delaySeconds: 1.125 };
test('following recipes gate on a named detector, measure the NPC at destination and remain active after stopping', () => {
  for (const startSignal of [null, 'Start']) for (const destinationName of [null, 'Finish']) for (const onComplete of destinationName ? [null, 'Done', startSignal] : [null]) {
    const options = { ...following, startSignal, destinationName, destinationRadius: destinationName ? 2.5 : null, onComplete }, code = humanBehaviorScript('Companion', options);
    assert.deepEqual(inspectHumanBehavior('Companion', code), options); assert.deepEqual(inspectHumanBehavior('Companion', code.replaceAll('\r\n', '\n')), options);
    assert.match(code, /findactor 0, "Tommy"/); assert.match(code, /enemy_action_follow 0, 2, nolink, return/); assert.doesNotMatch(code, /^end$/m); assert.match(code, /label 99\r\nwait 1000\r\ngoto 99/);
    if (startSignal) assert(code.indexOf('detector_issignal') < code.indexOf('enemy_followplayer yes'));
    if (destinationName) { assert.match(code, /findframe 0, "Companion"/); assert(code.indexOf('label 20') < code.lastIndexOf('enemy_followplayer no')); }
    if (onComplete) assert(code.lastIndexOf('enemy_followplayer no') < code.indexOf('detector_setsignal'));
    for (const altered of [code + '// custom', code.replace('Companion', 'Other'), code.replace('yes', 'no'), code.replace('wait 1000', 'end')]) if (altered !== code) assert.equal(inspectHumanBehavior('Companion', altered).mode, 'custom');
    const labels = [...code.matchAll(/^label (\d+)\r?$/gm)].map(match => match[1]); assert.equal(new Set(labels).size, labels.length);
  }
});
test('following rejects invalid targets, activation names, radius and delay without disabling existing custom programs', () => {
  for (const extra of [{ startSignal: 'Companion' }, { onComplete: 'A"\nend' }, { destinationName: 'Tommy' }, { destinationName: null }, { destinationRadius: 0 }, { destinationRadius: 1e-99 }, { destinationRadius: Infinity }, { delaySeconds: NaN }, { delaySeconds: -1 }]) assert.throws(() => humanBehaviorScript('Companion', { ...following, ...extra }), /Doprovod/);
  assert.throws(() => humanBehaviorScript('Tommy', following), /NPC/);
  const code = humanBehaviorScript('Companion', { mode: 'follow' }); assert.equal(inspectHumanBehavior('Companion', code).mode, 'follow'); assert(!code.includes('dim_frm') && !code.includes('detector_setsignal'));
  assert.equal(humanBehaviorScript('Companion', { mode: 'custom', code: 'enemy_followplayer yes\nend' }), 'enemy_followplayer yes\nend');
});
const fixture = () => ({ actors: [{ name: 'Tommy', kind: 2 }, { name: 'Companion', kind: 27 }, { name: 'Start', kind: 5 }, { name: 'Done', kind: 5 }, { name: 'Door', kind: 10 }], objects: [{ name: 'Tommy', frameType: 9 }, { name: 'Companion', frameType: 9 }, { name: 'Start', frameType: 6 }, { name: 'Done', frameType: 6 }, { name: 'Finish', frameType: 6 }, { name: 'Door', frameType: 9, model: 'door.i3d' }], geometry: { meshes: [] } });
test('following resolves real player, signal actors and static frames case-insensitively, rejecting ambiguous bindings', () => {
  const scene = fixture(), original = JSON.stringify(scene), resolved = resolveHumanFollowing(scene, 'Companion', { ...following, startSignal: 'sTART', destinationName: 'finish', onComplete: 'done' });
  assert.deepEqual(resolved, following); assert.equal(JSON.stringify(scene), original);
  assert(!humanFollowingDestinations(scene, 'Companion').some(frame => ['Companion', 'Tommy', 'Door'].includes(frame.name)));
  for (const extra of [{ startSignal: 'Missing' }, { startSignal: 'Finish' }, { destinationName: 'Companion' }, { destinationName: 'Door' }, { onComplete: 'Tommy' }]) assert.throws(() => resolveHumanFollowing(scene, 'Companion', { ...following, ...extra }), /Doprovod/);
  const missing = fixture(); missing.actors[0].kind = 27; assert.throws(() => resolveHumanFollowing(missing, 'Companion', following), /Player/);
  const duplicate = fixture(); duplicate.actors.push({ name: 'START', kind: 5 }); assert.throws(() => resolveHumanFollowing(duplicate, 'Companion', following), /skriptový/);
  const shadow = fixture(); shadow.geometry.meshes.push({ name: 'FINISH', type: 1 }); assert.throws(() => resolveHumanFollowing(shadow, 'Companion', following), /nepohyblivý/);
});
