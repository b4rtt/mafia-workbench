// New generated standard visuals only, never a serializer for existing 4DS.
// Shared by terrain and street surfaces so their material/face layouts agree.
export function writeSurfaceModel(model){
  const mesh=model.meshes[0],lod=mesh.lods[0],parts=[];
  const integers=(bytes,values)=>{const b=Buffer.alloc(bytes*values.length);values.forEach((v,i)=>bytes===1?b.writeUInt8(v,i):bytes===2?b.writeUInt16LE(v,i*2):b.writeUInt32LE(v,i*4));parts.push(b);};
  const floats=values=>{const b=Buffer.alloc(values.length*4);values.forEach((v,i)=>b.writeFloatLE(v,i*4));parts.push(b);};
  const string=value=>{const b=Buffer.from(value,'ascii');integers(1,[b.length]);parts.push(b);};
  parts.push(Buffer.from('4DS\0'));integers(2,[29]);parts.push(Buffer.alloc(8));integers(2,[model.materials.length]);
  for(const material of model.materials){integers(4,[material.flags]);floats([...material.ambient,...material.diffuse,...material.emission,material.opacity]);string(material.texture);}
  integers(2,[1]);integers(1,[mesh.type,mesh.visual,mesh.renderFlags,mesh.logicFlags]);integers(2,[mesh.parent]);
  floats([...mesh.position,...mesh.scale,...mesh.rotation]);integers(1,[mesh.culling]);string(mesh.name);string('');
  integers(2,[0]);integers(1,[1]);floats([lod.distance]);integers(2,[lod.vertices]);
  for(let i=0;i<lod.vertices;i++)floats([...lod.positions.slice(i*3,i*3+3),...lod.normals.slice(i*3,i*3+3),...lod.uv.slice(i*2,i*2+2)]);
  integers(1,[lod.faces.length]);for(const face of lod.faces){integers(2,[face.indices.length/3]);integers(2,face.indices);integers(2,[face.material]);}integers(1,[0]);
  return Buffer.concat(parts);
}
