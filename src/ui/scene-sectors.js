export function sceneSectorsDialog(context,{element,run,status,save}){
  const dialog=element('dialog'),form=element('div',undefined,'mission-form'),parent=element('select'),message=element('p','','notice'),cancel=element('button','Zrušit'),submit=element('button','Uložit přiřazení','primary'),actions=element('div',undefined,'tools');
  parent.setAttribute('aria-label','Rodičovský sektor');
  if(!context.available.includes(context.parent)){const option=element('option',`${context.parent??'Bez rodiče'} · zachovat`);option.value='';parent.append(option);}
  for(const name of context.available){const option=element('option',name);option.value=name;parent.append(option);}parent.value=context.available.includes(context.parent)?context.parent:'';parent.disabled=context.object.actorBound;
  const checks=[];form.append(element('label','Rodičovský sektor (světová poloha zůstane zachovaná)'),parent);
  if(context.geometryOnly)form.append(element('p','Při změně vznikne přiřazení ve scene2.bin. Původní geometrie ve scene.4ds zůstane zachovaná.','notice'));
  if(context.object.actorBound)form.append(element('p','Rodiče animovaného nebo fyzikálního aktéra zatím nelze měnit.','notice'));
  if(context.sectors!==null){
    form.append(element('h3','Sektory ovlivněné světlem / zvukem'));
    for(const name of [...new Set([...context.available,...context.sectors])]){const label=element('label'),input=element('input');input.type='checkbox';input.checked=context.sectors.includes(name);label.append(input,document.createTextNode(name+(context.available.includes(name)?'':' · chybějící sektor')));checks.push({name,input});form.append(label);}
    form.append(element('p','Seznam je nezávislý na rodiči. Bez vybraných sektorů se světlo nebo zvuk do žádného sektoru nepřidá.','notice'));
  }
  dialog.append(element('h2',`Sektory · ${context.object.name}`),form,message,actions);actions.append(cancel,submit);
  let busy=false;const request=()=>({id:context.object.id,...(parent.value&&!parent.disabled?{parent:parent.value}:{}),...(context.sectors!==null?{sectors:checks.filter(c=>c.input.checked).map(c=>c.name)}:{})});
  function update(){const r=request();submit.disabled=busy||(!(r.parent&&r.parent!==context.parent)&&JSON.stringify(r.sectors)===JSON.stringify(context.sectors??undefined));message.textContent=context.transformed.includes(parent.value)?'Transformovaný sektor: přechod kamery může v herním enginu dát černý záběr. Pro nové interiéry použijte objem s výchozí transformací.':'';}
  parent.onchange=update;checks.forEach(c=>c.input.onchange=update);cancel.onclick=()=>dialog.close();
  submit.onclick=()=>run(async()=>{if(submit.disabled)return;busy=true;form.inert=true;cancel.disabled=true;update();let failure;try{await save(request(),context.sha256,context.geometryHash);status('Přiřazení do sektorů uložené se společným undo.');dialog.close();}catch(error){failure=error.message;}finally{busy=false;form.inert=false;cancel.disabled=false;update();if(failure)message.textContent=failure;}});
  dialog.addEventListener('cancel',e=>{if(busy)e.preventDefault();});dialog.addEventListener('close',()=>dialog.remove(),{once:true});document.body.append(dialog);dialog.showModal();update();
}
