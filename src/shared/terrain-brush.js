// The brush edits local Y only. X/Z, UV, topology and other LODs are preserved.
export function terrainNeighbors(lod) {
  const neighbors=Array.from({length:lod.vertices},()=>new Set());
  for(const face of lod.faces)for(let at=0;at<face.indices.length;at+=3){
    const triangle=face.indices.slice(at,at+3);
    for(const a of triangle)for(const b of triangle)if(a!==b)neighbors[a].add(b);
  }
  return neighbors.map(set=>[...set]);
}

export function terrainBrush(lod,{mode,center,radius,amount,height,strength},neighbors) {
  if(!['raise','lower','flatten','smooth'].includes(mode)||!Array.isArray(center)||center.length!==2||!center.every(Number.isFinite)||!Number.isFinite(radius)||radius<=0||radius>32768)throw new Error('Zadejte platný režim, střed a poloměr štětce (0–32768 m).');
  if(['raise','lower'].includes(mode)&&(!Number.isFinite(amount)||amount<=0||amount>32768))throw new Error('Zadejte kladnou změnu výšky do 32768 m.');
  if(['flatten','smooth'].includes(mode)&&(!Number.isFinite(strength)||strength<=0||strength>1))throw new Error('Síla štětce musí být větší než 0 a nejvýše 1.');
  if(mode==='flatten'&&(!Number.isFinite(height)||!Number.isFinite(Math.fround(height))))throw new Error('Zadejte konečnou cílovou výšku.');
  if(mode==='smooth')neighbors??=terrainNeighbors(lod);
  const changes=[];
  for(let index=0;index<lod.vertices;index++){
    const position=lod.positions.slice(index*3,index*3+3),distance=Math.hypot(position[0]-center[0],position[2]-center[1]);
    if(distance>=radius)continue;
    const t=1-distance/radius,weight=t*t*(3-2*t),before=position[1];let value=before;
    if(mode==='raise'||mode==='lower')value+=amount*weight*(mode==='raise'?1:-1);
    else if(mode==='flatten')value+=(height-before)*strength*weight;
    else if(neighbors[index].length){
      const average=neighbors[index].reduce((sum,other)=>sum+lod.positions[other*3+1],0)/neighbors[index].length;
      value+=(average-before)*strength*weight;
    }
    value=Math.fround(value);if(!Number.isFinite(value))throw new Error('Výsledek štětce překračuje rozsah 4DS.');
    if(!Object.is(value,before)){position[1]=value;changes.push({index,position});}
  }
  return changes;
}
