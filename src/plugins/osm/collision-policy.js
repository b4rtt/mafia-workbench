// Missing settings preserve the original WORLD-vertex import byte for byte.
// Frame buffers remove that shared 16-bit pool, not the engine's other limits.
export function osmCollisionBudget(settings){
  if(settings===undefined)return {vertices:60000};
  if(!settings||settings.version!==1||settings.storage!=='frame'||Object.keys(settings).some(k=>!['version','storage'].includes(k)))throw Error('OpenStreetMap · kolize: neplatný uložený režim.');
  return {vertices:240000,triangles:240000,bufferVertices:960000};
}

// Count unique positions per scene object, like the legacy model surface.
// Keep an independent cap on actual LOD buffers and double-sided triangles.
export function osmCollisionUsage(surfaces){
  const objects=new Map();let triangles=0,bufferVertices=0;
  for(const surface of surfaces){
    const points=objects.get(surface.name)??new Set();objects.set(surface.name,points);
    for(const index of new Set(surface.indices))points.add(surface.positions.slice(index*3,index*3+3).map(Math.fround).join('/'));
    bufferVertices+=surface.positions.length/3;triangles+=surface.indices.length/3*(surface.doubleSided?2:1);
  }
  return {vertices:[...objects.values()].reduce((n,p)=>n+p.size,0),triangles,bufferVertices};
}
export function checkOsmCollisionBudget(surfaces,settings){
  const budget=osmCollisionBudget(settings),usage=osmCollisionUsage(surfaces);
  if(settings&&(usage.vertices>budget.vertices||usage.triangles>budget.triangles||usage.bufferVertices>budget.bufferVertices))throw Error('OpenStreetMap · kolize: město překračuje rozpočet modelových kolizí (240 000 bodů / trojúhelníků nebo 960 000 vrcholů bufferů); zmenšete vrstvy.');
  return usage;
}
