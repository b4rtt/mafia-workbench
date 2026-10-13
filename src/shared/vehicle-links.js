const key = name => name.normalize('NFC').toLowerCase();

export function vehicleModelIdentity(path) {
  const match = /^models\/([^/\\]+)(\d{2})\.4ds$/i.exec(path);
  return match ? { family: match[1], variant: Number(match[2]) } : null;
}

// A visual car model alone is not a vehicle actor. Do not guess ambiguous bindings.
export function sceneVehicleFamily(file, object) {
  if (!object || object.frameType !== 9 || typeof object.model !== 'string') return null;
  const name = key(object.name);
  if (file.objects.filter(other => key(other.name) === name).length !== 1) return null;
  const actors = file.entries.filter(entry => entry.label === 'Název aktéra' && typeof entry.value === 'string' && key(entry.value) === name);
  if (actors.length !== 1) return null;
  const parent = actors[0].id.slice(0, actors[0].id.lastIndexOf('/'));
  const types = file.entries.filter(entry => entry.label === 'Typ aktéra' && entry.id.slice(0, entry.id.lastIndexOf('/')) === parent);
  if (types.length !== 1 || types[0].value !== 4) return null;
  return vehicleModelIdentity(`models/${object.model.replace(/\.i3d$/i, '.4ds')}`)?.family ?? null;
}

export function vehicleDefinition(records, family) {
  const matches = records.filter(record => key(record.name) === key(family));
  return matches.length === 1 ? matches[0] : null;
}
