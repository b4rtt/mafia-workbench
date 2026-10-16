import {osmArea,osmMapLocation,osmRoadPlan,osmProviders} from './area.js';
import {osmSurfaceDefaults,osmSurfaceModel} from './surface.js';
import {osmRoadProfile} from './profiles.js';

// The host supplies project access; this plugin never reads game files directly.
export function osmDialog({api,element,assets,onCreated,setBusy=()=>{}}){
  const dialog=element('dialog',undefined,'osm-dialog'),form=element('form'),location=element('div',undefined,'osm-location'),body=element('div',undefined,'osm-body'),preview=element('canvas'),list=element('div',undefined,'osm-ways'),message=element('p','','notice'),summary=element('p'),actions=element('div',undefined,'tools');
  const controls=[],field=(label,input,parent=location)=>{const row=element('label',label);row.append(input);parent.append(row);controls.push(input);return input;};
  const numeric=(label,value,min,max,parent=location)=>{const input=element('input');input.type='number';input.step='any';input.value=String(value);input.min=String(min);input.max=String(max);input.required=true;return field(label,input,parent);};
  const latitude=numeric('Zeměpisná šířka',50.087,-80,80),longitude=numeric('Zeměpisná délka',14.420,-179.9,179.9),size=numeric('Velikost čtverce (m)',200,50,450);
  const url=element('input');url.type='url';url.placeholder='https://www.openstreetmap.org/#map=…';field('Nebo vložte odkaz na oblast OSM',url);
  const provider=element('select');for(const[id,item]of Object.entries(osmProviders)){const option=element('option',item.name);option.value=id;provider.append(option);}field('Server pro stažení podkladu',provider);
  const buttons=element('div',undefined,'tools'),load=element('button','Načíst oblast'),open=element('button','Otevřít uložený podklad…'),all=element('button','Vybrat ulice'),none=element('button','Zrušit výběr'),template=element('button','Vybrat Empty_Mission.zip…'),cancel=element('button','Zavřít'),create=element('button','Vytvořit misi se sítí ulic','primary');
  for(const button of [load,open,all,none,template,cancel])button.type='button';create.type='submit';controls.push(load,open,all,none,template,cancel);
  const config=element('div',undefined,'osm-location'),name=element('input'),model=element('select');name.value='OSM_CITY';name.required=true;name.maxLength=48;name.pattern='[a-zA-Z0-9][a-zA-Z0-9_-]{0,47}';field('Název nové mise',name,config);field('Model hráče (s kostrou)',model,config);
  for(const asset of assets.filter(a=>/^models\/[^/]+\.4ds$/i.test(a.path))){const option=element('option',asset.path.slice(7));option.value=asset.path;model.append(option);}const tommy=[...model.options].find(o=>o.value.toLowerCase()==='models/tommy.4ds');if(tommy)model.value=tommy.value;
  const surfaceConfig=element('details'),surfaceTitle=element('summary','Povrchy ulic a kolize'),generate=element('input'),surfaceFields=element('div',undefined,'osm-location');generate.type='checkbox';field('Vytvořit vozovky, chodníky a přesné kolize',generate,surfaceConfig);
  const surfaceInputs={},defaults=osmSurfaceDefaults;
  for(const[key,label,checked]of [['useOsmTags','Použít dostupné šířky a strany chodníků z OSM',true],['estimateLanes','Chybějící šířku odhadnout z počtu pruhů',false]]){const input=element('input');input.type='checkbox';input.checked=checked;surfaceInputs[key]=field(label,input,surfaceFields);}
  for(const[key,label,min,max]of [['width','Náhradní šířka vozovky (m)',2,20],['sidewalkWidth','Náhradní šířka chodníku (m)',.5,5],['laneWidth','Šířka pruhu pro volitelný odhad (m)',2,4.5],['curbHeight','Výška obrubníku (m)',.05,.4],['tileSize','Opakování asfaltu (m)',.25,20],['sidewalkTileSize','Opakování dlažby (m)',.25,10]])surfaceInputs[key]=numeric(label,defaults[key],min,max,surfaceFields);
  const sidewalks=element('select');for(const[value,label]of [['both','Na obou stranách'],['left','Pouze vlevo'],['right','Pouze vpravo'],['none','Bez chodníků']]){const option=element('option',label);option.value=value;sidewalks.append(option);}surfaceInputs.sidewalks=field('Náhradní profil chodníků ve směru OSM cesty',sidewalks,surfaceFields);
  const textures=element('datalist');textures.id='osm-surface-textures';for(const asset of assets.filter(a=>/^maps\/[^/]+\.bmp$/i.test(a.path))){const option=element('option');option.value=asset.path;textures.append(option);}
  for(const[key,label]of [['roadTexture','Asfalt · BMP'],['sidewalkTexture','Chodník · BMP'],['curbTexture','Obrubník · BMP']]){const input=element('input');input.setAttribute('list',textures.id);input.value=assets.find(a=>a.path.toLowerCase()===defaults[key].toLowerCase())?.path??defaults[key];surfaceInputs[key]=field(label,input,surfaceFields);}
  generate.checked=['roadTexture','sidewalkTexture','curbTexture'].every(key=>assets.some(a=>a.path.toLowerCase()===surfaceInputs[key].value.toLowerCase()));surfaceConfig.prepend(surfaceTitle);surfaceConfig.append(element('p','Původ každého profilu a nejasné údaje jsou uvedené u ulic. L/P znamená strany ve směru OSM cesty, i u opačné jednosměrky. Samostatně mapované chodníky zatím používají výslovně označený náhradní profil. Povrch je rovinný; budovy, výšky, značení a provoz se negenerují.'),surfaceFields,textures);
  const surfaceSettings=()=>Object.fromEntries(Object.entries(surfaceInputs).map(([key,input])=>[key,input.type==='checkbox'?input.checked:input.type==='number'?Number(input.value):input.value]));
  preview.setAttribute('aria-label','Mapa vybrané oblasti: sever nahoře, modré ulice k importu, šedé budovy');preview.width=800;preview.height=600;
  const map=element('div',undefined,'osm-map');map.append(preview,element('small','Sever ↑ · modrá: vybrané ulice · šedá: půdorysy budov · oranžová: vynechané komunikace'));
  const sidebar=element('div',undefined,'osm-selection');sidebar.append(element('h3','Ulice v oblasti'),buttons,list);buttons.append(all,none);body.append(map,sidebar);actions.append(cancel,create);
  const attribution=element('p',undefined,'osm-attribution'),credit=element('a','© OpenStreetMap contributors · ODbL 1.0');credit.href='https://www.openstreetmap.org/copyright';attribution.append(credit);
  form.append(location,element('div',undefined,'tools'),summary,body,config,surfaceConfig,template,message,actions);form.children[1].append(load,open);
  dialog.append(element('h2','OpenStreetMap · nová oblast'),element('p','Vyberte čtverec podle středu mapy. V nové misi vznikne upravitelná automobilová síť road.bin a volitelně povrch ulic s chodníky a kolizemi. Šedé budovy jsou zatím pouze půdorysy v náhledu.'),form,attribution);
  let source=null,token=null,selected=new Set(),plan=null,surface=null,pending=false,closed=false,hasTemplate=false;const profileLabels=new Map();
  const area=()=>osmArea({latitude:Number(latitude.value),longitude:Number(longitude.value),size:Number(size.value)});
  function invalidate(){source=null;selected.clear();plan=null;surface=null;list.replaceChildren();summary.textContent='Načtěte oblast nebo uložený podklad.';create.disabled=true;draw();if(token){void api.cancelOsm(token).catch(()=>{});token=null;}}
  function surfaceControls(){for(const[key,input]of Object.entries(surfaceInputs))input.disabled=pending||!generate.checked||key==='estimateLanes'&&!surfaceInputs.useOsmTags.checked||key==='laneWidth'&&(!surfaceInputs.useOsmTags.checked||!surfaceInputs.estimateLanes.checked);}
  function busy(value){pending=value;setBusy(value);for(const control of controls)control.disabled=value;surfaceControls();for(const input of list.querySelectorAll('input'))input.disabled=value||!source?.ways.find(w=>w.id===Number(input.dataset.osmWay))?.eligible;create.disabled=value||!plan||!hasTemplate;}
  function draw(){
    const context=preview.getContext('2d'),w=preview.width,h=preview.height;context.clearRect(0,0,w,h);context.fillStyle='#edf0f2';context.fillRect(0,0,w,h);if(!source)return;
    const span=source.area.size,scale=(Math.min(w,h)-48)/span,point=p=>[w/2+p[0]*scale,h/2-p[2]*scale],box=span*scale;
    context.save();context.beginPath();context.rect(w/2-box/2,h/2-box/2,box,box);context.clip();
    if(surface)for(const[key,color]of [['road','#a6aeb4'],['sidewalk','#e0d0ad']]){context.fillStyle=color;for(const polygon of surface.footprints[key]){context.beginPath();for(const ring of polygon)ring.forEach((p,i)=>{const[x,y]=point([p[0],0,p[1]]);if(i)context.lineTo(x,y);else context.moveTo(x,y);});context.fill('evenodd');}}
    for(const way of source.ways){context.beginPath();way.points.forEach((p,i)=>{const[x,y]=point(p);if(i)context.lineTo(x,y);else context.moveTo(x,y);});if(way.tags.building&&way.nodes[0]===way.nodes.at(-1)){context.fillStyle='#d0d6da';context.fill();context.strokeStyle='#b1bbc1';context.lineWidth=1;}else{context.strokeStyle=selected.has(way.id)?'#1671d9':way.eligible?'#99a6af':'#c38748';context.lineWidth=selected.has(way.id)?3:1.4;}context.stroke();}
    context.restore();context.strokeStyle='#7a8790';context.lineWidth=1;context.strokeRect(w/2-box/2,h/2-box/2,box,box);context.fillStyle='#39444d';context.font='16px system-ui';context.fillText(`N ↑   ${span} × ${span} m`,18,20);
  }
  function update(){
    plan=null;surface=null;message.textContent='';try{if(source){plan=osmRoadPlan(source,[...selected]);if(generate.checked)surface=osmSurfaceModel(plan,source.area,surfaceSettings());}}catch(error){plan=null;message.textContent=error.message;}
    const warned=surface?new Set(surface.profiles.filter(p=>p.notes.length).map(p=>p.way)).size:0;
    summary.textContent=source?`${source.ways.filter(w=>w.tags.building).length} půdorysů · ${selected.size} vybraných ulic${plan?` · ${plan.crossings.length} uzlů a ${plan.roads.length} úseků`:''}${surface?` · ${surface.triangles} ploch s kolizemi`:''}${warned?` · ${warned} ulic s upozorněním v seznamu`:''} · rovinný podklad`: 'Načtěte oblast nebo uložený podklad.';
    for(const way of source?.ways??[]){const label=profileLabels.get(way.id);if(!label)continue;label.hidden=!generate.checked;try{const p=osmRoadProfile(way.tags,surfaceSettings()),fmt=n=>Number(n.toFixed(2));label.textContent=`Vozovka ${fmt(p.width)} m · ${p.widthSource}${p.estimated?' (odhad)':''} · chodníky L ${fmt(p.left)} / P ${fmt(p.right)} m. ${p.leftSource}; ${p.rightSource}.${p.notes.length?' '+p.notes.join(' '):''}`;}catch{label.textContent='Zkontrolujte nastavení profilu.';}}
    create.textContent=generate.checked?'Vytvořit misi s ulicemi a kolizemi':'Vytvořit misi se sítí ulic';
    surfaceControls();
    create.disabled=pending||!plan||!hasTemplate;draw();
  }
  function accept(result){
    if(token)void api.cancelOsm(token).catch(()=>{});token=result.token;source=result.source;latitude.value=source.area.latitude;longitude.value=source.area.longitude;size.value=source.area.size;url.value='';
    selected=new Set(result.selected??source.ways.filter(w=>w.eligible).slice(0,256).map(w=>w.id));list.replaceChildren();
    if(Object.hasOwn(result,'surface')){generate.checked=result.surface!==null;for(const[key,input]of Object.entries(surfaceInputs))if(result.surface){if(input.type==='checkbox')input.checked=result.surface[key]??defaults[key];else input.value=result.surface[key]??defaults[key];}}
    profileLabels.clear();
    for(const way of source.ways.filter(w=>w.tags.highway)){
      const row=element('label',undefined,'osm-way'),checkbox=element('input'),text=element('span');checkbox.type='checkbox';checkbox.checked=selected.has(way.id);checkbox.disabled=!way.eligible;checkbox.dataset.osmWay=String(way.id);
      text.append(element('strong',way.tags.name||way.tags.ref||`Cesta ${way.id}`),element('small',[way.tags.highway,way.tags.oneway?`oneway=${way.tags.oneway}`:'',way.tags.width?`šířka ${way.tags.width}`:'',way.tags.lanes?`${way.tags.lanes} pruhy`:'',way.tags.sidewalk?`chodník: ${way.tags.sidewalk}`:'',way.blocked||''].filter(Boolean).join(' · ')));
      if(way.eligible){const profile=element('small',undefined,'osm-way-profile');text.append(profile);profileLabels.set(way.id,profile);}
      checkbox.onchange=()=>{if(checkbox.checked)selected.add(way.id);else selected.delete(way.id);update();};row.append(checkbox,text);list.append(row);
    }
    update();message.textContent+=`${message.textContent?' ':''}${result.cached?'Použit uložený podklad.':'Oblast načtena ze serveru OSM.'}${!generate.checked?' Pro povrchy otevřete nastavení a vyberte tři BMP textury.':''}`;
  }
  async function request(action){if(pending)return;busy(true);message.textContent='Načítám podklad…';try{const result=await action();if(!closed&&result)accept(result);else if(!closed)message.textContent='Výběr zrušen.';}catch(error){if(!closed)message.textContent=error.message;}finally{if(!closed){busy(false);for(const input of list.querySelectorAll('input'))input.disabled=!source.ways.find(w=>w.id===Number(input.dataset.osmWay))?.eligible;}}}
  load.onclick=()=>request(()=>{if(url.value.trim()){const location=osmMapLocation(url.value.trim());latitude.value=location.latitude;longitude.value=location.longitude;}const value=area();invalidate();return api.osmArea(value,provider.value);});
  open.onclick=()=>request(()=>{const value=area();invalidate();return api.openOsm(value);});
  for(const input of [latitude,longitude,size,url])input.addEventListener('input',invalidate);
  for(const input of [generate,...Object.values(surfaceInputs)])input.addEventListener('input',update);
  all.onclick=()=>{selected=new Set(source?.ways.filter(w=>w.eligible).slice(0,256).map(w=>w.id)??[]);for(const input of list.querySelectorAll('input'))input.checked=selected.has(Number(input.dataset.osmWay));update();};
  none.onclick=()=>{selected.clear();for(const input of list.querySelectorAll('input'))input.checked=false;update();};
  template.onclick=async()=>{if(pending)return;busy(true);try{const result=await api.missionTemplate();if(result){hasTemplate=true;template.textContent=`Šablona: ${result.name}`;}}catch(error){message.textContent=error.message;}finally{busy(false);}};
  form.onsubmit=async event=>{event.preventDefault();if(pending||!plan||!hasTemplate||!form.reportValidity())return;busy(true);message.textContent='Vytvářím misi a síť ulic…';try{const result=await api.createOsmMission(token,[...selected],{name:name.value,model:model.value,surface:generate.checked?surfaceSettings():null});token=null;busy(false);dialog.close();await onCreated(result);}catch(error){message.textContent=error.message;}finally{if(!closed)busy(false);}};
  cancel.onclick=()=>dialog.close();dialog.addEventListener('cancel',event=>{if(pending)event.preventDefault();});dialog.addEventListener('close',()=>{closed=true;if(token)void api.cancelOsm(token).catch(()=>{});dialog.remove();},{once:true});
  document.body.append(dialog);dialog.showModal();update();return dialog;
}
