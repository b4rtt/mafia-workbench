import {parseBmp} from '../../core/bmp.js';
import {hash} from '../../core/files.js';
import {validateOsmGreenOptions} from './green-areas.js';

export async function loadOsmGreenTextures(project,options){
  validateOsmGreenOptions(options);const textures=[];
  for(const path of [options.texture,options.pathTexture]){const asset=project.asset(path),bytes=await project.read(asset.path);parseBmp(bytes);const sha256=hash(bytes);if(options.textures&&options.textures.find(t=>t.path.toLowerCase()===path.toLowerCase())?.sha256!==sha256)throw Error('OpenStreetMap · zeleň: uložené textury se změnily; zvolte čerstvý podklad a ověřte je znovu.');textures.push({path:asset.path,sha256});}
  return textures;
}
