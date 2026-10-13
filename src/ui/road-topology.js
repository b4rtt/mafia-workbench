export function roadTopologyDialog(file,action,point,{element,state,api,run,refresh,renderDetail,status}) {
  const format=position=>position.map(n=>Number(n.toPrecision(7))).join(', ');
  const titles={'create-crossing':'Nová křižovatka','split-crossing':'Vytvořit křižovatku z bodu',connect:'Propojit křižovatky',disconnect:'Odstranit silniční propojení','delete-crossing':'Odstranit volnou křižovatku'};
  const dialog=element('dialog',undefined,'road-topology-dialog'),form=element('form',undefined,'mission-form'),fields=element('div',undefined,'mission-fields');dialog.append(element('h2',titles[action]),form);
  const field=(label,input,parent=fields)=>{const row=element('label',label);input.setAttribute('aria-label',label);row.append(input);parent.append(row);return input;};
  const numeric=(label,value,{min,step='any',parent=fields}={})=>{const input=element('input');input.type='number';input.step=step;input.value=String(value);input.required=true;if(min!==undefined)input.min=String(min);return field(label,input,parent);};
  let target,positions,velocity,semaphore,forward,reverse,priorities;
  if(action==='create-crossing'){
    form.append(element('p','Volná křižovatka má až čtyři výjezdy. Po vložení ji vyberte a propojte s jinou křižovatkou. Tento krok vytváří navigaci aut; model vozovky ani kolize nepřidává.','notice'));
    const origin=point?.position??[0,0,0];positions=['X','Y','Z'].map((axis,i)=>numeric(`Pozice ${axis}`,origin[i]+(i===0&&point?5:0)));
    velocity=numeric('Rychlost (herní jednotky)',1.2,{min:0});semaphore=element('input');semaphore.type='checkbox';field('Semafor — příznak pro kontrolu policie',semaphore);
  }else if(action==='split-crossing'){
    const source=file.nodes[point.recordIndex];
    form.append(element('p',`Bod ${point.recordIndex}: ${format(source.position)}. Nová křižovatka nahradí tento bod ve stejné poloze. Obě části cesty zachovají původní pruhy a priority; zbývající dva výjezdy jsou volné pro odbočky. Pokud některé části chybí silniční bod, doplní se uprostřed úseku. Vozovka ani kolize se nemění.`,'notice'));
    velocity=numeric('Rychlost křižovatky (herní jednotky)',Math.max(0,source.speed),{min:0});semaphore=element('input');semaphore.type='checkbox';field('Semafor — příznak pro kontrolu policie',semaphore);
  }else if(action==='connect'||action==='disconnect'){
    const from=point.recordIndex,source=file.crossings[from];form.append(element('p',`Z křižovatky ${from}: ${format(source.position)}`));
    target=field('Cílová křižovatka',element('select'));
    const candidates=file.crossings.filter(c=>c.index!==from&&(action==='connect'?c.links.some((ref,i)=>ref===65535&&c.directions[i].target===65535)&&!source.directions.some(d=>d.target===c.index)&&!c.directions.some(d=>d.target===from):source.directions.some(d=>d.target===c.index)));
    for(const crossing of candidates){const option=element('option',`Křižovatka ${crossing.index} · ${format(crossing.position)}`);option.value=String(crossing.index);target.append(option);}
    target.required=true;
    if(!candidates.length)form.append(element('p','Žádná vhodná křižovatka. Vytvořte další nebo nejprve uvolněte obsazené propojení.','notice'));
    if(action==='connect'){
      positions=numeric('Počet mezilehlých bodů',2,{min:1,step:'1'});positions.max='4096';velocity=numeric('Rychlost nových bodů (herní jednotky)',Math.max(0,source.speed),{min:0});
      form.append(element('p','Body začnou na přímce mezi křižovatkami. Po vytvoření je můžete posouvat ve 3D nebo doplnit další. Každý směr potřebuje aktivní pruh; nula vypíná pruh, nikoli celý sousední řetězec. Boční posun je původní hodnota vzdálenosti pruhu od osy cesty.','notice'));
      function laneFields(label){
        const details=element('details'),grid=element('div',undefined,'mission-fields');details.append(element('summary',label),grid);fields.append(details);
        const priority=numeric(`${label} · priorita`,100,{min:0,step:'1',parent:grid});priority.max='4294967295';
        const lanes=Array.from({length:4},(_,i)=>{
          const laneRow=element('fieldset',undefined,'road-lane');laneRow.append(element('legend',`Pruh ${i+1}`));grid.append(laneRow);const type=element('select');for(const [value,name] of [[0,'Vypnutý'],[1,'AI — bez běžného provozu'],[2,'Provoz'],[3,'Podélné parkování']]){const option=element('option',name);option.value=String(value);type.append(option);}type.value=String(i===0?2:0);field(`${label} · pruh ${i+1} · typ`,type,laneRow);
          const distance=numeric(`${label} · pruh ${i+1} · boční posun`,i===0?1.5:4,{parent:laneRow});return {type,distance};
        });return {priority,lanes};
      }
      forward=laneFields('Směr tam');reverse=laneFields('Směr zpět');priorities=[forward.priority,reverse.priority];
    }else form.append(element('p','Odstraní se oba výjezdy a celý jejich společný řetězec bodů. Další cesty zůstanou připojené; úhly a číslování se upraví společně. Sdílené nebo nejednoznačné řetězce se neodstraní.','notice'));
  }else form.append(element('p',`Křižovatka ${point.recordIndex} se odstraní pouze tehdy, když ji nepoužívá žádná cesta ani jiný bod. Ostatní indexy a reference se přemapují.`));
  const message=element('p','','notice'),actions=element('div',undefined,'tools'),cancel=element('button','Zrušit'),save=element('button',action.startsWith('delete')||action==='disconnect'?'Odstranit z modu':'Vytvořit v modu','primary');cancel.type='button';cancel.onclick=()=>dialog.close();save.type='submit';save.disabled=Boolean(target&&!target.options.length);actions.append(cancel,save);form.append(fields,message,actions);
  const laneValues=direction=>direction.lanes.map(lane=>({type:Number(lane.type.value),distance:Number(lane.distance.value)}));
  form.onsubmit=event=>{event.preventDefault();if(state.busy||!form.reportValidity())return;run(async()=>{
    save.disabled=cancel.disabled=true;fields.inert=true;
    try{
      let request={action};
      if(action==='create-crossing')request={...request,position:positions.map(input=>Number(input.value)),speed:Number(velocity.value),semaphore:Number(semaphore.checked)};
      else if(action==='split-crossing')request={...request,index:point.recordIndex,speed:Number(velocity.value),semaphore:Number(semaphore.checked)};
      else if(action==='delete-crossing')request.index=point.recordIndex;
      else {
        request.from=point.recordIndex;request.to=Number(target.value);
        if(action==='connect'){
          const source=file.crossings[request.from].position,destination=file.crossings[request.to].position,count=Number(positions.value);
          if(!Number.isInteger(count)||count<1||count>4096)throw new Error('Počet bodů musí být celé číslo 1 až 4096.');
          request={...request,positions:Array.from({length:count},(_,i)=>source.map((n,axis)=>n+(destination[axis]-n)*(i+1)/(count+1))),speed:Number(velocity.value),forwardLanes:laneValues(forward),reverseLanes:laneValues(reverse),forwardPriority:Number(priorities[0].value),reversePriority:Number(priorities[1].value)};
        }
      }
      const result=await api.changeRoadTopology(file.path,request,file.sha256);state.file=result.file;state.roadIndex=result.index;
      if(state.viewport?.roadPath===file.path)state.viewport.selectedPoint=result.index;
      dialog.close();await refresh();renderDetail();status('Silniční síť uložená do modu se zálohou a undo.');
    }catch(error){message.textContent=error.message;throw error;}finally{save.disabled=cancel.disabled=false;fields.inert=false;}
  });};
  dialog.addEventListener('cancel',event=>{if(state.busy)event.preventDefault();});dialog.addEventListener('close',()=>dialog.remove(),{once:true});document.body.append(dialog);dialog.showModal();
}
