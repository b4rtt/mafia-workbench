import { terrainModel } from '../shared/terrain.js';
import { Viewport } from './viewport.js';

export function terrainDialog({api,assets,element,run,onCreated}){
  const dialog=element('dialog',undefined,'terrain-dialog'),form=element('form'),fields=element('div',undefined,'mission-fields'),preview=element('div',undefined,'terrain-preview'),summary=element('p'),message=element('p','','notice');
  dialog.append(element('h2','Vytvořit vlastní terén'),form);form.append(fields,preview,summary,message,element('p','Výšky rohů se interpolují přes celou síť. Po vytvoření můžete upravit každý vrchol, normály a UV přes Vrcholy, plochy a UV… V misi vložte nový model a vyberte přesnou kolizi. Samotné vytvoření modelu nemění žádnou misi.'));
  const field=(label,input)=>{const row=element('label',label);input.setAttribute('aria-label',label);row.append(input);fields.append(row);return input;};
  const name=field('Název modelu bez přípony',element('input'));name.value='WB_TERRAIN';name.required=true;name.maxLength=80;
  const texture=field('Textura terénu',element('input'));texture.required=true;texture.setAttribute('list','terrain-textures');const list=element('datalist');list.id='terrain-textures';
  for(const asset of assets.filter(a=>/^maps\/[^/]+\.bmp$/i.test(a.path))){const option=element('option');option.value=asset.path;list.append(option);}fields.append(list);
  function numeric(label,value,min,max,step='any'){const input=field(label,element('input'));input.type='number';input.required=true;input.value=String(value);input.min=String(min);input.max=String(max);input.step=step;return input;}
  const width=numeric('Šířka X (m)',40,.01,8192),depth=numeric('Délka Z (m)',40,.01,8192),columns=numeric('Počet polí X',16,1,128,'1'),rows=numeric('Počet polí Z',16,1,128,'1'),tileSize=numeric('Velikost opakování textury (m)',4,.01,8192);
  const heights=['Výška rohu −X / −Z (m)','Výška rohu +X / −Z (m)','Výška rohu −X / +Z (m)','Výška rohu +X / +Z (m)'].map(label=>numeric(label,0,-32768,32768));
  const actions=element('div',undefined,'tools'),cancel=element('button','Zrušit'),save=element('button','Vytvořit terén','primary');cancel.type='button';save.type='submit';save.disabled=true;actions.append(cancel,save);form.append(actions);
  let textureHash=null,textureName='',revision=0,closed=false,view=null;
  const options=()=>({name:name.value,texture:texture.value,width:Number(width.value),depth:Number(depth.value),columns:Number(columns.value),rows:Number(rows.value),tileSize:Number(tileSize.value),heights:heights.map(input=>Number(input.value))});
  function update(){
    save.disabled=true;view?.dispose();view=null;preview.replaceChildren();summary.textContent='';
    try{
      if([...form.querySelectorAll('input')].some(input=>!input.value.trim()||!input.validity.valid))throw new Error('Vyplňte platné rozměry, výšky a texturu.');
      const model=terrainModel(options()),lod=model.meshes[0].lods[0];
      if(assets.some(asset=>asset.path.toLowerCase()===`models/${name.value}.4ds`.toLowerCase()))throw new Error('Model tohoto názvu už existuje. Zvolte nový název.');
      summary.textContent=`${lod.vertices.toLocaleString('cs')} vrcholů · ${(lod.faces[0].indices.length/3).toLocaleString('cs')} trojúhelníků · nativní 4DS v29`;
      if(textureName!==texture.value||!textureHash)throw new Error('Vyberte existující BMP texturu a počkejte na její kontrolu.');
      view=new Viewport(preview);view.addModel(model);view.fit();view.loadTextures(()=>api.media(textureName));message.textContent='Nový model se uloží do projektu s jedním undo. Textura zůstane beze změny.';save.disabled=false;
    }catch(error){message.textContent=error.message;}
  }
  async function loadTexture(){const version=++revision;textureHash=null;textureName='';update();try{const asset=assets.find(a=>a.path.toLowerCase()===texture.value.toLowerCase());if(!asset)throw new Error('Textura v projektu neexistuje.');const file=await api.inspect(asset.path);if(closed||version!==revision)return;if(!file.bitmap||file.warning)throw new Error(file.warning||'Vyberte platnou BMP texturu.');texture.value=asset.path;textureName=asset.path;textureHash=file.sha256;update();}catch(error){if(!closed&&version===revision)message.textContent=error.message;}}
  texture.oninput=loadTexture;for(const input of [name,width,depth,columns,rows,tileSize,...heights])input.oninput=update;
  cancel.onclick=()=>dialog.close();form.onsubmit=event=>{event.preventDefault();if(save.disabled||!form.reportValidity())return;run(async()=>{save.disabled=cancel.disabled=true;fields.inert=true;try{const result=await api.createTerrain(options(),textureHash);dialog.close();await onCreated(result);}catch(error){message.textContent=error.message;}finally{fields.inert=false;cancel.disabled=false;if(!closed)save.disabled=false;}});};
  dialog.addEventListener('cancel',event=>{if(cancel.disabled)event.preventDefault();});dialog.addEventListener('close',()=>{closed=true;revision++;view?.dispose();dialog.remove();},{once:true});document.body.append(dialog);dialog.showModal();name.focus();name.select();update();
}
