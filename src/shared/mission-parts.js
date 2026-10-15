const canonical = value => value.replaceAll('\\', '/').normalize('NFC').toLowerCase();
const definitions = [
  ['scene2.bin', 'map', '3D scéna'],
  ['scene2.bin', 'logic', 'Logika mise'],
  ['scene2.bin', 'scene', 'Vlastnosti scény'],
  ['scene.4ds', 'model', 'Geometrie'],
  ['check.bin', 'navigation', 'Navigace'],
  ['road.bin', 'roads', 'Silnice'],
  ['effects.bin', 'effects', 'Efekty'],
  ['cache.bin', 'cache', 'Statické modely'],
  ['tree.klz', 'collision', 'Kolize']
];

// Resolve actual manifest paths, including mixed-case folders from different DTA layers.
export function missionParts(assets, filename) {
  const match = /^missions\/([^/]+)\/[^/]+$/i.exec(canonical(filename));
  if (!match) return [];
  const folder = `missions/${match[1]}/`, paths = new Map(assets.map(asset => [canonical(asset.path), asset.path]));
  return definitions.flatMap(([name, type, label]) => {
    const path = paths.get(folder + name);
    return path ? [{ path, type, label }] : [];
  });
}

export function missionViewKey(root, path, type) {
  return JSON.stringify([root, canonical(path), type]);
}
