// A single scene property holds the table, so structural row edits share undo.
export function populationControl(entry,draft,{element,assets,api,onChange}) {
  const cars=entry.actorKind===12,root=element('div',undefined,'population-control'),models=structuredClone(draft.models),budget=element('input'),list=element('div',undefined,'population-models'),add=element('button','Přidat model'),suggestions=element('datalist'),note=element('p',undefined,'notice');
  budget.type='number';budget.step='1';budget.min='0';budget.max='100';budget.value=String(draft.budget);budget.setAttribute('aria-label','Hustota generátoru');
  const heading=element('label','Hustota (0–100)');heading.append(budget);root.append(heading,note,list,suggestions,add);
  suggestions.id=`population-models-${entry.nodeId.replaceAll('/','-')}`;add.type='button';
  note.textContent=cars?'Váha určuje poměr výskytu modelu. Nastavení hustoty na 0 vynuluje také váhy; pro opětovné zapnutí je vyplňte. Limit barev je původní parametr 1–10, nikoli konkrétní odstín. Příznaky jsou původní bajty. Změna se projeví po novém načtení mise.':'Kapacity určují počet připravených postav jednotlivých modelů. Nastavení hustoty na 0 vynuluje také kapacity; pro opětovné zapnutí je vyplňte. Pohyb závisí na navigaci mise a nastavení hry.';
  function suggestionsFrom(names){suggestions.replaceChildren();for(const name of [...new Set(names)].sort((a,b)=>a.localeCompare(b))){const option=element('option');option.value=name;suggestions.append(option);}}
  if(cars){add.disabled=true;api.carModels().then(catalog=>{if(!root.isConnected)return;suggestionsFrom(catalog.models.map(model=>model.table).filter(name=>name.length<20));add.disabled=false;}).catch(error=>{if(root.isConnected){note.textContent+=' Nabídka aut není dostupná: '+error.message;add.disabled=false;}});}
  else suggestionsFrom(assets.filter(asset=>/^models\/[^/\\]+\.4ds$/i.test(asset.path)).map(asset=>asset.path.slice(7).replace(/\.4ds$/i,'.i3d')).filter(name=>name.length<17));
  const numeric=(label,value,min,max,step,onInput)=>{const wrapper=element('label',label),input=element('input');input.type='number';input.step=step;input.min=String(min);input.max=String(max);input.value=String(value);input.setAttribute('aria-label',label);input.oninput=()=>{onInput(input.value.trim()===''?NaN:Number(input.value));onChange();};wrapper.append(input);return wrapper;};
  function fill(){
    list.replaceChildren();
    models.forEach((row,index)=>{
      const details=element('details'),summary=element('summary'),panel=element('fieldset',undefined,'population-model'),legend=element('legend',`Model ${index+1}`),name=element('input'),label=element('label',cars?'Rodina auta':'Model postavy'),remove=element('button',`Odebrat model ${index+1}`);
      const summaryText=()=>summary.textContent=`${row.model||'Nový model'} · ${cars?'váha '+row.weight:'kapacita '+row.capacity}`;
      summaryText();details.open=index===0||row.sourceIndex===null;details.append(summary,panel);
      name.type='text';name.value=row.model;name.maxLength=cars?19:16;name.setAttribute('list',suggestions.id);name.setAttribute('aria-label',`${cars?'Rodina auta':'Model postavy'} ${index+1}`);name.oninput=()=>{row.model=name.value;summaryText();onChange();};label.append(name);panel.append(legend,label);remove.type='button';remove.onclick=()=>{models.splice(index,1);fill();onChange();};
      if(cars){panel.append(numeric(`Váha modelu ${index+1}`,row.weight,0,1e9,'any',v=>row.weight=v),numeric(`Limit barev modelu ${index+1}`,row.colors,1,10,'1',v=>row.colors=v));const raw=element('details'),flags=element('div',undefined,'numeric-fields');raw.append(element('summary','Příznaky auta (raw)'),flags);for(let i=0;i<4;i++)flags.append(numeric(`Příznak ${i+1} modelu ${index+1}`,row.flags[i],0,255,'1',v=>row.flags[i]=v));panel.append(raw);}
      else panel.append(numeric(`Kapacita modelu ${index+1}`,row.capacity,0,1000,'1',v=>row.capacity=v));
      panel.append(remove);panel.addEventListener('input',summaryText);list.append(details);
    });
  }
  budget.oninput=()=>{if(budget.value.trim()!==''&&Number(budget.value)===0){for(const row of models)row[cars?'weight':'capacity']=0;fill();}onChange();};
  add.onclick=()=>{models.push(cars?{sourceIndex:null,model:'',weight:Number(budget.value)===0?0:1,colors:1,flags:[0,0,0,0]}:{sourceIndex:null,model:'',capacity:Number(budget.value)===0?0:15});fill();onChange();};
  const draftValue=()=>({budget:budget.value.trim()===''?NaN:Number(budget.value),models:structuredClone(models)});
  fill();return {control:root,draft:draftValue,value:()=>{const value=draftValue();if(!Number.isInteger(value.budget)||value.budget<0||value.budget>100||models.some(row=>!row.model.trim()||(cars?!Number.isFinite(row.weight)||row.weight<0||!Number.isInteger(row.colors)||row.colors<1||row.colors>10||row.flags.some(v=>!Number.isInteger(v)||v<0||v>255):!Number.isInteger(row.capacity)||row.capacity<0||row.capacity>1000)))throw Error('Neplatné nastavení generátoru');return value;}};
}
