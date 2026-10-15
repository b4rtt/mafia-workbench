import {effectModelDialog} from './effect-model.js';

export function renderEffectDefinitions(main,file,{element,state,api,run,refresh,renderDetail,status}) {
  const all=file.records.flatMap(record=>[record,...record.children.flatMap(emitter=>[emitter,...emitter.children])]);
  main.append(element('p',`${file.records.length} typů · ${all.filter(node=>node.kind==='emitter').length} emitorů · ${all.filter(node=>node.kind==='phase').length} fází. Definice jsou společné pro všechny mise. Nový typ vznikne kopií na konci tabulky; původní ID se nemění. Po změně hru znovu načtěte.`,'notice'));
  const layout=element('div',undefined,'items-workspace effect-definitions'),browser=element('section'),form=element('section',undefined,'item-form');
  const search=element('input'),list=element('div',undefined,'text-list effect-definition-list');search.type='search';search.placeholder='Typ, emitor nebo fáze…';search.setAttribute('aria-label','Hledat definice efektů');browser.append(search,list);layout.append(browser,form);main.append(layout);
  const current=entry=>state.texts.has(entry.id)?state.texts.get(entry.id):entry.value;
  const title=node=>{const name=current(node.entries.find(entry=>entry.key==='name')??{id:'',value:node.name});return name?.invalid?node.name:name;};
  const remembered=state.effectDefinitionSelection?.path===file.path?state.effectDefinitionSelection:null;
  const expanded=new Set(remembered?.expanded??[]);search.value=remembered?.query??'';let selected=all.find(node=>node.id===remembered?.id);
  selected??=file.records[0];
  const remember=()=>{state.effectDefinitionSelection={path:file.path,id:selected?.id,query:search.value,expanded:[...expanded]};};
  const tools=element('div',undefined,'tools'),newType=element('button','Nový typ kopií…'),duplicate=element('button','Kopírovat…'),up=element('button','Posunout nahoru'),down=element('button','Posunout dolů'),remove=element('button','Odstranit…');tools.append(newType,duplicate,up,down,remove);main.insertBefore(tools,layout);
  const parentOf=node=>all.find(parent=>parent.children.includes(node));
  const label=node=>node.kind==='effect'?'typ efektu':node.kind==='emitter'?'emitor':'fázi';
  const guard=()=>{if(state.texts.size)throw Error('Nejdřív uložte rozepsané parametry efektů.');};
  async function change(request){
    guard();const result=await api.changeEffectDefinition(file.path,request,file.sha256);state.file=result.file;
    state.effectDefinitionSelection={path:file.path,id:result.selection,query:'',expanded:[]};await refresh();renderDetail();status('Struktura efektu uložená s jedním undo. Původní ID typů zůstala zachovaná.');
  }
  function confirm(action,target){
    guard();const dialog=element('dialog'),form=element('form',undefined,'mission-form'),name=element('input'),message=element('p','','notice'),cancel=element('button','Zrušit'),save=element('button',action==='delete'?'Odstranit':'Vytvořit kopii','primary'),actions=element('div',undefined,'tools');
    const parent=parentOf(target),siblings=parent?.children??file.records;
    dialog.append(element('h2',`${action==='delete'?'Odstranit':'Kopírovat'} ${label(target)}`),form);form.append(element('p',`${title(target)}${target.kind==='effect'?` · zdrojové ID ${file.records.indexOf(target)}`:''}`));
    if(action==='duplicate'){
      const row=element('label','Název kopie');name.required=true;name.maxLength=998;name.setAttribute('aria-label','Název kopie efektu');let index=1;do{name.value=`${target.name||'Efekt'} kopie${index===1?'':' '+index++}`;if(index===1)index++;}while(siblings.some(sibling=>sibling.name.normalize('NFC').toLowerCase()===name.value.normalize('NFC').toLowerCase()));row.append(name);form.append(row);
      form.append(element('p',target.kind==='effect'?`Nové ID bude ${file.records.length}. Zkopírují se parametry, model i všechny emitory a fáze. Původní definice se nezmění; nový typ pak vyberte v Efektech mise.`:'Kopie se vloží za vybraný záznam v témže rodiči. Parametry, modelové vazby a vnořené fáze se převezmou ze vzoru.','notice'));
      name.oninput=()=>{save.disabled=!name.value.trim();};
    }else form.append(element('p',target.kind==='emitter'?'Odstraní se tento emitor včetně jeho fází ze společné definice. Změna ovlivní všechny mise používající tento typ.':'Odstraní se tato fáze z řetězce vybraného emitoru. Změna ovlivní všechny mise používající tento typ.','notice'));
    cancel.type='button';cancel.onclick=()=>dialog.close();save.type='submit';actions.append(cancel,save);form.append(message,actions);let saving=false;
    form.onsubmit=event=>{event.preventDefault();if(save.disabled)return;run(async()=>{saving=true;form.inert=true;try{await change({action,id:target.id,...(action==='duplicate'?{name:name.value}:{})});dialog.close();}catch(error){message.textContent=error.message;}finally{saving=false;form.inert=false;}});};
    dialog.addEventListener('cancel',event=>{if(saving)event.preventDefault();});dialog.addEventListener('close',()=>dialog.remove(),{once:true});document.body.append(dialog);dialog.showModal();if(action==='duplicate'){name.focus();name.select();}
  }
  newType.onclick=()=>run(()=>{let target=selected;while(parentOf(target))target=parentOf(target);confirm('duplicate',target);});duplicate.onclick=()=>run(()=>confirm('duplicate',selected));remove.onclick=()=>run(()=>confirm('delete',selected));
  up.onclick=()=>run(()=>change({action:'move',id:selected.id,direction:-1}));down.onclick=()=>run(()=>change({action:'move',id:selected.id,direction:1}));
  function fill(){
    const scroll=list.scrollTop,query=search.value.trim().toLowerCase();list.replaceChildren();
    const matchesSelf=(node,index)=>`${node.kind==='effect'?index:''} ${title(node)} ${node.entries.map(entry=>entry.kind==='string'?current(entry):'').join(' ')}`.toLowerCase().includes(query);
    const matches=(node,index)=>matchesSelf(node,index)||node.children.some((child,i)=>matches(child,i));
    function row(node,index,includeChildren=false){
      if(query&&!includeChildren&&!matches(node,index))return null;
      const label=node.kind==='effect'?`${index} · ${title(node)||'(bez názvu)'}`:`${node.kind==='emitter'?'Emitor':'Fáze'} ${index+1}${title(node)?' · '+title(node):''}`;
      const button=element('button',label+([...state.texts.keys()].some(id=>id.startsWith(node.id+'/'))?' · upraveno':''));button.classList.toggle('active',node.id===selected?.id);button.setAttribute('aria-current',String(node.id===selected?.id));button.onclick=event=>{event.preventDefault();if(state.busy)return;selected=node;edit();fill();};
      if(!node.children.length)return button;
      const details=element('details'),summary=element('summary'),children=element('div',undefined,'effect-definition-children');summary.append(button);details.append(summary,children);
      details.open=Boolean(query||expanded.has(node.id)||selected?.id.startsWith(node.id+'/'));details.ontoggle=()=>{if(details.open)expanded.add(node.id);else expanded.delete(node.id);remember();};
      node.children.forEach((child,i)=>{const item=row(child,i,includeChildren||Boolean(query&&matchesSelf(node,index)));if(item)children.append(item);});return details;
    }
    file.records.forEach((record,i)=>{const item=row(record,i);if(item)list.append(item);});list.scrollTop=scroll;
  }
  function edit(){
    newType.disabled=!selected;const parent=selected&&parentOf(selected),index=parent?.children.indexOf(selected)??-1;duplicate.disabled=!parent;duplicate.textContent=selected?.kind==='phase'?'Kopírovat fázi…':'Kopírovat emitor…';up.disabled=!parent||index===0;down.disabled=!parent||index===parent.children.length-1;remove.disabled=!parent||parent.children.length<2;
    if(!selected)return;remember();form.replaceChildren();
    form.append(element('h3',`${selected.kind==='effect'?'Typ efektu':selected.kind==='emitter'?'Emitor':'Fáze'} · ${title(selected)||'(bez názvu)'}`));
    if(selected.kind!=='phase'){
      const binding=element('button','Model a části…');binding.onclick=()=>run(()=>{guard();let type=selected;while(parentOf(type))type=parentOf(type);effectModelDialog({element,api,assets:state.project.assets,file,type,run,onSaved:async result=>{state.file=result;await refresh();renderDetail();status('Modelové vazby efektu uložené s jedním undo.');}});});form.append(binding);
    }
    for(const warning of selected.warnings)form.append(element('p',warning,'notice'));
    const fields=element('div',undefined,'item-fields'),advanced=element('details'),advancedFields=element('div',undefined,'item-fields');advanced.append(element('summary','Původní parametry a příznaky'),advancedFields);form.append(fields);
    const save=element('button',`Uložit změny (${state.texts.size})`,'primary');save.disabled=!state.texts.size;
    function update(entry,value,raw){
      let valid=true;
      if(entry.kind!=='string'&&entry.kind!=='boolean'){
        for(const number of Array.isArray(value)?value:[value]){
          if(!Number.isFinite(number)||!Number.isFinite(Math.fround(number))||number!==0&&Math.fround(number)===0||entry.min!==undefined&&number<entry.min||entry.max!==undefined&&number>entry.max||entry.kind==='uint'&&(!Number.isInteger(number)||number<0||number>4294967295)||entry.kind==='int'&&(!Number.isInteger(number)||number< -2147483648||number>2147483647))valid=false;
        }
      }
      const equal=Array.isArray(value)?value.every((number,i)=>Object.is(number,entry.value[i])):Object.is(value,entry.value);
      if(equal)state.texts.delete(entry.id);else state.texts.set(entry.id,valid?value:{invalid:true,components:raw,raw:raw.join(', ')});
      save.disabled=!state.texts.size;save.textContent=`Uložit změny (${state.texts.size})`;fill();status(valid?'Rozepsaná úprava definice efektu.':'Opravte neplatné hodnoty.',!valid);return valid;
    }
    for(const entry of selected.entries){
      const value=current(entry),label=element('div',undefined,'effect-definition-field'),caption=element('span',entry.label),target=/^(parameter|vector\d|flags$|mode$)/.test(entry.key)?advancedFields:fields;label.append(caption);
      const binding=['model','frame'].includes(entry.key),readOnly=entry.readOnly||binding;
      if(readOnly)label.append(element('span',binding?'Změnit přes Model a části…':'Pouze ke čtení','muted'));
      if(entry.kind==='string'||entry.kind==='boolean'){
        const input=element('input');input.type=entry.kind==='boolean'?'checkbox':'text';input.disabled=readOnly;input.setAttribute('aria-label',entry.label);
        if(entry.kind==='boolean')input.checked=value;else input.value=value??'';
        input.oninput=()=>update(entry,entry.kind==='boolean'?input.checked:input.value,[input.value]);label.append(input);
      }else {
        const inputs=[],numeric=element('div',undefined,'numeric-fields'),values=value?.invalid?value.components:Array.isArray(value)?value:[value];
        if(entry.kind==='vec3')label.classList.add('effect-vector');
        values.forEach((number,index)=>{
          const component=values.length>1?['X','Y','Z'][index]:'Hodnota',field=element('label',values.length>1?component:''),input=element('input');input.type='number';input.step=['int','uint'].includes(entry.kind)?'1':'any';input.value=number===null?'':Object.is(number,-0)?'-0':String(number);input.disabled=entry.readOnly;input.setAttribute('aria-label',`${entry.label} · ${component}`);input.title=`Offset 0x${entry.offsets[index].toString(16)} · ${entry.kind}`;
          if(entry.min!==undefined)input.min=String(entry.min);if(entry.max!==undefined)input.max=String(entry.max);if(value?.invalid)input.setAttribute('aria-invalid','true');inputs.push(input);field.append(input);numeric.append(field);
          input.oninput=()=>{const raw=inputs.map(input=>input.value),numbers=raw.map(text=>text.trim()===''?NaN:Number(text)),valid=update(entry,entry.kind==='vec3'?numbers:numbers[0],raw);for(const input of inputs){if(valid)input.removeAttribute('aria-invalid');else input.setAttribute('aria-invalid','true');}};
        });label.append(numeric);
      }
      target.append(label);
    }
    if(advancedFields.childElementCount)form.append(advanced);
    form.append(element('p','XYZ jsou herní souřadnice. Neprůhlednost: 0 = průhledné, 1 = neprůhledné. Původní parametry a bitové příznaky nemají všechny významy ověřené. Model a části všech emitorů nastavte společně přes Model a části… Náhled částic zatím vykresluje hra.','notice'));
    save.onclick=()=>run(async()=>{
      if([...state.texts.values()].some(value=>value?.invalid))throw new Error('Opravte neplatné hodnoty před uložením.');
      state.file=await api.saveEffectDefinitions(file.path,[...state.texts].map(([id,value])=>({id,value})),file.sha256);state.texts.clear();await refresh();renderDetail();status('Definice efektů uložené do modu se zálohou.');
    });const footer=element('div',undefined,'effect-definition-save');footer.append(save);form.append(footer);
  }
  search.oninput=()=>{remember();fill();};edit();fill();
}
