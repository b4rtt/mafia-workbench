import test from 'node:test';
import assert from 'node:assert/strict';
import { patchScopedChoiceMenu } from '../tools/choice-menu-prototype.js';
import { patchScopedChoiceMenuRuntime } from '../src/core/choice-menu-runtime.js';

test('scoped choice menu and production runtime reject unknown or truncated images without modifying them', () => {
  for (const source of [Buffer.alloc(0), Buffer.from('MZ'), Buffer.alloc(0x240000, 0x90)]) {
    const before = Buffer.from(source);
    assert.throws(() => patchScopedChoiceMenu(source), /verified original GOG|ověřené GOG/);
    assert.throws(() => patchScopedChoiceMenuRuntime(source, source), /verified original GOG/);
    assert.deepEqual(source, before);
  }
});
