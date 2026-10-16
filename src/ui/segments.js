import * as THREE from 'three';
import { NavigationViewport } from './navigation.js';

export class SegmentViewport extends NavigationViewport {
  loadSegments(file){
    this.loadNavigation({...file,editable:false,linkCount:0});this.segmentFile=file;this.corners=new Map();
    for(const record of file.records)for(const special of record.specials)if(special.type===2)this.drawCorner(record.index,special.index,special);
  }
  drawCorner(index,special,values){
    const id=`cover/${index}/${special}`,old=this.corners.get(id);
    if(old){old.removeFromParent();old.traverse(o=>{o.geometry?.dispose();if(o.material){this.materials.delete(o.material);o.material.dispose();}});this.corners.delete(id);}
    if(!values.position?.every(Number.isFinite))return;
    const group=new THREE.Group();group.position.fromArray(values.position);group.userData.frame={id,editable:false};
    const material=new THREE.MeshBasicMaterial({color:0x63e6ad}),marker=new THREE.Mesh(new THREE.OctahedronGeometry(.5),material);this.materials.add(material);group.add(marker);
    for(const [key,color] of [['dirA',0xffa55f],['dirB',0x5fcaff],['dirC',0xee81db]]){
      const dir=values[key];if(!dir?.every(Number.isFinite)||Math.hypot(...dir)<1e-6)continue;
      const vector=new THREE.Vector3(dir[0],0,dir[1]).normalize().multiplyScalar(2),m=new THREE.LineBasicMaterial({color});this.materials.add(m);
      const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(),vector]),m);line.raycast=()=>{};group.add(line);
    }
    if(Number.isFinite(values.radius)&&values.radius>0){const m=new THREE.MeshBasicMaterial({color:0x63e6ad,wireframe:true,transparent:true,opacity:.14});this.materials.add(m);const sphere=new THREE.Mesh(new THREE.SphereGeometry(values.radius,12,8),m);sphere.raycast=()=>{};group.add(sphere);}
    this.corners.set(id,group);this.root.add(group);
  }
  select(id,_editable,focus=false){
    if(!String(id).startsWith('cover/')){super.select(id,false,focus);return;}
    const object=this.corners.get(id);if(!object)return;this.gizmo.detach();this.onSelect(object.userData.frame);if(focus)this.fit(object);
  }
}
export function renderSegments(main,file,previous,env){
  const {element:e,state,api,run,refresh,renderDetail,status,buttons}=env;
  main.append(e('p',file.active?'Krycí rohy AI a příslušnost navigačních bodů. Směry A/B/C jsou oranžové/modré/růžové. Čísla bodů jsou pořadové indexy v check.bin; uložená ID se nepoužívají. Ostatní geometrie a neznámé hodnoty zůstanou zachované.':'Tato verze 1.0 se ve hře PC nenačítá. Soubor zůstává pouze ke čtení.','notice'));
  const layout=e('div',undefined,'model-workspace'),center=e('section',undefined,'model-center'),inspector=e('section',undefined,'model-inspector segment-inspector'),tools=e('div',undefined,'tools'),viewport=e('div',undefined,'viewport');layout.append(center,inspector);main.append(layout);center.append(tools,viewport);
  const records=e('select'),specials=e('select'),add=e('button','Přidat krycí roh'),remove=e('button','Odstranit krycí roh'),fit=e('button','Zarámovat roh'),all=e('button','Zarámovat síť');records.setAttribute('aria-label','Navigační segment');specials.setAttribute('aria-label','Geometrie segmentu');
  for(const record of file.records){const option=e('option',`Segment ${record.index} · ${record.nodes.length} bodů · typ ${record.own}`);option.value=String(record.index);records.append(option);}
  records.disabled=!file.records.length;const background=e('button','Zobrazit geometrii mise');tools.append(add,fit,all,background);inspector.append(records,specials);
  const fields=e('form',undefined,'mission-fields'),nodes=e('textarea'),point=e('p','Kliknutím ve 3D vyberte navigační bod.'),toggle=e('button','Přepnout bod v segmentu'),message=e('p','','notice'),actions=e('div',undefined,'tools'),save=e('button','Uložit segment','primary'),cancel=e('button','Zahodit návrh');nodes.setAttribute('aria-label','Body segmentu');const nodeLabel=e('label','Pořadové indexy bodů (oddělené mezerou)');nodeLabel.append(nodes);inspector.append(nodeLabel,point,toggle,fields,message,actions);actions.append(save,cancel,remove);
  let index=Math.min(previous?.index??0,file.records.length-1),special=previous?.special??0,creating=false,dirty=false,inputs={},selectedPoint=previous?.selectedPoint??null;
  const view=new SegmentViewport(viewport,frame=>{
    if(frame.id.startsWith('cover/')){if(creating)return;if(dirty){status('Před změnou výběru uložte nebo zahoďte návrh.',true);return;}const parts=frame.id.split('/');index=Number(parts[1]);special=Number(parts[2]);show();}
    else{selectedPoint=frame.navigationIndex;point.textContent=`Vybraný bod ${selectedPoint}: ${file.points[selectedPoint].position.join(', ')}`;controls();}
  });state.viewport=view;view.projectRoot=state.project.root;view.segmentsPath=file.path;view.loadSegments(file);
  const defaults=()=>({position:[...(file.points[selectedPoint]?.position??[0,0,0])],dirA:[1,0],dirB:[0,1],dirC:[-Math.SQRT1_2,-Math.SQRT1_2],radius:3,tolerance:Math.PI/4});
  const readNodes=()=>nodes.value.trim()?nodes.value.trim().split(/[\s,;]+/).map(n=>/^\d+$/.test(n)?Number(n):NaN):[];
  const values=()=>Object.fromEntries(Object.entries(inputs).map(([key,group])=>[key,group.length===1?Number(group[0].value):group.map(input=>Number(input.value))]));
  function controls(){save.disabled=!file.active||!dirty;cancel.disabled=!dirty;add.disabled=!file.active||dirty;remove.disabled=!file.active||dirty||creating||file.records[index]?.specials[special]?.type!==2;toggle.disabled=!file.active||selectedPoint===null||index<0&&!creating;fit.disabled=!creating&&file.records[index]?.specials[special]?.type!==2;buttons?.();}
  function changed(){dirty=true;state.texts.set('segments-draft',true);controls();if(Object.keys(inputs).length&&Object.values(inputs).flat().every(input=>input.value.trim()&&Number.isFinite(Math.fround(Number(input.value)))))view.drawCorner(creating?'new':index,special,values());}
  function show(){
    dirty=false;state.texts.clear();view.segmentIndex=index;view.segmentSpecial=special;fields.replaceChildren();inputs={};specials.replaceChildren();records.value=String(index);
    const record=file.records[index],list=creating?[{index:0,type:2,...defaults()}]:record?.specials??[];
    for(const value of list){const option=e('option',`Geometrie ${value.index} · ${value.type===2?'krycí roh':value.type===1?'pohyblivá překážka':`typ ${value.type} (raw)`}`);option.value=String(value.index);specials.append(option);}
    if(!list[special])special=0;view.segmentSpecial=special;specials.value=String(special);specials.disabled=creating||!list.length;records.disabled=creating||!file.records.length;
    nodes.value=creating?(selectedPoint===null?'':String(selectedPoint)):record?.nodes.join(' ')??'';nodes.disabled=!file.active||!creating&&!record;
    const value=list[special];
    if(value?.type===2){
      for(const [key,label,axes] of [['position','Pozice rohu',['X','Y','Z']],['dirA','Směr A',['X','Z']],['dirB','Směr B',['X','Z']],['dirC','Směr C',['X','Z']],['radius','Dosah rohu',['m']],['tolerance','Úhlová tolerance',['rad']]]){
        const group=e('fieldset'),legend=e('legend',label),row=e('div',undefined,'numeric-fields');group.append(legend,row);inputs[key]=axes.map((axis,i)=>{const labelNode=e('label',axis),input=e('input');input.type='number';input.step='any';input.required=true;input.value=String(axes.length===1?value[key]:value[key][i]);input.disabled=!file.active;input.setAttribute('aria-label',`${label} ${axis}`);input.oninput=changed;labelNode.append(input);row.append(labelNode);return input;});fields.append(group);
      }
      view.drawCorner(creating?'new':index,special,value);
    }
    message.textContent=value&&value.type!==2?'Vlastní geometrie segmentu a tento typ doplňku jsou uložené beze změn; upravit lze příslušnost bodů.':'Směry jsou v rovině X/Z; tolerance je v radiánech. Krycí roh musí odpovídat skutečnému rohu překážky a viditelnosti v misi. Výchozí hodnoty jsou výchozí návrh, nikoli automaticky odvozené krytí.';
    controls();
  }
  records.onchange=()=>{if(dirty){records.value=String(index);status('Nejdřív uložte nebo zahoďte návrh.',true);return;}index=Number(records.value);special=0;show();};
  specials.onchange=()=>{if(dirty){specials.value=String(special);status('Nejdřív uložte nebo zahoďte návrh.',true);return;}special=Number(specials.value);show();};nodes.oninput=changed;
  toggle.onclick=()=>{const list=readNodes();if(list.some(n=>!Number.isInteger(n))){status('Opravte seznam indexů bodů.',true);return;}nodes.value=(list.includes(selectedPoint)?list.filter(n=>n!==selectedPoint):[...list,selectedPoint].sort((a,b)=>a-b)).join(' ');changed();};
  add.onclick=()=>{creating=true;special=0;show();changed();view.fit(view.corners.get('cover/new/0'));};
  cancel.onclick=()=>{creating=false;renderDetail();};fit.onclick=()=>{const object=view.corners.get(`cover/${creating?'new':index}/${special}`);if(object)view.fit(object);};all.onclick=()=>view.fit();
  async function commit(request){inspector.inert=true;tools.inert=true;try{const result=await api.changeSegments(file.path,request,file.sha256,file.navigationHash);state.texts.clear();state.file=result.file;view.segmentIndex=result.index;view.segmentSpecial=request.action==='delete-cover'?0:special;await refresh();renderDetail();status('Navigační segment uložený do modu se zálohou a undo.');}finally{inspector.inert=false;tools.inert=false;}}
  save.onclick=()=>run(async()=>{if(!fields.reportValidity())return;await commit({action:creating?'add-cover':'update',...(creating?{}:{index}),nodes:readNodes(),...(Object.keys(inputs).length?{special,values:values()}:{})});});
  fields.onsubmit=event=>{event.preventDefault();if(!save.disabled)save.click();};
  remove.onclick=()=>run(()=>commit({action:'delete-cover',index,special}));
  let geometry,loading=false;
  async function toggleGeometry(){
    if(loading)return;if(geometry){geometry.visible=!geometry.visible;view.segmentGeometryWanted=geometry.visible;background.textContent=geometry.visible?'Skrýt geometrii mise':'Zobrazit geometrii mise';return;}
    loading=true;background.disabled=true;
    try{const model=await api.inspect(file.path.replace(/clusters\.seg$/i,'scene.4ds'));if(view.disposed)return;if(model.type!=='model')throw new Error(model.warning??'Geometrie mise není dostupná.');
      geometry=new THREE.Group();view.segmentGeometryWanted=true;view.root.add(geometry);for(const object of view.addModel(model,geometry,'segments-context/').values())object.userData.frame.editable=false;
      geometry.traverse(object=>{object.raycast=()=>{};});await view.loadTextures(async texture=>{const name=texture.replaceAll('\\','/').toLowerCase(),asset=state.project.assets.find(a=>a.path.toLowerCase()===`maps/${name}`||a.path.toLowerCase()===name);return asset?api.media(asset.path):null;});background.textContent='Skrýt geometrii mise';
    }catch(error){view.segmentGeometryWanted=false;geometry?.removeFromParent();geometry=null;throw error;}finally{loading=false;background.disabled=false;}
  }
  background.onclick=()=>run(toggleGeometry);
  if(previous?.geometry)toggleGeometry().catch(error=>status(error.message,true));
  view.segmentIndex=index;show();if(selectedPoint!==null&&file.points[selectedPoint])view.select(String(selectedPoint));if(previous?.camera)view.restoreCamera(previous.camera);
}
