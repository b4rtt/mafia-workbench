import { inspectScene } from './scene.js';

// Empty Mission uses C_traffic_car v5 and the pedestrian generator v1.
// Preserve model names and opaque data. At zero also disable pedestrian slots:
// GameInit otherwise clamps the global pedestrian budget back up to one.
export function configureMissionPopulation(source, { trafficCars, pedestrians } = {}) {
  const settings = [{ name: 'traffic', kind: 12, value: trafficCars, offset: 16 }, { name: 'pedestrians', kind: 18, value: pedestrians, offset: 25 }].filter(row => row.value !== undefined);
  for (const row of settings) if (!Number.isInteger(row.value) || row.value < 0 || row.value > 100) throw new Error('Okolní auta a chodci: zadejte celé číslo 0–100.');
  const scene = inspectScene(source), result = Buffer.from(source);
  const children = (start, end) => {
    const rows = [];
    for (let offset = start; offset < end;) {
      const size = result.readUInt32LE(offset + 2);
      rows.push({ type: result.readUInt16LE(offset), start: offset + 6, end: offset + size }); offset += size;
    }
    return rows;
  };
  const roots = children(0, result.length).filter(row => row.type === 0x4c53), containers = roots.flatMap(row => children(row.start, row.end)).filter(row => row.type === 0xae20);
  for (const setting of settings) {
    const actors = scene.actors.filter(actor => actor.name.toLowerCase() === setting.name);
    if (actors.length !== 1 || actors[0].kind !== setting.kind || containers.length !== 1) throw new Error(`Šablona nemá jednoznačný generátor ${setting.name}.`);
    const matches = children(containers[0].start, containers[0].end).filter(row => row.type === 0xae21).map(row => children(row.start, row.end)).filter(rows => {
      const names = rows.filter(row => row.type === 0xae23);
      return names.length === 1 && result.subarray(names[0].start, names[0].end).toString('ascii') === setting.name + '\0';
    });
    const data = matches.length === 1 ? matches[0].filter(row => row.type === 0xae24) : [];
    if (data.length !== 1) throw new Error(`Šablona má nepodporovaná data generátoru ${setting.name}.`);
    const row = data[0], bytes = result.subarray(row.start, row.end);
    const supported = setting.kind === 12
      ? bytes.length >= 24 && bytes.readUInt32LE(0) === 5 && bytes.length === 24 + bytes.readUInt32LE(20) * 32
      : bytes.length >= 33 && bytes.readUInt32LE(0) === 1 && bytes.length === 33 + bytes.readUInt32LE(29) * 21;
    if (!supported) throw new Error(`Šablona má nepodporovanou verzi generátoru ${setting.name}.`);
    result.writeUInt32LE(setting.value, row.start + setting.offset);
    if (setting.kind === 18 && setting.value === 0) {
      const count = bytes.readUInt32LE(29), start = 33 + count * 17;
      for (let i = 0; i < count; i++) result.writeUInt32LE(0, row.start + start + i * 4);
    }
  }
  return result;
}
