import {parseVehicleTable,vehicleModelDefinition,validateVehicleModel} from '../../core/vehicles.js';
import {parseFourDs} from '../../core/fourds.js';
import {modelCollisionBox} from '../../core/model-collision.js';
import {hash} from '../../core/files.js';
import {validateOsmTraffic} from './traffic.js';
export async function loadOsmTrafficModels(project,saved){
  if(saved)validateOsmTraffic(saved);
  const tablePath=project.asset('tables/vehicles.bin').path,bytes=await project.read(tablePath),table=parseVehicleTable(bytes),tableHash=hash(bytes),models=[],warnings=[];
  if(saved&&saved.tableHash!==tableHash)throw Error('OpenStreetMap · doprava: fyzikální tabulka aut se změnila; načtěte katalog znovu.');
  const candidates=project.manifest.assets.filter(a=>/^models\/[a-zA-Z0-9_ -]+10\.4ds$/i.test(a.path)&&(!saved||saved.models.some(m=>m.path.toLowerCase()===a.path.toLowerCase())));
  for(const asset of candidates){
    const definition=vehicleModelDefinition(table,asset.path);if(!definition||definition.variant!==10||definition.table.length>19)continue;
    try{
      const data=await project.read(asset.path),model=parseFourDs(data,true);validateVehicleModel(model);
      const object={name:'CAR',frameType:9,model:asset.path,position:[0,0,0],rotation:[1,0,0,0],scale:[1,1,1]},bounds=modelCollisionBox(model,object,{objects:[object]},{meshes:[]}),width=bounds.max[0]-bounds.min[0];if(width<.5||width>5)throw Error('Neplatná šířka automobilu.');
      const item={path:asset.path,table:definition.table,sha256:hash(data),width};
      if(saved){const previous=saved.models.find(m=>m.path.toLowerCase()===asset.path.toLowerCase());if(previous.sha256!==item.sha256||previous.table!==item.table||previous.width!==item.width)throw Error('Model nebo rozměry auta se změnily; načtěte katalog znovu.');}
      models.push(item);
    }catch(error){warnings.push(`${asset.path}: ${error.message}`);}
  }
  if(saved&&(warnings.length||models.length!==saved.models.length))throw Error('OpenStreetMap · doprava: '+(warnings.join(' ')||'Některá vybraná auta nejsou dostupná.'));
  models.sort((a,b)=>a.table.localeCompare(b.table,'en'));return {models,tableHash,warnings,dependencies:[{path:tablePath,expectedHash:tableHash},...models.map(m=>({path:m.path,expectedHash:m.sha256}))]};
}
