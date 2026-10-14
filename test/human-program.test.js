import test from 'node:test';
import assert from 'node:assert/strict';
import { HUMAN_IDLE_SCRIPT, isBareHumanEnd } from '../src/shared/human-program.js';

test('only an unconditional bare NPC end offers the idle replacement', () => {
  for (const code of ['end', ' END\r\n', '// vypnuto\r\nend // konec\r\n']) assert.equal(isBareHumanEnd(code), true);
  for (const code of ['', '// end', 'wait 1000\nend', 'if flt[0] > 0, 1, 2\nlabel 1\nend', 'enemy_wait', HUMAN_IDLE_SCRIPT, undefined]) assert.equal(isBareHumanEnd(code), false);
  assert.equal(isBareHumanEnd(HUMAN_IDLE_SCRIPT + 'end'), false); // Unreachable end is not a bare halt.
});
