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
  const result={...lod,positions:[...lod.positions],normals:[...lod.normals],uv:[...lod.uv]};
  for(const change of changes)for(const [key,array,size]of [['position','positions',3],['normal','normals',3],['uv','uv',2]])if(change[key])result[array].splice(change.index*size,size,...change[key].map(Math.fround));
  if(recompute)result.normals=geometryNormals(result.positions,lod.faces).map(Math.fround);
  return result;
}
