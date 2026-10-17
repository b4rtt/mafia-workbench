import {roadConnections,roadSettingsPair} from '../shared/roads.js';

export function roadSettingsDialog(file,from,{element,state,api,run,refresh,renderDetail,status}){
  const dialog=element('dialog',undefined,'road-topology-dialog road-settings-dialog'),form=element('form',undefined,'mission-form'),fields=element('div',undefined,'mission-fields'),panels=element('div',undefined,'mission-fields'),message=element('p','','notice');
  dialog.append(element('h2','Pruhy a směry silnice'),form);
  const field=(label,input,parent=fields)=>{const row=element('label',label);input.setAttribute('aria-label',label);row.append(input);parent.append(row);return input;};
  const numeric=(label,value,parent)=>{const input=element('input');input.type='number';input.step='any';input.required=true;input.value=Object.is(value,-0)?'-0':String(value);return field(label,input,parent);};
  const target=field('Silniční propojení',element('select'));
  for(const link of roadConnections(file,from)){const option=element('option',`Výjezd ${link.slot} → křižovatka ${link.target}`);option.value=String(link.slot);target.append(option);}
  form.append(element('p',`Z křižovatky ${from}. Nastavení mění oba směry vybraného propojení. Uložená hodnota je šířka pásu v herních jednotkách. Střed pruhu běžného provozu nebo parkování leží za předchozími pásy, v polovině jeho vlastní šířky. I vypnutý pás s nenulovou šířkou posouvá další pruhy. Body a vozovka zůstanou na místě. Oba směry lze vypnout a cestu později znovu otevřít.`,'notice'));
  fields.append(panels);
  const actions=element('div',undefined,'tools'),cancel=element('button','Zrušit'),save=element('button','Uložit nastavení','primary');cancel.type='button';save.type='submit';save.disabled=true;cancel.onclick=()=>dialog.close();actions.append(cancel,save);form.append(fields,message,actions);
  let pair,forward,reverse,selectedSlot;
  function directionFields(label,original){
    const enabled=element('input');enabled.type='checkbox';enabled.checked=original.enabled;field(`Povolit ${label.toLocaleLowerCase('cs')}`,enabled,panels);
    const details=element('details'),grid=element('fieldset',undefined,'mission-fields');details.open=original.enabled;details.append(element('summary',label),grid);panels.append(details);grid.disabled=!enabled.checked;
    enabled.onchange=()=>{grid.disabled=!enabled.checked;if(enabled.checked)details.open=true;};
    const priority=numeric(`${label} · priorita`,original.priority,grid);priority.min='0';priority.max='4294967295';priority.step='1';
    const lanes=original.lanes.map((lane,i)=>{
      const row=element('fieldset',undefined,'road-lane');row.append(element('legend',`Pruh ${i+1}`));grid.append(row);
      const type=element('select');for(const [value,name]of [[0,'Vypnutý'],[1,'AI — bez běžného provozu'],[2,'Provoz'],[3,'Podélné parkování'],...(lane.type>3?[[lane.type,`Původní typ ${lane.type} (raw)`]]:[])]){const option=element('option',name);option.value=String(value);type.append(option);}type.value=String(lane.type);field(`${label} · pruh ${i+1} · typ`,type,row);
      const distance=numeric(`${label} · pruh ${i+1} · šířka pásu`,lane.distance,row);let replace;
      if(!Number.isFinite(lane.distance)){
        distance.value='';distance.readOnly=true;distance.required=false;distance.placeholder=`Původní ${String(lane.distance)}`;
        replace=element('input');replace.type='checkbox';field(`${label} · pruh ${i+1} · nahradit neplatnou šířku`,replace,row);replace.onchange=()=>{distance.readOnly=!replace.checked;distance.required=replace.checked;if(replace.checked&&distance.value==='')distance.value='0';};
      }
      return {type,distance,replace};
    });return {enabled,priority,lanes,original};
  }
  function patch(direction){
    const {original}=direction,result={};if(direction.enabled.checked!==original.enabled)result.enabled=direction.enabled.checked;
    if(!direction.enabled.checked)return result;
    const priority=Number(direction.priority.value);if(priority!==original.priority)result.priority=priority;
    const lanes=direction.lanes.map((lane,i)=>{
      const changes={},type=Number(lane.type.value);if(type!==original.lanes[i].type)changes.type=type;
      if(lane.replace?lane.replace.checked:Number.isFinite(original.lanes[i].distance)){const distance=Number(lane.distance.value);if(!Object.is(Math.fround(distance),original.lanes[i].distance))changes.distance=distance;}
      return changes;
    });if(lanes.some(lane=>Object.keys(lane).length))result.lanes=lanes;return result;
  }
  const dirty=()=>Boolean(pair&&(Object.keys(patch(forward)).length||Object.keys(patch(reverse)).length));
  function load(){
    selectedSlot=target.value;pair=roadSettingsPair(file,from,Number(selectedSlot));panels.replaceChildren();message.textContent='';
    if(!pair){message.textContent='Propojení nemá jednoznačný zpáteční řetězec. Nastavení se nemění.';save.disabled=true;return;}
    forward=directionFields('Směr tam',pair.forward);reverse=directionFields('Směr zpět',pair.reverse);save.disabled=true;
  }
  target.onchange=()=>{if(dirty()){target.value=selectedSlot;message.textContent='Před výběrem jiné silnice uložte nastavení nebo zrušte tento dialog.';}else load();};
  form.oninput=()=>{save.disabled=state.busy||!dirty();};form.onchange=()=>{save.disabled=state.busy||!dirty();};
  form.onsubmit=event=>{event.preventDefault();if(state.busy||!pair||!dirty()||!form.reportValidity())return;run(async()=>{
    const request={action:'edit-road',from,to:pair.to,fromSlot:pair.fromSlot,forward:patch(forward),reverse:patch(reverse)};
    save.disabled=cancel.disabled=true;fields.inert=true;
    try{
      const result=await api.changeRoadTopology(file.path,request,file.sha256);state.file=result.file;state.roadIndex=result.index;
      if(state.viewport?.roadPath===file.path)state.viewport.selectedPoint=result.index;
      dialog.close();await refresh();renderDetail();status('Pruhy a směry uložené do modu se zálohou a undo.');
    }catch(error){message.textContent=error.message;throw error;}finally{save.disabled=!dirty();cancel.disabled=false;fields.inert=false;}
  });};
  load();dialog.addEventListener('cancel',event=>{if(state.busy)event.preventDefault();});dialog.addEventListener('close',()=>dialog.remove(),{once:true});document.body.append(dialog);dialog.showModal();
}
