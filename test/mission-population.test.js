import test from 'node:test';
import assert from 'node:assert/strict';
import { configureMissionPopulation } from '../src/core/mission-population.js';
import { inspectScene } from '../src/core/scene.js';

const chunk = (type, data) => { const h = Buffer.alloc(6); h.writeUInt16LE(type); h.writeUInt32LE(data.length + 6, 2); return Buffer.concat([h, data]); };
const uint = value => { const b = Buffer.alloc(4); b.writeUInt32LE(value); return b; };
const actor = (name, kind, bytes) => chunk(0xae21, Buffer.concat([chunk(0xae23, Buffer.from(name + '\0')), chunk(0xae22, uint(kind)), chunk(0xae24, bytes), chunk(0xbeef, Buffer.from([19, 23, 29]))]));
function fixture() {
  const cars = Buffer.alloc(24 + 2 * 32, 0xcd); cars.writeUInt32LE(5); cars.writeUInt32LE(100, 16); cars.writeUInt32LE(2, 20);
  const people = Buffer.alloc(33 + 2 * 21, 0xab); people.writeUInt32LE(1); people.writeUInt32LE(100, 25); people.writeUInt32LE(2, 29);
  const scene = actors => chunk(0x4c53, Buffer.concat([chunk(0x4000, Buffer.alloc(0)), chunk(0xae20, Buffer.concat(actors)), chunk(0xabcd, Buffer.from([11, 13, 17]))]));
  return { cars, people, scene, source: scene([actor('traffic', 12, cars), actor('pedestrians', 18, people), actor('Other', 35, Buffer.from([0, 1, 2]))]) };
}
test('new-mission population settings change only requested budgets, preserve opaque tables and never mutate the template', () => {
  const { source, cars, people, scene } = fixture(), before = Buffer.from(source);
  assert.deepEqual(configureMissionPopulation(source), source);
  for (const [trafficCars, pedestrians] of [[0, 0], [1, 100], [100, 7], [100, 100]]) {
    const a = Buffer.from(cars), b = Buffer.from(people); a.writeUInt32LE(trafficCars, 16); b.writeUInt32LE(pedestrians, 25);
    if (trafficCars === 0) { a.writeFloatLE(0, 44); a.writeFloatLE(0, 76); }
    if (pedestrians === 0) { b.writeUInt32LE(0, 67); b.writeUInt32LE(0, 71); }
    const expected = scene([actor('traffic', 12, a), actor('pedestrians', 18, b), actor('Other', 35, Buffer.from([0, 1, 2]))]);
    assert.deepEqual(configureMissionPopulation(source, { trafficCars, pedestrians }), expected);
    assert.deepEqual(source, before); assert.equal(inspectScene(expected).actors.length, 3);
  }
  const carsOnly = Buffer.from(cars); carsOnly.writeUInt32LE(0, 16); carsOnly.writeFloatLE(0, 44); carsOnly.writeFloatLE(0, 76);
  assert.deepEqual(configureMissionPopulation(source, { trafficCars: 0 }), scene([actor('traffic', 12, carsOnly), actor('pedestrians', 18, people), actor('Other', 35, Buffer.from([0, 1, 2]))]));
});
test('population configuration refuses invalid counts and ambiguous, missing or unsupported generators', () => {
  const { source, cars, people, scene } = fixture();
  for (const name of ['trafficCars', 'pedestrians']) for (const value of [-1, 101, .5, NaN, Infinity, null, false, '0']) assert.throws(() => configureMissionPopulation(source, { [name]: value }), /0–100/);
  const wrongVersion = Buffer.from(cars); wrongVersion.writeUInt32LE(4);
  const malformedTable = Buffer.from(people); malformedTable.writeUInt32LE(3, 29);
  for (const [actors, options] of [
    [[actor('traffic', 12, cars), actor('TRAFFIC', 12, cars)], { trafficCars: 0 }],
    [[actor('traffic', 18, cars)], { trafficCars: 0 }],
    [[actor('traffic', 12, wrongVersion)], { trafficCars: 0 }],
    [[actor('pedestrians', 18, malformedTable)], { pedestrians: 0 }],
    [[actor('traffic', 12, cars)], { pedestrians: 0 }],
  ]) assert.throws(() => configureMissionPopulation(scene(actors), options), /generátor/);
  assert.deepEqual(configureMissionPopulation(scene([actor('traffic', 12, cars)]), { trafficCars: 0 }), scene([actor('traffic', 12, (() => { const b = Buffer.from(cars); b.writeUInt32LE(0, 16); b.writeFloatLE(0, 44); b.writeFloatLE(0, 76); return b; })())]));
});
