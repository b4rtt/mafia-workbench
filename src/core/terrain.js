import { terrainModel } from '../shared/terrain.js';
import { parseFourDs } from './fourds.js';
import { parseBmp } from './bmp.js';
import { hash } from './files.js';
import { writeSurfaceModel } from './surface-model.js';

// 4DS v29 standard visual layout, independently written from documented fields.
// Only new assets are serialized; no existing or opaque model data is rebuilt.
export function createTerrainBytes(options){
  const result=writeSurfaceModel(terrainModel(options));parseFourDs(result,'all');return result;
}
export async function createTerrain(project,options,textureHash){
  const data=createTerrainBytes(options),asset=project.asset(options.texture),texture=await project.read(asset.path);
  if(hash(texture)!==textureHash)throw new Error('Terén: textura se od výběru změnila. Vyberte ji znovu.');
  parseBmp(texture);const target=`models/${options.name}.4ds`;
  await project.createFiles([{path:target,data}],`Nový terén ${options.name}`,[{path:asset.path,expectedHash:textureHash}],'Vlastní terén');
  return target;
}
