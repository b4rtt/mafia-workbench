import test from 'node:test';
import assert from 'node:assert/strict';
import { assetCategory, groupAssets } from '../src/shared/categories.js';
test('Windows folder casing is merged without changing source paths', () => {
  const files = [{ path: 'missions/MISE06-AUTODROM/scene.4ds' }, { path: 'MISSIONS/mise06-autodrom/scene2.bin' }];
  const grouped = groupAssets(files); assert.equal(grouped.length, 1); assert.deepEqual(grouped[0].files, files);
  assert.equal(assetCategory(files[0].path), 'levels');
  assert.equal(assetCategory('SOUNDS/MUSIC/01.ogg'), 'music');
  assert.equal(assetCategory('maps/Scene.BMP'), 'textures');
  assert.equal(assetCategory('models/Tom.4DS'), 'models');
});
