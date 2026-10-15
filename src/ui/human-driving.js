import { humanDrivingTargets, resolveHumanDriving } from '../shared/human-driving.js';
import { missionTaskVehicles } from '../shared/mission-task.js';
import { missionFlowTargets } from '../shared/mission-flow.js';

export function humanDrivingFields({element,file,roads,owner,initial,onChange}){
  const root=element('section'),fields=element('div',undefined,'mission-fields'),rows=element('div'),add=element('button','Přidat cíl jízdy'),cars=missionTaskVehicles(file),stops=initial?.stops?.map(stop=>({...stop}))??[];
  const field=(label,input)=>{const row=element('label',label);input.setAttribute('aria-label',label);row.append(input);fields.append(row);return input;};
  const car=field('Řízené auto',element('select')),boarding=field('Nástup do auta',element('select')),delay=field('Prodleva před jízdou (sekundy)',element('input')),loop=field('Opakovat jízdu',element('input'));
  car.required=true;for(const actor of cars){const option=element('option',actor.name);option.value=actor.name;car.append(option);}
  if(initial?.carName&&!cars.some(actor=>actor.name===initial.carName)){const option=element('option',`${initial.carName} · nedostupné auto`);option.value=initial.carName;car.append(option);}
  if(initial?.carName)car.value=initial.carName;
  for(const [value,label]of [['walk','Dojít a nastoupit jako řidič'],['seated','Začít na sedadle řidiče']]){const option=element('option',label);option.value=value;boarding.append(option);}boarding.value=initial?.boarding??'walk';
  delay.type='number';delay.required=true;delay.min='0';delay.max='86400';delay.step='any';delay.value=String(initial?.delaySeconds??0);loop.type='checkbox';loop.checked=initial?.loop??false;
  const signalField=(label,empty,value)=>{
    const select=field(label,element('select')),none=element('option',empty);none.value='';select.append(none);
    const targets=missionFlowTargets(file);for(const target of targets){const option=element('option',target.name);option.value=target.name;select.append(option);}
    if(value&&!targets.some(target=>target.name===value)){const option=element('option',`${value} · nedostupné`);option.value=value;select.append(option);}
    select.value=value??'';return select;
  };
  const start=signalField('Spustit jízdu po signálu bodu','Po načtení mise',initial?.startSignal),complete=signalField('Po dokončení jízdy poslat signál bodu','Bez návaznosti',initial?.onComplete);
  let targetKey=null;
  const list=element('datalist');list.id=`driving-targets-${crypto.randomUUID()}`;
  function render(){
    rows.replaceChildren();stops.forEach((stop,index)=>{
      const row=element('div',undefined,'mission-fields'),target=element('input'),pause=element('input'),actions=element('div',undefined,'tools');
      target.required=true;target.value=stop.name;target.setAttribute('list',list.id);target.setAttribute('aria-label',`Cíl jízdy ${index+1}`);pause.type='number';pause.required=true;pause.min='0';pause.max='86400';pause.step='any';pause.value=String(stop.pauseSeconds);pause.setAttribute('aria-label',`Čekání u cíle jízdy ${index+1} (sekundy)`);
      target.oninput=()=>{stop.name=target.value;onChange();};pause.oninput=()=>{stop.pauseSeconds=pause.value===''?NaN:Number(pause.value);onChange();};
      const a=element('label',`${index+1}. Cíl`),b=element('label','Čekání po zastavení (sekundy)');a.append(target);b.append(pause);
      for(const [label,offset]of [['Nahoru',-1],['Dolů',1],['Odebrat',0]]){const button=element('button',label);button.type='button';button.setAttribute('aria-label',`${label} cíl jízdy ${index+1}`);button.disabled=Boolean(offset&&(index+offset<0||index+offset>=stops.length));button.onclick=()=>{if(offset)[stops[index],stops[index+offset]]=[stops[index+offset],stops[index]];else stops.splice(index,1);render();onChange();};actions.append(button);}
      row.append(a,b,actions);rows.append(row);
    });
  }
  add.type='button';add.onclick=()=>{const targets=humanDrivingTargets(file,owner(),car.value);if(!targets.length||stops.length>=32)return;stops.push({name:targets[stops.length%targets.length].name,pauseSeconds:1});render();onChange();};
  for(const input of [car,boarding,delay,loop,start,complete]){input.oninput=onChange;input.onchange=onChange;}
  root.append(element('h3','Trasa vozidla'),fields,element('p','Cíle jsou názvy nepohyblivých objektů nebo skriptových bodů. Umístěte auto i cíle blízko silniční sítě a na průchozí povrch. Nástup začne až po případném signálu a prodlevě; začátek na sedadle přesune NPC přímo do auta. Sedadlo musí být volné. Dokončení lze poslat jen po jednorázové jízdě a posledním čekání. Návaznosti najdete v Logice mise.'),rows,list,add);render();
  return {root,options(){return resolveHumanDriving(file,owner(),{mode:'drive',carName:car.value,boarding:boarding.value,delaySeconds:delay.value===''?NaN:Number(delay.value),loop:loop.checked,stops:stops.map(stop=>({...stop})),startSignal:start.value||null,onComplete:complete.value||null,roadHash:roads?.sha256},roads);},setActive(active){root.style.display=active?'':'none';for(const input of root.querySelectorAll('input,select'))input.disabled=!active;if(!active){add.disabled=true;return;}const nextKey=JSON.stringify([owner(),car.value]);if(targetKey!==nextKey){targetKey=nextKey;list.replaceChildren(...humanDrivingTargets(file,owner(),car.value).map(frame=>{const option=element('option');option.value=frame.name;return option;}));}add.disabled=!list.children.length||stops.length>=32;}};
}
