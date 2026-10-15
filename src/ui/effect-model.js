import { EffectModelViewport } from './effect-model-preview.js';

export function effectModelDialog({element,api,assets,file,type,run,onSaved}) {
  const modelEntry=type.entries.find(entry=>entry.key==='model'),emitters=type.children.map(node=>({node,entry:node.entries.find(entry=>entry.key==='frame')}));
  if(!modelEntry||modelEntry.readOnly||!emitters.length||emitters.some(({entry})=>!entry||entry.readOnly))throw Error('Tento typ nemá úplné upravitelné modelové vazby.');
  const dialog=element('dialog',undefined,'light-dialog effect-model-dialog'),form=element('form',undefined,'mission-form'),fields=element('div',undefined,'mission-fields'),model=element('select'),message=element('p','','notice'),save=element('button','Uložit vazby','primary'),cancel=element('button','Zrušit'),reload=element('button','Načíst části znovu'),actions=element('div',undefined,'tools');
  const row=(caption,input)=>{const label=element('label',caption);input.setAttribute('aria-label',caption);label.append(input);fields.append(label);};
  row('Model částic',model);
  const models=assets.filter(asset=>/^models\/[^/\\]+\.4ds$/i.test(asset.path)).sort((a,b)=>a.path.localeCompare(b.path)),canonical=modelEntry.value.replace(/\.i3d$/i,'.4ds').toLowerCase();
  for(const asset of models){const name=asset.path.slice(7),option=element('option',name);option.value=name.toLowerCase()===canonical?modelEntry.value:name.replace(/\.4ds$/i,'.I3D');model.append(option);}
  if(![...model.options].some(option=>option.value===modelEntry.value)){const option=element('option',modelEntry.value+' · nedostupný');option.value=modelEntry.value;model.append(option);}
  model.value=modelEntry.value;
  const rows=emitters.map(({node,entry},i)=>{const select=element('select');row(`Emitor ${i+1}${node.name?' · '+node.name:''} · část modelu`,select);return {entry,select};});
  const workspace=element('div',undefined,'effect-model-workspace'),preview=element('section'),tools=element('div',undefined,'tools'),active=element('select'),whole=element('input'),wholeLabel=element('label','Celý model '),fit=element('button','Přiblížit část'),area=element('div',undefined,'viewport'),caption=element('p','','notice');
  active.setAttribute('aria-label','Náhled emitoru');rows.forEach((row,i)=>{const option=element('option',`Emitor ${i+1}${emitters[i].node.name?' · '+emitters[i].node.name:''}`);option.value=String(i);active.append(option);});
  whole.type='checkbox';wholeLabel.append(whole);fit.type='button';tools.append(active,wholeLabel,fit);preview.append(tools,area,caption,element('p','Statická část v původní poloze modelu, LOD 0. V celém modelu ji zvýrazňuje oranžový obrys. Kliknutím na jinou část ji přiřadíte emitoru vybranému v náhledu. Pohyb, emise a fáze částic se zde nesimulují.','notice'));workspace.append(fields,preview);
  let loaded=null,revision=0,closed=false,saving=false,view=null,frames=[];
  const changes=()=>[{id:modelEntry.id,value:model.value},...rows.map(({entry,select})=>({id:entry.id,value:select.value}))].filter(change=>change.value!==[modelEntry,...rows.map(row=>row.entry)].find(entry=>entry.id===change.id).value);
  function update(){save.disabled=saving||!loaded||rows.some(({select})=>!select.value)||!changes().length;}
  function showPart(focus=false){
    const index=Number(active.value),name=rows[index].select.value,frame=frames.find(frame=>frame.name===name);
    fit.disabled=!view||!frame;whole.disabled=!view;
    if(!view)return;
    view.showPart(frame?.id??'',whole.checked);
    caption.textContent=frame?`Emitor ${index+1} · ${frame.name}`:'Vyberte část modelu pro tento emitor.';
    if(focus&&frame)view.fitPart();else if(focus&&whole.checked)view.fit();
  }
  active.onchange=()=>showPart(true);whole.onchange=()=>{showPart();if(whole.checked)view?.fit();else view?.fitPart();};fit.onclick=()=>view?.fitPart();
  const resolveTexture=async texture=>{const name=texture.replaceAll('\\','/').toLowerCase(),asset=assets.find(asset=>asset.path.toLowerCase()===`maps/${name}`||asset.path.toLowerCase()===name);return asset?api.media(asset.path):null;};
  async function load(){
    const token=++revision,selected=model.value,previous=rows.map(({entry,select})=>select.value||entry.value);loaded=null;update();message.textContent='Načítám části vybraného modelu…';
    view?.dispose();view=null;frames=[];fit.disabled=whole.disabled=true;caption.textContent='Načítám 3D náhled…';
    for(const {select}of rows){select.replaceChildren();select.disabled=true;}
    try{
      const asset=models.find(asset=>asset.path.slice(7).toLowerCase()===selected.replace(/\.i3d$/i,'.4ds').toLowerCase());
      if(!asset)throw Error('Model není v projektu. Nejprve jej importujte.');
      const result=await api.inspect(asset.path);if(closed||token!==revision)return;
      if(result.type!=='model')throw Error('Model nelze načíst podporovaným 4DS čtečem.');
      const counts=new Map();for(const mesh of result.meshes)counts.set(mesh.name,(counts.get(mesh.name)??0)+1);
      frames=result.meshes.filter(mesh=>mesh.type===1&&mesh.name.trim()&&counts.get(mesh.name)===1);
      if(!frames.length)throw Error('Model neobsahuje jednoznačně pojmenovanou vykreslovanou část.');
      rows.forEach(({select},i)=>{const empty=element('option','Vyberte část modelu…');empty.value='';select.append(empty);for(const mesh of frames){const option=element('option',mesh.name);option.value=mesh.name;select.append(option);}select.value=frames.some(mesh=>mesh.name===previous[i])?previous[i]:'';select.disabled=false;});
      loaded={path:result.path,sha256:result.sha256};message.textContent=`${frames.length} dostupných částí. Vyberte část pro každý emitor; změna ovlivní všechny mise používající tento typ.`;update();
      try{
        view=new EffectModelViewport(area,frame=>{if(saving||!frames.some(part=>part.id===frame.sourceId))return;rows[Number(active.value)].select.value=frame.name;showPart();update();});
        view.load(result);showPart(true);if(!rows[Number(active.value)].select.value){whole.checked=true;showPart();view.fit();}
        void view.loadTextures(resolveTexture);
      }catch(error){view?.dispose();view=null;fit.disabled=whole.disabled=true;caption.textContent='3D náhled není dostupný: '+error.message;}
    }catch(error){if(!closed&&token===revision){message.textContent=error.message;caption.textContent='3D náhled není dostupný.';update();}}
  }
  model.onchange=()=>void load();rows.forEach(({select},i)=>{select.onfocus=()=>{active.value=String(i);showPart();};select.onchange=()=>{active.value=String(i);showPart(true);update();};});
  cancel.type=reload.type='button';save.type='submit';cancel.onclick=()=>dialog.close();reload.onclick=()=>void load();actions.append(reload,cancel,save);
  form.append(workspace,message,element('p','Model se nemění. Ukládají se pouze názvy modelu a jeho částí do společné tabulky efektů, se zálohou a jedním undo. Po úpravě hru znovu načtěte.','notice'),actions);dialog.append(element('h2',`Model a části · ${type.name||'Typ '+type.index}`),form);
  form.onsubmit=event=>{event.preventDefault();if(save.disabled)return;run(async()=>{saving=true;form.inert=true;try{const result=await api.saveEffectDefinitions(file.path,changes(),file.sha256,{modelHashes:{[loaded.path]:loaded.sha256}});dialog.close();await onSaved(result);}catch(error){message.textContent=error.message;}finally{saving=false;form.inert=false;update();}});};
  dialog.addEventListener('cancel',event=>{if(saving)event.preventDefault();});dialog.addEventListener('close',()=>{closed=true;revision++;view?.dispose();view=null;dialog.remove();},{once:true});document.body.append(dialog);dialog.showModal();model.focus();void load();
}
