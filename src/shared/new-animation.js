// A new clip starts from absolute local model transforms, never world transforms.
export function newAnimationPlan(options, model) {
  if (!options || Object.keys(options).some(key => !['name', 'model', 'frames'].includes(key))) throw new Error('Nová animace: neplatné nastavení.');
  const name = typeof options.name === 'string' ? options.name.replace(/\.5ds$/i, '') : '';
  if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,55}$/.test(name) || name.endsWith('.') || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) throw new Error('Název animace: 1–56 znaků bez cesty a diakritiky (písmena, číslice, _, -, .).');
  if (typeof options.model !== 'string' || !/^models\/.+\.4ds$/i.test(options.model)) throw new Error('Vyberte model 4DS z projektu.');
  if (!Number.isInteger(options.frames) || options.frames < 0 || options.frames > 65535) throw new Error('Poslední snímek musí být celé číslo 0–65535.');
  if (!Array.isArray(model?.meshes)) throw new Error('Model není podporovaný.');
  const nodes = [], names = new Set(); let unnamed = 0;
  for (const mesh of model.meshes) {
    if (typeof mesh.name !== 'string' || !mesh.name.trim()) { unnamed++; continue; }
    const key = mesh.name.normalize('NFC').toLowerCase();
    if (names.has(key)) throw new Error(`Model má nejednoznačný název uzlu „${mesh.name}“. Před vytvořením animace uzly přejmenujte.`);
    if (mesh.name.includes('\0')) throw new Error('Model má neplatný název uzlu.');
    names.add(key);
    for (const [channel, size] of [['rotation', 4], ['position', 3], ['scale', 3]]) if (!Array.isArray(mesh[channel]) || mesh[channel].length !== size || mesh[channel].some(value => typeof value !== 'number' || !Number.isFinite(value) || !Number.isFinite(Math.fround(value)))) throw new Error(`Uzel „${mesh.name}“ má neplatnou transformaci.`);
    if (Math.hypot(...mesh.rotation) < 1e-10) throw new Error(`Uzel „${mesh.name}“ má nulový quaternion.`);
    nodes.push({ name: mesh.name, rotation: [...mesh.rotation], position: [...mesh.position], scale: [...mesh.scale] });
  }
  if (!nodes.length || nodes.length > 65535) throw new Error('Model musí mít 1–65535 jednoznačně pojmenovaných uzlů.');
  return { path: `anims/${name}.5ds`, frames: options.frames, nodes, unnamed };
}
