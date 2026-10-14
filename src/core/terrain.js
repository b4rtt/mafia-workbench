import { terrainModel } from '../shared/terrain.js';
import { parseFourDs } from './fourds.js';
import { parseBmp } from './bmp.js';
import { hash } from './files.js';

// 4DS v29 standard visual layout, independently written from documented fields.
// Only new assets are serialized; no existing or opaque model data is rebuilt.
export function createTerrainBytes(options){
  const model=terrainModel(options),mesh=model.meshes[0],lod=mesh.lods[0],material=model.materials[0],parts=[];
  const integers=(bytes,...values)=>{const b=Buffer.alloc(bytes*values.length);values.forEach((v,i)=>bytes===1?b.writeUInt8(v,i):bytes===2?b.writeUInt16LE(v,i*2):b.writeUInt32LE(v,i*4));parts.push(b);};
  const floats=values=>{const b=Buffer.alloc(values.length*4);values.forEach((v,i)=>b.writeFloatLE(v,i*4));parts.push(b);};
  const string=value=>{const b=Buffer.from(value,'ascii');integers(1,b.length);parts.push(b);};
  parts.push(Buffer.from('4DS\0'));integers(2,29);parts.push(Buffer.alloc(8));integers(2,1);integers(4,material.flags);
  floats([...material.ambient,...material.diffuse,...material.emission,material.opacity]);string(material.texture);
  integers(2,1);integers(1,mesh.type,mesh.visual,mesh.renderFlags,mesh.logicFlags);integers(2,mesh.parent);
  floats([...mesh.position,...mesh.scale,...mesh.rotation]);integers(1,mesh.culling);string(mesh.name);string('');
  integers(2,0);integers(1,1);floats([lod.distance]);integers(2,lod.vertices);
  for(let i=0;i<lod.vertices;i++)floats([...lod.positions.slice(i*3,i*3+3),...lod.normals.slice(i*3,i*3+3),...lod.uv.slice(i*2,i*2+2)]);
  integers(1,1);integers(2,lod.faces[0].indices.length/3);integers(2,...lod.faces[0].indices);integers(2,1);integers(1,0);
  const result=Buffer.concat(parts);parseFourDs(result,'all');return result;
}
export async function createTerrain(project,options,textureHash){
  const data=createTerrainBytes(options),asset=project.asset(options.texture),texture=await project.read(asset.path);
  if(hash(texture)!==textureHash)throw new Error('Terén: textura se od výběru změnila. Vyberte ji znovu.');
  parseBmp(texture);const target=`models/${options.name}.4ds`;
  await project.createFiles([{path:target,data}],`Nový terén ${options.name}`,[{path:asset.path,expectedHash:textureHash}],'Vlastní terén');
  return target;
}
