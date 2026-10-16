import iconv from 'iconv-lite';
import { newAnimationPlan } from '../shared/new-animation.js';
import { parseFourDs } from './fourds.js';
import { parseFiveDs } from './fiveds.js';
import { hash } from './files.js';

// New v20 files only. Existing clips retain their opaque bytes via editAnimationTimeline.
export function animationFromModel(model, options) {
  const plan = newAnimationPlan(options, model), header = Buffer.alloc(22 + plan.nodes.length * 8), parts = [header];
  header.write('5DS\0'); header.writeUInt16LE(20, 4);
  // A deterministic zero FILETIME; the engine does not require an authoring timestamp.
  header.writeUInt16LE(plan.nodes.length, 18); header.writeUInt16LE(plan.frames, 20);
  let offset = header.length;
  for (const [i, node] of plan.nodes.entries()) {
    const data = Buffer.alloc(56); data.writeUInt32LE(14);
    let cursor = 4;
    for (const channel of ['rotation', 'position', 'scale']) {
      data.writeUInt16LE(1, cursor); cursor += 4; // one key, at frame zero; no even-count padding
      for (const value of node[channel]) { data.writeFloatLE(value, cursor); cursor += 4; }
    }
    header.writeUInt32LE(offset - 18, 26 + i * 8); parts.push(data); offset += data.length;
  }
  for (const [i, node] of plan.nodes.entries()) {
    const name = iconv.encode(node.name, 'windows-1250');
    if (name.length > 255 || iconv.decode(name, 'windows-1250') !== node.name) throw new Error('Název uzlu nelze zapsat do 5DS (Windows-1250, nejvýše 255 bajtů).');
    header.writeUInt32LE(offset - 18, 22 + i * 8); parts.push(name, Buffer.from([0])); offset += name.length + 1;
  }
  header.writeUInt32LE(offset - 18, 14);
  const bytes = Buffer.concat(parts); parseFiveDs(bytes);
  return { ...plan, bytes };
}

export async function createAnimation(project, options, modelHash) {
  const source = await project.read(options?.model);
  if (typeof modelHash !== 'string' || hash(source) !== modelHash) throw new Error('Model se od otevření změnil. Otevřete dialog znovu.');
  const result = animationFromModel(parseFourDs(source), options);
  await project.createFiles([{ path: result.path, data: result.bytes }], `Nová animace ${result.path.slice(6)}`, [{ path: options.model, expectedHash: modelHash }], 'Vlastní animace');
  return result.path;
}
