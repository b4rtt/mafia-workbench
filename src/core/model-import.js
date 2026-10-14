import { parseFourDs } from './fourds.js';
import { parseBmp } from './bmp.js';
import { hash } from './files.js';

const key = name => name.toLowerCase();
function filename(name, extension) {
  if (typeof name !== 'string' || name.length > 120 || !/^[\x20-\x7e]+$/.test(name) || /[<>:"/\\|?*]/.test(name) || name.trim() !== name || name.endsWith('.') || !name.toLowerCase().endsWith(extension) || name.length <= extension.length || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) throw new Error(`Import: neplatný název ${extension} souboru. Použijte název bez cesty a diakritiky.`);
  return name;
}

// Native exporter output is copied exactly. No guessed conversion of geometry,
// skeletons or opaque payloads, and no overwriting existing project assets.
export function prepareModelImport(files, modelName) {
  if (!Array.isArray(files) || !files.length || files.length > 64) throw new Error('Import: vyberte jeden 4DS a nejvýše 63 BMP textur.');
  const rows = [], seen = new Set(); let size = 0;
  for (const file of files) {
    const extension = typeof file?.name === 'string' && /\.4ds$/i.test(file.name) ? '.4ds' : '.bmp';
    const name = filename(file?.name, extension), bytes = Buffer.from(file.data);
    if (!bytes.length || (size += bytes.length) > 64 * 1024 * 1024) throw new Error('Import: soubory jsou prázdné nebo přesahují 64 MiB.');
    if (seen.has(key(name))) throw new Error(`Import: opakovaný název souboru ${name}.`);
    seen.add(key(name)); rows.push({ name, extension, data: bytes });
  }
  const models = rows.filter(row => row.extension === '.4ds');
  if (models.length !== 1) throw new Error('Import: vyberte právě jeden model 4DS.');
  const model = parseFourDs(models[0].data, 'all'), references = new Map();
  for (const material of model.materials) {
    if (material.flags & 0x04000000) throw new Error('Import: sekvence animovaných textur zatím vyžaduje externí přípravu a není podporovaná tímto importem.');
    for (const field of ['texture', 'alphaTexture', 'environmentTexture']) if (material[field]) {
      const name = filename(material[field], '.bmp'); references.set(key(name), `maps/${name}`);
    }
  }
  for (const mesh of model.meshes) {
    const visited = new Set([mesh.id]); let source = mesh;
    while (source.instance) {
      source = model.meshes[source.instance - 1];
      if (!source || visited.has(source.id)) throw new Error('Import: model má neplatnou nebo cyklickou instanci geometrie.');
      visited.add(source.id);
    }
    if (mesh.inverseBind?.some(value => !Number.isFinite(value)) || mesh.skin?.some(skin => !skin.valid || skin.bones.some(bone => bone.inverse.some(value => !Number.isFinite(value))))) throw new Error('Import: model má neplatnou kostru nebo váhy.');
    for (const lod of mesh.lods ?? []) {
      if (!Number.isFinite(lod.distance) || lod.invalidNormals || lod.invalidUV || lod.faces.some(face => face.material > model.materials.length)) throw new Error('Import: neplatná geometrie, UV, normály nebo materiál.');
    }
  }
  const target = `models/${filename(modelName ?? models[0].name, '.4ds')}`;
  for (const row of rows.filter(row => row.extension === '.bmp')) parseBmp(row.data);
  return { target, files: rows.map(row => ({ path: row.extension === '.4ds' ? target : `maps/${row.name}`, data: row.data })), references: [...references.values()], summary: { version: model.version, meshes: model.meshes.length, materials: model.materials.length, joints: model.meshes.filter(mesh => mesh.joint).length } };
}

export async function modelImportPlan(project, files, modelName) {
  const prepared = prepareModelImport(files, modelName), selected = new Map(prepared.files.map(file => [key(file.path), file])), rows = [], expected = [], blocked = [];
  const paths = new Map([...prepared.files.map(file => [key(file.path), file.path]), ...prepared.references.map(name => [key(name), name])]);
  for (const [canonical, name] of paths) {
    const asset = project.manifest.assets.find(asset => key(asset.path) === canonical), source = selected.get(canonical), bytes = asset ? await project.read(asset.path) : null;
    const sha256 = bytes ? hash(bytes) : null;
    expected.push({ path: name, sha256 });
    let status = !asset && source ? 'new' : !asset ? 'missing' : !source || hash(source.data) === sha256 ? 'reuse' : 'conflict';
    if (canonical === key(prepared.target) && asset) status = 'conflict';
    if (asset && canonical !== key(prepared.target)) parseBmp(bytes);
    if (status === 'missing') blocked.push(`Chybí textura ${name}. Vyberte ji spolu s ostatními BMP.`);
    if (status === 'conflict') blocked.push(`Název ${name} již existuje s ${canonical === key(prepared.target) ? 'modelem' : 'jinými daty'}. Zvolte nový název modelu nebo změňte názvy textur a jejich vazby v externím nástroji.`);
    rows.push({ path: asset?.path ?? name, size: source?.data.length ?? bytes?.length ?? 0, status });
  }
  return { path: prepared.target, ...prepared.summary, files: rows, blocked, expected };
}

export async function importModel(project, files, modelName, expected) {
  const plan = await modelImportPlan(project, files, modelName);
  if (!expected || expected.path !== plan.path || JSON.stringify(expected.files) !== JSON.stringify(plan.expected)) throw new Error('Import: model nebo závislé textury se od náhledu změnily. Obnovte náhled.');
  if (plan.blocked.length) throw new Error(plan.blocked.join('\n'));
  const prepared = prepareModelImport(files, modelName), paths = new Set(plan.files.filter(file => file.status === 'new').map(file => key(file.path)));
  await project.createFiles(prepared.files.filter(file => paths.has(key(file.path))), `Import modelu ${plan.path.slice(7)}`, plan.expected.filter(file => file.sha256 !== null).map(file => ({ path: file.path, expectedHash: file.sha256 })), 'Vlastní model');
  return plan.path;
}
