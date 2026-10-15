// Cache instances use world coordinates under Primary sector. Part bounds are
// streaming metadata, never an extra parent transform. Keep both sources apart.
export function cacheMap(cache, partId, scene = null, warning = null) {
  if (cache.type !== 'cache') throw new Error(cache.warning ?? 'Cache města není podporovaná.');
  const part = cache.parts.find(part => part.id === partId);
  if (!part) throw new Error('Vyberte existující část města.');
  const {parts,entries,...metadata}=cache;
  return {
    ...metadata, type: 'map', cacheSource: true, cachePart: part.id,
    cacheParts: parts.map(part => ({id:part.id,name:part.name,count:part.objects.length})),
    objects: part.objects, entries: entries.filter(entry => entry.id.startsWith(part.id + '/')),
    geometry: scene?.geometry ?? {meshes:[],materials:[]},
    contextObjects: (scene?.objects ?? []).map(object => ({...object,contextOnly:true,fields:{}})),
    scenePath: scene?.path ?? null, contextWarning: warning
  };
}
