export function geometryNormals(positions,faces) {
  const normals=new Array(positions.length).fill(0);
  for(const face of faces)for(let i=0;i<face.indices.length;i+=3){
    const [a,b,c]=face.indices.slice(i,i+3).map(index=>index*3),ab=[positions[b]-positions[a],positions[b+1]-positions[a+1],positions[b+2]-positions[a+2]],ac=[positions[c]-positions[a],positions[c+1]-positions[a+1],positions[c+2]-positions[a+2]],normal=[ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0]];
    for(const at of [a,b,c])for(let component=0;component<3;component++)normals[at+component]+=normal[component];
  }
  for(let i=0;i<normals.length;i+=3){const size=Math.hypot(normals[i],normals[i+1],normals[i+2]);if(size)for(let component=0;component<3;component++)normals[i+component]/=size;}
  return normals;
}
export function geometryPreview(lod,changes,recompute=false) {
  const result={...lod,positions:[...lod.positions],normals:[...(lod.rawNormals??lod.normals)],uv:[...(lod.rawUV??lod.uv)]};
  for(const change of changes)for(const [key,array,size]of [['position','positions',3],['normal','normals',3],['uv','uv',2]])if(change[key])result[array].splice(change.index*size,size,...change[key].map(Math.fround));
  if(recompute)result.normals=geometryNormals(result.positions,lod.faces).map(Math.fround);
  previewFallbacks(result);
  return result;
}

export function geometryTopology(lod) {
  return {vertices:Array.from({length:lod.vertices},(_,source)=>({source})),faces:lod.faces.map(face=>({material:face.material,indices:[...face.indices]}))};
}
export function validateTopology(lod,topology,materialCount) {
  if(!topology||!Array.isArray(topology.vertices)||topology.vertices.length>65535||!Array.isArray(topology.faces)||topology.faces.length>255||Object.keys(topology).some(key=>!['vertices','faces'].includes(key)))throw new Error('4DS: neplatná topologie nebo překročený počet vrcholů/skupin.');
  for(const vertex of topology.vertices){
    if(!vertex)throw new Error('4DS: neplatný nový vrchol.');
    if(Object.hasOwn(vertex,'source')){if(Object.keys(vertex).length!==1||!Number.isInteger(vertex.source)||vertex.source<0||vertex.source>=lod.vertices)throw new Error('4DS: neplatný zdroj vrcholu.');}
    else{
      if(Object.keys(vertex).length!==3||Object.keys(vertex).some(key=>!['position','normal','uv'].includes(key)))throw new Error('4DS: nový vrchol potřebuje pozici, normálu a UV.');
      for(const [key,size]of [['position',3],['normal',3],['uv',2]])if(!Array.isArray(vertex[key])||vertex[key].length!==size||!Array.from(vertex[key]).every(value=>typeof value==='number'&&Number.isFinite(value)&&Number.isFinite(Math.fround(value))))throw new Error('4DS: neplatné souřadnice nového vrcholu.');
    }
  }
  for(const face of topology.faces){
    if(!face||Object.keys(face).some(key=>!['material','indices'].includes(key))||!Number.isInteger(face.material)||face.material<0||face.material>materialCount||!Array.isArray(face.indices)||face.indices.length%3||face.indices.length>65535*3||!Array.from(face.indices).every(index=>Number.isInteger(index)&&index>=0&&index<topology.vertices.length))throw new Error('4DS: neplatný materiál, trojúhelník nebo překročený počet ploch.');
  }
}
export function topologyPreview(lod,topology) {
  const result={...lod,vertices:topology.vertices.length,positions:[],normals:[],uv:[],faces:topology.faces.map(face=>({material:face.material,indices:[...face.indices]}))};
  for(const vertex of topology.vertices)for(const [key,array,size]of [['position','positions',3],['normal','normals',3],['uv','uv',2]])result[array].push(...(Object.hasOwn(vertex,'source')?(key==='normal'?lod.rawNormals??lod.normals:key==='uv'?lod.rawUV??lod.uv:lod.positions).slice(vertex.source*size,(vertex.source+1)*size):vertex[key].map(Math.fround)));
  previewFallbacks(result);
  return result;
}
function previewFallbacks(result){
  delete result.rawNormals;delete result.rawUV;
  result.invalidNormals=result.normals.some(value=>!Number.isFinite(value));result.invalidUV=result.uv.some(value=>!Number.isFinite(value));
  if(result.invalidNormals){result.rawNormals=[...result.normals];result.normals.fill(0);}
  if(result.invalidUV){result.rawUV=[...result.uv];result.uv=result.uv.map(value=>Number.isFinite(value)?value:0);}
}
// Removal drops incident triangles explicitly, then remaps every surviving
// reference. Groups retain their order, including now-empty groups.
export function removeTopologyVertex(topology,index,changes=[]) {
  if(!Number.isInteger(index)||index<0||index>=topology.vertices.length)throw new Error('4DS: neplatný vrchol k odstranění.');
  return {topology:{vertices:topology.vertices.filter((_,i)=>i!==index),faces:topology.faces.map(face=>{const indices=[];for(let i=0;i<face.indices.length;i+=3){const triangle=face.indices.slice(i,i+3);if(!triangle.includes(index))indices.push(...triangle.map(value=>value>index?value-1:value));}return {material:face.material,indices};})},changes:changes.filter(change=>change.index!==index).map(change=>({...change,index:change.index>index?change.index-1:change.index}))};
}
