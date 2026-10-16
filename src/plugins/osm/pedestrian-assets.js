import {parseFourDs} from '../../core/fourds.js';
import {hash} from '../../core/files.js';
import {validateOsmPedestrians} from './pedestrians.js';

export async function loadOsmPedestrianModels(project,saved){
  if(saved)validateOsmPedestrians(saved);
  const models=[],warnings=[];
  for(const asset of project.manifest.assets.filter(a=>/^models\/civil\d+\.4ds$/i.test(a.path)&&(!saved||saved.models.some(m=>m.path.toLowerCase()===a.path.toLowerCase())))){
    try{
      const bytes=await project.read(asset.path),model=asset.path.slice(7,-4)+'.i3d';
      if(model.length>16||!parseFourDs(bytes).meshes.some(m=>m.type===10))throw Error('Chybí podporovaná kostra nebo je název příliš dlouhý.');
      const item={path:asset.path,model,sha256:hash(bytes)};
      if(saved&&!saved.models.some(m=>m.path.toLowerCase()===item.path.toLowerCase()&&m.model===item.model&&m.sha256===item.sha256))throw Error('Model se změnil; načtěte katalog znovu.');
      models.push(item);
    }catch(error){warnings.push(`${asset.path}: ${error.message}`);}
  }
  if(saved&&(warnings.length||models.length!==saved.models.length))throw Error('OpenStreetMap · chodci: '+(warnings.join(' ')||'Vybrané modely nejsou dostupné.'));
  models.sort((a,b)=>a.path.localeCompare(b.path,'en',{numeric:true}));return {models,warnings,dependencies:models.map(m=>({path:m.path,expectedHash:m.sha256}))};
}
