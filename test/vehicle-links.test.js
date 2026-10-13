import test from 'node:test';
import assert from 'node:assert/strict';
import { sceneVehicleFamily, vehicleDefinition } from '../src/shared/vehicle-links.js';

test('vehicle physics navigation requires one car actor and an unambiguous scene frame', () => {
  const object = { id: 'objects/1', name: 'WB_CAR', frameType: 9, model: 'ArRoW00.i3d' };
  const name = { id: 'actors/3/name', label: 'Název aktéra', value: 'wb_car' };
  const type = { id: 'actors/3/type', label: 'Typ aktéra', value: 4 };
  const file = { objects: [object], entries: [name, type] };
  assert.equal(sceneVehicleFamily(file, object), 'ArRoW');
  assert.equal(sceneVehicleFamily(file, null), null);
  for (const entries of [[], [name], [name, { ...type, value: 6 }], [name, { ...type, id: 'actors/4/type' }], [name, type, { ...name, id: 'actors/4/name' }], [name, type, { ...type, id: 'actors/3/type2' }]]) {
    assert.equal(sceneVehicleFamily({ ...file, entries }, object), null);
  }
  assert.equal(sceneVehicleFamily({ ...file, objects: [object, { ...object, id: 'objects/2', name: 'wb_car' }] }, object), null);
  for (const invalid of [{ frameType: 2 }, { model: null }, { model: 'arrow.i3d' }, { model: '../arrow00.i3d' }]) {
    assert.equal(sceneVehicleFamily(file, { ...object, ...invalid }), null);
  }
  const records = [{ index: 0, name: 'taxi' }, { index: 49, name: 'arrow' }];
  assert.equal(vehicleDefinition(records, 'ArRoW'), records[1]);
  assert.equal(vehicleDefinition(records, 'unknown'), null);
  assert.equal(vehicleDefinition([...records, { index: 50, name: 'ARROW' }], 'arrow'), null);
});
