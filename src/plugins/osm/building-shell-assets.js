import {osmShellStyles} from './building-shells.js';
import {parseBmp} from '../../core/bmp.js';
import {hash} from '../../core/files.js';

export async function loadOsmShellStyles(project,saved=null){
  if(saved!==null&&(!Array.isArray(saved)||!saved.length||saved.length>osmShellStyles.length||new Set(saved.map(s=>s?.id)).size!==saved.length||saved.some(s=>!osmShellStyles.some(r=>r.id===s?.id))))throw Error('OpenStreetMap · půdorysné domy: neplatné styly.');
  const styles=[],warnings=[];
  for(const recipe of osmShellStyles.filter(r=>saved===null||saved.some(s=>s.id===r.id)))try{
    const textures=[];for(const path of recipe.textures){const asset=project.asset(path),bytes=await project.read(asset.path);parseBmp(bytes);textures.push({path:asset.path,sha256:hash(bytes)});}
    const expected=saved?.find(s=>s.id===recipe.id);
    if(expected&&(!Array.isArray(expected.textures)||expected.textures.length!==textures.length||textures.some((t,i)=>expected.textures[i]?.path?.toLowerCase()!==t.path.toLowerCase()||expected.textures[i]?.sha256!==t.sha256)))throw Error('textury se změnily; načtěte styly znovu.');
    styles.push({id:recipe.id,label:recipe.label,textures});
  }catch(error){if(saved!==null)throw Error(`OpenStreetMap · půdorysné domy: ${recipe.label}: ${error.message}`);warnings.push(`${recipe.label}: ${error.message}`);}
  return {styles,warnings};
}
