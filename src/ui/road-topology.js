import {roadConnections,roadDissolvePlan,roadMergePlan} from '../shared/roads.js';
import {roadCurvePlan} from '../shared/road-curve.js';

export function roadTopologyDialog(file,action,point,{element,state,api,run,refresh,renderDetail,status}) {
  const format=position=>position.map(n=>Number(n.toPrecision(7))).join(', ');
  const titles={'round-node':'Zaoblit silniční ohyb','create-crossing':'Nová křižovatka','split-crossing':'Vytvořit křižovatku z bodu','dissolve-crossing':'Spojit silnice přes křižovatku','merge-crossings':'Sloučit dvě křižovatky',connect:'Propojit křižovatky',disconnect:'Odstranit silniční propojení','delete-crossing':'Odstranit volnou křižovatku'};
  const dialog=element('dialog',undefined,'road-topology-dialog'),form=element('form',undefined,'mission-form'),fields=element('div',undefined,'mission-fields');dialog.append(element('h2',titles[action]),form);
  const field=(label,input,parent=fields)=>{const row=element('label',label);input.setAttribute('aria-label',label);row.append(input);parent.append(row);return input;};
  const numeric=(label,value,{min,step='any',parent=fields}={})=>{const input=element('input');input.type='number';input.step=step;input.value=String(value);input.required=true;if(min!==undefined)input.min=String(min);return field(label,input,parent);};
  let target,positions,velocity,semaphore,forward,reverse,priorities,updateMerge,radius,updateCurve,blocked=false;
  if(action==='round-node'){
    form.append(element('p','Vybraný mezilehlý bod nahradí kruhový oblouk tečný k oběma sousedním úsekům. Poloměr se musí vejít mezi sousedy; ostatní ohyby zůstanou na místě. Nové body převezmou rychlost vybraného bodu, výška lineárně propojí konce oblouku. Pruhy a směry zůstanou zachované. Změna má jeden krok undo.','notice'));
    form.append(element('p','Upravuje se jen navigace aut. Vozovka a kolize se nemění; průjezd celé karoserie je třeba ověřit vůči skutečné ulici.','notice'));
    let initial=1;try{initial=roadCurvePlan(file,point.recordIndex).radius;}catch{}
    radius=numeric('Poloměr ohybu (m)',Number(initial.toPrecision(7)),{min:.05});
    const preview=element('div');preview.style.gridColumn='1 / -1';fields.append(preview);
    updateCurve=()=>{
      preview.replaceChildren();blocked=true;
      try{
        if(radius.value==='')throw Error('Zadejte poloměr ohybu.');
        const plan=roadCurvePlan(file,point.recordIndex,Number(radius.value)),points=[...plan.original,...plan.positions];
        preview.append(element('p',`Poloměr ${plan.radius.toLocaleString('cs')} m · ohyb ${(plan.angle*180/Math.PI).toFixed(1)}° · ${plan.positions.length} nových bodů místo jednoho. Největší poloměr mezi sousedy: ${plan.maxRadius.toFixed(3)} m.`));
        const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 360 180');svg.setAttribute('role','img');svg.setAttribute('aria-label','Náhled zaoblení silničního ohybu shora');svg.style.cssText='width:100%;height:180px;background:var(--panel-bg, #182123);border-radius:6px';
        const xs=points.map(p=>p[0]),zs=points.map(p=>p[2]),minX=Math.min(...xs),minZ=Math.min(...zs),scale=Math.min(320/Math.max(1,Math.max(...xs)-minX),140/Math.max(1,Math.max(...zs)-minZ)),project=p=>[20+(p[0]-minX)*scale,160-(p[2]-minZ)*scale];
        for(const [i,line]of [plan.original,[plan.original[0],...plan.positions,plan.original[2]]].entries()){
          const poly=document.createElementNS(svg.namespaceURI,'polyline');poly.setAttribute('points',line.map(p=>project(p).join(',')).join(' '));poly.setAttribute('fill','none');poly.setAttribute('stroke',i?'#8bb8e8':'#e98989');poly.setAttribute('stroke-width','3');if(!i)poly.setAttribute('stroke-dasharray','5 5');svg.append(poly);
        }
        preview.append(svg,element('p','Modře: nová osa. Červeně přerušovaně: původní ohyb. Náhled v XZ nezobrazuje šířku auta ani povrch ulice.','notice'));blocked=false;
      }catch(error){preview.append(element('p',error.message,'notice'));}
      save.disabled=blocked;
    };radius.oninput=()=>updateCurve();
  }else if(action==='create-crossing'){
    form.append(element('p','Volná křižovatka má až čtyři výjezdy. Po vložení ji vyberte a propojte s jinou křižovatkou. Tento krok vytváří navigaci aut; model vozovky ani kolize nepřidává.','notice'));
    const origin=point?.position??[0,0,0];positions=['X','Y','Z'].map((axis,i)=>numeric(`Pozice ${axis}`,origin[i]+(i===0&&point?5:0)));
    velocity=numeric('Rychlost (herní jednotky)',1.2,{min:0});semaphore=element('input');semaphore.type='checkbox';field('Semafor — příznak pro kontrolu policie',semaphore);
  }else if(action==='split-crossing'){
    const source=file.nodes[point.recordIndex];
    form.append(element('p',`Bod ${point.recordIndex}: ${format(source.position)}. Nová křižovatka nahradí tento bod ve stejné poloze. Obě části cesty zachovají původní povolené i vypnuté směry, pruhy a priority; zbývající dva výjezdy jsou volné pro odbočky. Pokud některé části chybí silniční bod, doplní se uprostřed úseku. Vozovka ani kolize se nemění.`,'notice'));
    velocity=numeric('Rychlost křižovatky (herní jednotky)',Math.max(0,source.speed),{min:0});semaphore=element('input');semaphore.type='checkbox';field('Semafor — příznak pro kontrolu policie',semaphore);
  }else if(action==='dissolve-crossing'){
    form.append(element('p','Vybraná křižovatka se změní na běžný silniční bod. Průběh cesty, rychlosti bodů a vnější pruhy i priority zůstanou zachované. Zaniknou výjezdy a parametry této křižovatky včetně semaforu. Vozovka ani kolize se nemění. Celá změna má jeden krok undo.','notice'));
    try{
      const plan=roadDissolvePlan(file,point.recordIndex);
      form.append(element('p',`Křižovatka ${plan.from} → bod místo křižovatky ${plan.index} → křižovatka ${plan.to}. Směr tam: ${plan.forwardEnabled?'povolený':'vypnutý'}, zpět: ${plan.reverseEnabled?'povolený':'vypnutý'}.`));
      const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 360 150');svg.setAttribute('role','img');svg.setAttribute('aria-label','Náhled spojené silnice shora');svg.style.cssText='width:100%;height:150px;background:var(--panel-bg, #182123);border-radius:6px';
      const xs=plan.positions.map(p=>p[0]),zs=plan.positions.map(p=>p[2]),minX=Math.min(...xs),minZ=Math.min(...zs),scale=Math.min(320/Math.max(1,Math.max(...xs)-minX),110/Math.max(1,Math.max(...zs)-minZ));
      const projected=plan.positions.map(p=>[20+(p[0]-minX)*scale,130-(p[2]-minZ)*scale]);
      const line=document.createElementNS(svg.namespaceURI,'polyline');line.setAttribute('points',projected.map(p=>p.join(',')).join(' '));line.setAttribute('fill','none');line.setAttribute('stroke','#8bb8e8');line.setAttribute('stroke-width','3');svg.append(line);
      for(const i of [0,plan.chain.indexOf(plan.index)+1,projected.length-1]){const dot=document.createElementNS(svg.namespaceURI,'circle');dot.setAttribute('cx',projected[i][0]);dot.setAttribute('cy',projected[i][1]);dot.setAttribute('r','5');dot.setAttribute('fill',i===0||i===projected.length-1?'#8bb8e8':'#ffd35b');svg.append(dot);}
      form.append(svg,element('p','Modře: koncové křižovatky. Žlutě: nový mezilehlý bod. Náhled ukazuje osu v rovině XZ.','notice'));
    }catch(error){blocked=true;form.append(element('p',error.message,'notice'));}
  }else if(action==='merge-crossings'){
    const from=point.recordIndex;
    form.append(element('p',`Křižovatka ${from} se sloučí do vybraného souseda. Zachová se sousedova poloha, rychlost a příznak semaforu. Společná cesta včetně všech jejích bodů a parametry křižovatky ${from} zaniknou; ostatní cesty zachovají body, pruhy i priority a přepojí se do souseda. Maximálně čtyři výjezdy. Vozovka ani kolize se nemění. Změnu lze vrátit jedním undo.`,'notice'));
    target=field('Zachovat křižovatku',element('select'));target.required=true;
    for(const index of new Set(roadConnections(file,from).map(leg=>leg.target))){const option=element('option',`Křižovatka ${index} · ${format(file.crossings[index].position)}`);option.value=String(index);target.append(option);}
    const preview=element('div');preview.style.gridColumn='1 / -1';fields.append(preview);
    updateMerge=()=>{
      preview.replaceChildren();blocked=true;
      try{
        const plan=roadMergePlan(file,from,Number(target.value)),destination=file.crossings[plan.to].position;
        preview.append(element('p',`Zůstane křižovatka ${plan.to} na ${format(destination)}. Odstraněné body společné cesty: ${plan.connector.nodes.length}. Výjezdy po sloučení: ${plan.moved.length+plan.retained.length}/4.`));
        const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 360 180');svg.setAttribute('role','img');svg.setAttribute('aria-label','Náhled sloučení křižovatek shora');svg.style.cssText='width:100%;height:180px;background:var(--panel-bg, #182123);border-radius:6px';
        const lines=[...plan.moved,...plan.retained].map(leg=>[destination,...leg.nodes.map(ref=>file.nodes[ref&32767].position),file.crossings[leg.target].position]),discarded=[file.crossings[from].position,...plan.connector.nodes.map(ref=>file.nodes[ref&32767].position),destination];
        const points=[...lines.flat(),...discarded],xs=points.map(p=>p[0]),zs=points.map(p=>p[2]),minX=Math.min(...xs),minZ=Math.min(...zs),scale=Math.min(320/Math.max(1,Math.max(...xs)-minX),140/Math.max(1,Math.max(...zs)-minZ)),project=p=>[20+(p[0]-minX)*scale,160-(p[2]-minZ)*scale];
        for(const [i,line]of [...lines,discarded].entries()){const poly=document.createElementNS(svg.namespaceURI,'polyline');poly.setAttribute('points',line.map(p=>project(p).join(',')).join(' '));poly.setAttribute('fill','none');poly.setAttribute('stroke',i===lines.length?'#e98989':'#8bb8e8');poly.setAttribute('stroke-width','3');if(i===lines.length)poly.setAttribute('stroke-dasharray','5 5');svg.append(poly);}
        const dot=document.createElementNS(svg.namespaceURI,'circle'),[x,y]=project(destination);dot.setAttribute('cx',x);dot.setAttribute('cy',y);dot.setAttribute('r','6');dot.setAttribute('fill','#ffd35b');svg.append(dot);
        preview.append(svg,element('p','Modře: výsledné cesty. Červeně přerušovaně: odstraněná cesta. Žlutě: zachovaná křižovatka. Náhled os v XZ.','notice'));blocked=false;
      }catch(error){preview.append(element('p',target.options.length?error.message:'Žádná propojená křižovatka.','notice'));}
      save.disabled=blocked;
    };target.onchange=()=>updateMerge();
  }else if(action==='connect'||action==='disconnect'){
    const from=point.recordIndex,source=file.crossings[from];form.append(element('p',`Z křižovatky ${from}: ${format(source.position)}`));
    target=field('Cílová křižovatka',element('select'));
    const connections=roadConnections(file,from);
    const candidates=file.crossings.filter(c=>c.index!==from&&(action==='connect'?c.links.some((ref,i)=>ref===65535&&c.directions[i].target===65535)&&!source.directions.some(d=>d.target===c.index)&&!c.directions.some(d=>d.target===from)&&!connections.some(d=>d.target===c.index)&&!roadConnections(file,c.index).some(d=>d.target===from):connections.some(d=>d.target===c.index)));
    for(const crossing of candidates){const option=element('option',`Křižovatka ${crossing.index} · ${format(crossing.position)}`);option.value=String(crossing.index);target.append(option);}
    target.required=true;
    if(!candidates.length)form.append(element('p','Žádná vhodná křižovatka. Vytvořte další nebo nejprve uvolněte obsazené propojení.','notice'));
    if(action==='connect'){
      positions=numeric('Počet mezilehlých bodů',2,{min:1,step:'1'});positions.max='4096';velocity=numeric('Rychlost nových bodů (herní jednotky)',Math.max(0,source.speed),{min:0});
      form.append(element('p','Body začnou na přímce mezi křižovatkami. Po vytvoření je můžete posouvat ve 3D nebo doplnit další. Pro jednosměrnou cestu vypněte jeden směr. Povolený směr potřebuje aktivní pruh. Boční posun je původní hodnota vzdálenosti pruhu od osy cesty.','notice'));
      function laneFields(label){
        const enabled=element('input');enabled.type='checkbox';enabled.checked=true;field(`Povolit ${label.toLocaleLowerCase('cs')}`,enabled);
        const details=element('details'),grid=element('fieldset',undefined,'mission-fields');details.append(element('summary',label),grid);fields.append(details);enabled.onchange=()=>{grid.disabled=!enabled.checked;};
        const priority=numeric(`${label} · priorita`,100,{min:0,step:'1',parent:grid});priority.max='4294967295';
        const lanes=Array.from({length:4},(_,i)=>{
          const laneRow=element('fieldset',undefined,'road-lane');laneRow.append(element('legend',`Pruh ${i+1}`));grid.append(laneRow);const type=element('select');for(const [value,name] of [[0,'Vypnutý'],[1,'AI — bez běžného provozu'],[2,'Provoz'],[3,'Podélné parkování']]){const option=element('option',name);option.value=String(value);type.append(option);}type.value=String(i===0?2:0);field(`${label} · pruh ${i+1} · typ`,type,laneRow);
          const distance=numeric(`${label} · pruh ${i+1} · boční posun`,i===0?1.5:4,{parent:laneRow});return {type,distance};
        });return {enabled,priority,lanes};
      }
      forward=laneFields('Směr tam');reverse=laneFields('Směr zpět');priorities=[forward.priority,reverse.priority];
    }else form.append(element('p','Odstraní se oba výjezdy a celý jejich společný řetězec bodů. Další cesty zůstanou připojené; úhly a číslování se upraví společně. Sdílené nebo nejednoznačné řetězce se neodstraní.','notice'));
  }else form.append(element('p',`Křižovatka ${point.recordIndex} se odstraní pouze tehdy, když ji nepoužívá žádná cesta ani jiný bod. Ostatní indexy a reference se přemapují.`));
  const message=element('p','','notice'),actions=element('div',undefined,'tools'),cancel=element('button','Zrušit'),save=element('button',action==='round-node'?'Zaoblit v modu':action==='merge-crossings'?'Sloučit křižovatky':action==='dissolve-crossing'?'Spojit silnice':action.startsWith('delete')||action==='disconnect'?'Odstranit z modu':'Vytvořit v modu','primary');cancel.type='button';cancel.onclick=()=>dialog.close();save.type='submit';save.disabled=blocked||Boolean(target&&!target.options.length);actions.append(cancel,save);form.append(fields,message,actions);updateMerge?.();updateCurve?.();
  const laneValues=direction=>direction.lanes.map(lane=>({type:Number(lane.type.value),distance:Number(lane.distance.value)}));
  form.onsubmit=event=>{event.preventDefault();if(blocked||state.busy||!form.reportValidity())return;run(async()=>{
    save.disabled=cancel.disabled=true;fields.inert=true;
    try{
      let request={action};
      if(action==='round-node')request={...request,index:point.recordIndex,radius:Number(radius.value)};
      else if(action==='create-crossing')request={...request,position:positions.map(input=>Number(input.value)),speed:Number(velocity.value),semaphore:Number(semaphore.checked)};
      else if(action==='split-crossing')request={...request,index:point.recordIndex,speed:Number(velocity.value),semaphore:Number(semaphore.checked)};
      else if(action==='delete-crossing'||action==='dissolve-crossing')request.index=point.recordIndex;
      else {
        request.from=point.recordIndex;request.to=Number(target.value);
        if(action==='connect'){
          const source=file.crossings[request.from].position,destination=file.crossings[request.to].position,count=Number(positions.value);
          if(!Number.isInteger(count)||count<1||count>4096)throw new Error('Počet bodů musí být celé číslo 1 až 4096.');
          request={...request,positions:Array.from({length:count},(_,i)=>source.map((n,axis)=>n+(destination[axis]-n)*(i+1)/(count+1))),speed:Number(velocity.value),forwardEnabled:forward.enabled.checked,reverseEnabled:reverse.enabled.checked,forwardLanes:laneValues(forward),reverseLanes:laneValues(reverse),forwardPriority:Number(priorities[0].value),reversePriority:Number(priorities[1].value)};
        }
      }
      const result=await api.changeRoadTopology(file.path,request,file.sha256);state.file=result.file;state.roadIndex=result.index;
      if(state.viewport?.roadPath===file.path)state.viewport.selectedPoint=result.index;
      dialog.close();await refresh();renderDetail();status('Silniční síť uložená do modu se zálohou a undo.');
    }catch(error){message.textContent=error.message;throw error;}finally{save.disabled=blocked;cancel.disabled=false;fields.inert=false;}
  });};
  dialog.addEventListener('cancel',event=>{if(state.busy)event.preventDefault();});dialog.addEventListener('close',()=>dialog.remove(),{once:true});document.body.append(dialog);dialog.showModal();
}
