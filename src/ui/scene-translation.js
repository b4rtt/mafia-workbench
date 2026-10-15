import { BoxHelper } from 'three';
import { planSceneTranslation, sceneTranslationObjects } from '../shared/scene-translation.js';

export function sceneTranslationDialog(file,view,initial,{element,run,status,save}){
  const dialog=element('dialog',undefined,'scene-translation-dialog'),form=element('form',undefined,'mission-form'),search=element('input'),list=element('div',undefined,'translation-objects'),fields=element('div',undefined,'mission-fields');
  search.type='search';search.placeholder='Hledat objekty…';search.setAttribute('aria-label','Hledat objekty pro společný posun');
  const objects=sceneTranslationObjects(file),selected=new Set(objects.filter(object=>object.id===initial).map(object=>object.id)),frames=new Map([...view.frames.values()].map(frame=>[frame.userData.frame.sceneObject?.id,frame]));
  const offset=['X','Y','Z'].map(axis=>{const label=element('label','Posun '+axis),input=element('input');input.type='number';input.step='any';input.value='0';input.required=true;input.setAttribute('aria-label','Společný posun '+axis);label.append(input);fields.append(label);return input;});
  const message=element('p','','notice'),summary=element('p','','notice'),visible=element('button','Vybrat nalezené'),clear=element('button','Zrušit výběr'),fit=element('button','Zarámovat výběr'),cancel=element('button','Zrušit'),submit=element('button','Uložit společný posun','primary'),tools=element('div',undefined,'tools'),actions=element('div',undefined,'tools');
  for(const button of [visible,clear,fit,cancel])button.type='button';submit.type='submit';tools.append(visible,clear,fit);actions.append(cancel,submit);
  form.append(search,tools,list,fields,summary,message,element('p','Posun v metrech ve světových osách. Děti se přesunou s rodičem pouze jednou. Sektory ani samostatná geometrie se zde nevybírají. Navigaci, silnice, efekty a původní kolize upravte zvlášť; generované kolize modelů se přepočítají při uložení.','notice'),actions);
  dialog.append(element('h2','Společný posun objektů'),form);
  const gizmo=view.gizmo.object;view.gizmo.detach();
  const baseline=new Map(objects.map(object=>[object.fields.position,object.position])),helpers=[];
  let plan,busy=false,committed=false;
  const matches=()=>objects.filter(object=>object.name.normalize('NFC').toLowerCase().includes(search.value.normalize('NFC').toLowerCase()));
  function restore(){for(const object of objects){const frame=frames.get(object.id);if(frame)frame.position.fromArray(baseline.get(object.fields.position));}view.syncSoundExtent();view.syncLightPreview();view.syncMissionAreas();}
  function clearHelpers(){for(const helper of helpers){helper.removeFromParent();helper.geometry.dispose();helper.material.dispose();}helpers.length=0;}
  function request(){return {ids:[...selected],offset:offset.map(input=>input.value===''?NaN:Number(input.value))};}
  function update(){
    restore();clearHelpers();plan=null;message.textContent='';
    try{plan=planSceneTranslation(file,file.geometry,request());for(const change of plan.changes){const object=objects.find(object=>object.fields.position===change.id),frame=frames.get(object.id);if(frame)frame.position.fromArray(change.value);}
      view.root.updateWorldMatrix(true,true);
      for(const id of selected){const frame=frames.get(id);if(frame){const helper=new BoxHelper(frame,0xffad32);view.scene.add(helper);helpers.push(helper);}}
      view.syncSoundExtent();view.syncLightPreview();view.syncMissionAreas();
    }catch(error){message.textContent=error.message;}
    summary.textContent=`Vybráno ${selected.size} / ${objects.length} objektů${plan?.inherited.length?` · ${plan.inherited.length} se přesune spolu s rodičem`:''}.`;
    submit.disabled=busy||!plan?.changes.length;fit.disabled=busy||!selected.size;
  }
  function fill(){list.replaceChildren();for(const object of matches()){const label=element('label'),input=element('input');input.type='checkbox';input.checked=selected.has(object.id);input.setAttribute('aria-label','Posunout '+object.name);input.onchange=()=>{if(input.checked)selected.add(object.id);else selected.delete(object.id);update();};label.append(input,document.createTextNode(object.name));list.append(label);}}
  search.oninput=fill;offset.forEach(input=>input.oninput=update);
  visible.onclick=()=>{matches().forEach(object=>selected.add(object.id));fill();update();};clear.onclick=()=>{selected.clear();fill();update();};
  fit.onclick=()=>{const targets=[...selected].map(id=>frames.get(id)).filter(Boolean);if(targets.length)view.fit(targets);};
  cancel.onclick=()=>dialog.close();
  form.onsubmit=event=>{event.preventDefault();if(submit.disabled)return;run(async()=>{busy=true;form.inert=true;update();let failure;try{await save(request(),file.sha256,file.geometry.sha256);committed=true;dialog.close();status('Společný posun uložený s generovanými kolizemi a jedním undo.');}catch(error){failure=error.message;}finally{busy=false;form.inert=false;if(!committed){update();if(failure)message.textContent=failure;}}});};
  dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
  dialog.addEventListener('close',()=>{clearHelpers();if(!committed&&!view.disposed){restore();if(gizmo)view.gizmo.attach(gizmo);}dialog.remove();},{once:true});
  document.body.append(dialog);dialog.showModal();fill();update();
}
