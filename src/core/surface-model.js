// New generated standard visuals only, never a serializer for existing 4DS.
// Shared by terrain, street surfaces and converted static OBJ parts.
export function writeSurfaceModel(model){
  const parts=[];
  const integers=(bytes,values)=>{const b=Buffer.alloc(bytes*values.length);values.forEach((v,i)=>bytes===1?b.writeUInt8(v,i):bytes===2?b.writeUInt16LE(v,i*2):b.writeUInt32LE(v,i*4));parts.push(b);};
  const floats=values=>{const b=Buffer.alloc(values.length*4);values.forEach((v,i)=>b.writeFloatLE(v,i*4));parts.push(b);};
  const string=value=>{const b=Buffer.from(value,'ascii');integers(1,[b.length]);parts.push(b);};
  parts.push(Buffer.from('4DS\0'));integers(2,[29]);parts.push(Buffer.alloc(8));integers(2,[model.materials.length]);
  for(const material of model.materials){integers(4,[material.flags]);floats([...material.ambient,...material.diffuse,...material.emission,material.opacity]);string(material.texture);if(material.texture&&(material.flags&0x40000000)&&!(material.flags&0x01000000))string(material.alphaTexture);}
  integers(2,[model.meshes.length]);
  for(const mesh of model.meshes){
    if(!Array.isArray(mesh.lods)||!mesh.lods.length||mesh.lods.length>10)throw Error('4DS: generovaný visual vyžaduje 1–10 LOD.');
    if(mesh.lods.length>1)for(const lod of mesh.lods){
      const finite=n=>Number.isFinite(n)&&Number.isFinite(Math.fround(n));
      if(!lod||!finite(lod.distance)||lod.distance<0||!Number.isInteger(lod.vertices)||lod.vertices<1||lod.vertices>60000||!Array.isArray(lod.positions)||lod.positions.length!==lod.vertices*3||!Array.isArray(lod.normals)||lod.normals.length!==lod.vertices*3||!Array.isArray(lod.uv)||lod.uv.length!==lod.vertices*2||[...lod.positions,...lod.normals,...lod.uv].some(n=>!finite(n))||!Array.isArray(lod.faces)||!lod.faces.length||lod.faces.length>255||Array.from(lod.faces).some(f=>!f||!Number.isInteger(f.material)||f.material<1||f.material>model.materials.length||!Array.isArray(f.indices)||f.indices.length%3||f.indices.length/3>65535||Array.from(f.indices).some(i=>!Number.isInteger(i)||i<0||i>=lod.vertices)))throw Error('4DS: neplatná geometrie generovaného LOD.');
    }
    integers(1,[mesh.type,mesh.visual,mesh.renderFlags,mesh.logicFlags]);integers(2,[mesh.parent]);
    floats([...mesh.position,...mesh.scale,...mesh.rotation]);integers(1,[mesh.culling]);string(mesh.name);string('');
    // Distances stay in raw native units; LOD0 remains first for KLZ links.
    integers(2,[0]);integers(1,[mesh.lods.length]);for(const lod of mesh.lods){floats([lod.distance]);integers(2,[lod.vertices]);
    const vertices=Buffer.alloc(lod.vertices*32);for(let i=0;i<lod.vertices;i++)[...lod.positions.slice(i*3,i*3+3),...lod.normals.slice(i*3,i*3+3),...lod.uv.slice(i*2,i*2+2)].forEach((v,j)=>vertices.writeFloatLE(v,i*32+j*4));parts.push(vertices);
    integers(1,[lod.faces.length]);for(const face of lod.faces){integers(2,[face.indices.length/3]);integers(2,face.indices);integers(2,[face.material]);}
    }
  }
  integers(1,[0]);
  return Buffer.concat(parts);
}
