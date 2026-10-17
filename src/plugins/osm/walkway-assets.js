import {parseBmp} from '../../core/bmp.js';
import {hash} from '../../core/files.js';
import {validateOsmWalkways} from './walkways.js';

export async function loadOsmWalkwayTexture(project,options){
  validateOsmWalkways(options);const asset=project.asset(options.texture),bytes=await project.read(asset.path);parseBmp(bytes);const sha256=hash(bytes);
  if(options.textureHash!==undefined&&options.textureHash!==sha256)throw Error('OpenStreetMap · pěší cesty: uložená textura se změnila; zvolte ji znovu.');
  return {path:asset.path,sha256};
}
