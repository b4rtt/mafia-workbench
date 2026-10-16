import { roadSurfaceModel } from '../shared/road-surface.js';
import { writeSurfaceModel } from './surface-model.js';
import { parseFourDs } from './fourds.js';
import { parseRoads } from './roads.js';
import { parseBmp } from './bmp.js';
import { hash } from './files.js';

export function createRoadSurfaceBytes(file,options){
  const data=writeSurfaceModel(roadSurfaceModel(file,options));parseFourDs(data,'all');return data;
}
export async function createRoadSurface(project,name,options,expectedHash,textureHashes){
  if(typeof name!=='string'||!/^missions\/[^/]+\/road\.bin$/i.test(name))throw new Error('Ulice: vyberte road.bin mise.');
  const source=await project.read(name);
  if(hash(source)!==expectedHash)throw new Error('Ulice: silniční síť se změnila. Otevřete ji znovu.');
  const data=createRoadSurfaceBytes(parseRoads(source),options),dependencies=[{path:name,expectedHash}];
  for(const [index,texturePath]of [options.roadTexture,options.sidewalkTexture,options.curbTexture].entries()){
    const asset=project.asset(texturePath),texture=await project.read(asset.path),expectedHash=textureHashes?.[index];
    if(typeof expectedHash!=='string'||hash(texture)!==expectedHash)throw new Error('Ulice: textura se od výběru změnila. Vyberte ji znovu.');
    parseBmp(texture);dependencies.push({path:asset.path,expectedHash});
  }
  const target=`models/${options.name}.4ds`;
  const junction=options.mode==='junction';
  await project.createFiles([{path:target,data}],`${junction?'Nová křižovatka':'Nová ulice'} ${options.name}`,dependencies,junction?'Vlastní křižovatka':'Vlastní ulice');
  return target;
}
