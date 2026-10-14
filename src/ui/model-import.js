export async function modelImportDialog({api,element,run,onImported}) {
  const selected=await api.chooseModel();if(!selected)return;
  const dialog=element('dialog',undefined,'new-text-dialog'),name=element('input'),rows=element('div'),summary=element('p'),message=element('p',undefined,'notice'),textures=element('button','Vybrat BMP textury…'),recheck=element('button','Znovu zkontrolovat'),sources=element('div',undefined,'tools'),cancel=element('button','Zrušit'),save=element('button','Importovat do projektu','primary'),actions=element('div',undefined,'tools');
  name.value=selected.name;name.maxLength=120;name.setAttribute('aria-label','Název importovaného modelu');const label=element('label','Název modelu v projektu');label.append(name);
  let plan=null,revision=0,closed=false;
  actions.append(cancel,save);save.disabled=true;
  sources.append(textures,recheck);
  dialog.append(element('h2','Import vlastního modelu'),element('p',`Zdroj: ${selected.name}`),label,summary,sources,rows,message,element('p','Vyberte všechny potřebné BMP současně; další výběr nahradí tuto sadu. Shodné textury se převezmou z projektu. Model a nové textury budou přidané společně s jedním undo. Po importu je můžete vložit do mise přes Přidat → Vložit model… a vygenerovat kolizi.'),actions);
  async function update() {
    const version=++revision;plan=null;save.disabled=true;message.textContent='Kontroluji model a textury…';
    try {
      const next=await api.previewModelImport(selected.token,name.value);
      if(closed||version!==revision)return;
      plan=next;summary.textContent=`4DS v${next.version} · ${next.meshes} objektů · ${next.materials} materiálů · ${next.joints} kloubů`;
      const statuses={new:'Nový soubor',reuse:'Použije se z projektu',missing:'Chybí',conflict:'Konflikt názvu'};
      rows.replaceChildren(...next.files.map(file=>element('p',`${file.path} · ${statuses[file.status]}${file.size?` · ${file.size.toLocaleString('cs')} B`:''}`)));
      message.textContent=next.blocked.join('\n');save.disabled=Boolean(next.blocked.length);
    } catch(error) {if(!closed&&version===revision)message.textContent=error.message;}
  }
  name.oninput=update;
  recheck.onclick=()=>run(update);
  textures.onclick=()=>run(async()=>{
    recheck.disabled=textures.disabled=name.disabled=save.disabled=true;
    try {await api.chooseModelTextures(selected.token);await update();}
    catch(error){message.textContent=error.message;}
    finally{recheck.disabled=textures.disabled=name.disabled=false;}
  });
  cancel.onclick=()=>dialog.close();
  save.onclick=()=>run(async()=>{
    if(!plan||plan.blocked.length)return;
    cancel.disabled=recheck.disabled=textures.disabled=name.disabled=save.disabled=true;
    try {const result=await api.importModel(selected.token,name.value,{path:plan.path,files:plan.expected});dialog.close();await onImported(result);}
    catch(error){message.textContent=error.message;plan=null;}
    finally{cancel.disabled=recheck.disabled=textures.disabled=name.disabled=false;save.disabled=!plan||Boolean(plan.blocked.length);}
  });
  dialog.addEventListener('cancel',event=>{if(cancel.disabled)event.preventDefault();});
  dialog.addEventListener('close',()=>{closed=true;revision++;api.cancelModelImport(selected.token).catch(()=>{});dialog.remove();},{once:true});
  document.body.append(dialog);dialog.showModal();name.focus();name.select();await update();
}
