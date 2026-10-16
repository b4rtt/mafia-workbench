import { roadConnections } from '../shared/roads.js';
import { roadSurfaceModel } from '../shared/road-surface.js';
import { Viewport } from './viewport.js';

export function roadSurfaceDialog(file,from,{api,assets,element,run,onCreated}){
  const dialog=element('dialog',undefined,'terrain-dialog'),form=element('form'),fields=element('div',undefined,'mission-fields'),preview=element('div',undefined,'terrain-preview'),summary=element('p'),message=element('p','','notice');
  dialog.append(element('h2','Vytvořit vozovku a chodníky'),form);form.append(fields,preview,summary,message,element('p','Vytvoří samostatný 4DS podle uložené sítě. Do této mise ho vložte jako statický model s pozicí XYZ = 0, rotací WXYZ = 1, 0, 0, 0, měřítkem = 1 a přesnou oboustrannou kolizí. Model už obsahuje světové souřadnice. Změna sítě model automaticky nepřestaví.'));
  const field=(label,input)=>{const row=element('label',label);input.setAttribute('aria-label',label);row.append(input);fields.append(row);return input;};
  const name=field('Název modelu bez přípony',element('input'));name.value=`WB_STREET_${from}`;name.required=true;name.maxLength=80;
  const mode=field('Část povrchu',element('select'));for(const [value,label]of [['link','Ulice mezi dvěma křižovatkami'],['junction','Střed křižovatky se třemi nebo čtyřmi výjezdy']]){const option=element('option',label);option.value=value;mode.append(option);}
  const route=field('Silniční propojení',element('select'));
  for(const link of roadConnections(file,from)){const option=element('option',`Křižovatka ${from} → ${link.target} · výjezd ${link.slot} · ${link.nodes.length} mezilehlých bodů`);option.value=String(link.slot);route.append(option);}
  const join=field('Napojit konce ulice na povrchy křižovatek',element('input'));join.type='checkbox';join.checked=true;
  const textures=['Textura vozovky','Textura chodníků','Textura obrubníků'].map(label=>{const input=field(label,element('input'));input.required=true;input.setAttribute('list','street-textures');return input;});
  const list=element('datalist');list.id='street-textures';for(const asset of assets.filter(a=>/^maps\/[^/]+\.bmp$/i.test(a.path))){const option=element('option');option.value=asset.path;list.append(option);}fields.append(list);
  function numeric(label,value,min,max){const input=field(label,element('input'));input.type='number';input.required=true;input.value=String(value);input.min=String(min);input.max=String(max);input.step='any';return input;}
  const width=numeric('Šířka vozovky (m)',6,.1,100),sidewalkWidth=numeric('Šířka každého chodníku (m)',2,.1,20),curbHeight=numeric('Výška obrubníku (m)',.15,.01,1),roadTileLength=numeric('Opakování vozovky podél trasy (m)',12,.1,100),roadTileWidth=numeric('Opakování vozovky napříč (m)',6,.1,100),sidewalkTileSize=numeric('Velikost dlaždice chodníku (m)',2,.1,100),curbTileLength=numeric('Opakování obrubníku podél trasy (m)',1,.1,100),heightOffset=numeric('Výškový posun vůči trase (m)',0,-100,100);
  const actions=element('div',undefined,'tools'),cancel=element('button','Zrušit'),save=element('button','Vytvořit ulici','primary');cancel.type='button';save.type='submit';save.disabled=true;actions.append(cancel,save);form.append(actions);
  const hashes=[null,null,null],names=['','',''],revisions=[0,0,0];let closed=false,view=null,saving=false;
  const options=()=>({name:name.value,mode:mode.value,joinJunctions:join.checked,from,slot:Number(route.value),roadTexture:textures[0].value,sidewalkTexture:textures[1].value,curbTexture:textures[2].value,width:Number(width.value),sidewalkWidth:Number(sidewalkWidth.value),curbHeight:Number(curbHeight.value),roadTileLength:Number(roadTileLength.value),roadTileWidth:Number(roadTileWidth.value),curbTileLength:Number(curbTileLength.value),sidewalkTileSize:Number(sidewalkTileSize.value),heightOffset:Number(heightOffset.value)});
  function update(){
    if(closed||saving)return;save.disabled=true;save.textContent=mode.value==='junction'?'Vytvořit křižovatku':'Vytvořit ulici';view?.dispose();view=null;preview.replaceChildren();summary.textContent='';
    try{
      if([...form.querySelectorAll('input:not([type=checkbox])')].some(input=>!input.value.trim()||!input.validity.valid))throw new Error('Vyplňte platné rozměry a všechny tři textury.');
      const model=roadSurfaceModel(file,options()),lod=model.meshes[0].lods[0];
      if(assets.some(asset=>asset.path.toLowerCase()===`models/${name.value}.4ds`.toLowerCase()))throw new Error('Model tohoto názvu už existuje. Zvolte nový název.');
      summary.textContent=`${mode.value==='junction'?'Křižovatka':'Ulice'} · ${lod.vertices.toLocaleString('cs')} vrcholů · ${lod.faces.reduce((sum,face)=>sum+face.indices.length/3,0).toLocaleString('cs')} trojúhelníků · vozovka ${width.value} m + chodníky ${sidewalkWidth.value} m`;
      if(textures.some((input,i)=>names[i]!==input.value||!hashes[i]))throw new Error('Vyberte existující BMP textury a počkejte na jejich kontrolu.');
      view=new Viewport(preview);view.addModel(model);view.fit();const current=view;
      current.loadTextures(texture=>{const index=names.findIndex(name=>name.slice(5).toLowerCase()===texture.toLowerCase());return index<0?null:api.media(names[index]);}).catch(error=>{if(!closed&&view===current)message.textContent=error.message;});
      message.textContent=(mode.value==='junction'?'Střed je vodorovný ve výšce křižovatky. Každou navazující ulici vytvořte se zapnutým napojením a se stejnými rozměry a výškovým posunem.':join.checked?'Konce u tří a čtyřramenných křižovatek jsou zkrácené. Jejich středy vytvořte zvlášť se stejnými rozměry a výškovým posunem; jinak zůstanou mezery.':'Ulice sahá až ke středům; kolem ní nepřidávejte další překrývající se povrch křižovatky.')+' Textury mají měřítko v metrech. Značení v křižovatce se automaticky negeneruje; na hranicích materiálů může být šev. Rozměry jsou ruční. Jeden undo odstraní nový model.';save.disabled=false;
    }catch(error){message.textContent=error.message;}
  }
  async function loadTexture(index){
    const version=++revisions[index];hashes[index]=null;names[index]='';update();
    try{const asset=assets.find(a=>a.path.toLowerCase()===textures[index].value.toLowerCase());if(!asset)throw new Error('Textura v projektu neexistuje.');const bitmap=await api.inspect(asset.path);if(closed||version!==revisions[index])return;if(!bitmap.bitmap||bitmap.warning)throw new Error(bitmap.warning||'Vyberte platnou BMP texturu.');textures[index].value=asset.path;names[index]=asset.path;hashes[index]=bitmap.sha256;update();}
    catch(error){if(!closed&&version===revisions[index])message.textContent=error.message;}
  }
  textures.forEach((input,index)=>input.oninput=()=>loadTexture(index));route.onchange=join.onchange=update;mode.onchange=()=>{route.disabled=mode.value==='junction';join.disabled=mode.value==='junction';update();};for(const input of [name,width,sidewalkWidth,curbHeight,roadTileLength,roadTileWidth,sidewalkTileSize,curbTileLength,heightOffset])input.oninput=update;
  cancel.onclick=()=>dialog.close();form.onsubmit=event=>{event.preventDefault();if(save.disabled||!form.reportValidity())return;run(async()=>{saving=true;save.disabled=cancel.disabled=true;fields.inert=true;let errorMessage;try{const result=await api.createRoadSurface(file.path,options(),file.sha256,[...hashes]);dialog.close();await onCreated(result);}catch(error){errorMessage=error.message;}finally{saving=false;fields.inert=false;cancel.disabled=false;if(!closed){update();if(errorMessage)message.textContent=errorMessage;}}});};
  dialog.addEventListener('cancel',event=>{if(saving)event.preventDefault();});dialog.addEventListener('close',()=>{closed=true;view?.dispose();dialog.remove();},{once:true});document.body.append(dialog);dialog.showModal();name.focus();name.select();update();
  // Actual original city textures when available; missing assets remain a choice.
  ['maps/^sl_6m02.bmp','maps/^chdnk01.bmp','maps/^obrub01.bmp'].forEach((path,index)=>{const asset=assets.find(a=>a.path.toLowerCase()===path);if(asset){textures[index].value=asset.path;loadTexture(index);}});
}
