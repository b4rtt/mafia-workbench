import {osmTrafficPlan,validateOsmTraffic} from './traffic.js';

export function osmTrafficControls({element,field,numeric,api,onChange}){
  const section=element('details'),enabled=element('input'),fields=element('div',undefined,'osm-location'),reload=element('button','Načíst rodiny aut'),list=element('div',undefined,'osm-ways'),report=element('p');
  enabled.type='checkbox';reload.type='button';section.append(element('summary','Automobilový provoz'));field('Zapnout automatický provoz',enabled,section);
  const density=numeric('Hustota provozu (1–100)',20,1,100,fields);density.step='1';
  section.append(element('p','Jeden jízdní pruh v každém povoleném směru; poloha vychází ze šířky vozovky. Příliš úzká ulice zastaví import. Vyberte 1–32 ověřených rodin aut, se stejnou pravděpodobností a jednou barevnou variantou. Hustota je parametr enginu, nikoli přesný počet aut. Vyžaduje povrchy ulic. Rychlost zůstává 1,2 v herních jednotkách; rychlosti a zákazy odbočení z OSM, automatická policie ani chodci se tímto negenerují.'),fields,reload,list,report);
  let catalog=null,selected=new Set(),plan=null,waiting=false,loading=false,lastError='';
  const settings=()=>({version:1,density:Number(density.value),tableHash:catalog?.tableHash,models:(catalog?.models??[]).filter(m=>selected.has(m.path)).map(({path,table,sha256,width})=>({path,table,sha256,width}))});
  function busy(value){waiting=value;value=value||loading;enabled.disabled=value;reload.disabled=value||!enabled.checked;density.disabled=value||!enabled.checked;for(const input of list.querySelectorAll('input'))input.disabled=value||!enabled.checked;}
  async function load(saved){
    catalog=null;lastError='';const result=await api.osmTrafficModels();
    if(saved){validateOsmTraffic(saved);if(result.tableHash!==saved.tableHash||saved.models.some(m=>!result.models.some(c=>c.path===m.path&&c.table===m.table&&c.sha256===m.sha256&&c.width===m.width)))throw Error('Tabulka nebo modely aut se změnily. Načtěte katalog znovu.');}
    catalog=result;selected=new Set(saved?.models.map(m=>m.path)??catalog.models.filter(m=>['taxi','arrow'].includes(m.table.toLowerCase())).map(m=>m.path));if(!saved&&!selected.size&&catalog.models[0])selected.add(catalog.models[0].path);
    list.replaceChildren();for(const m of catalog.models){const row=element('label',undefined,'osm-way'),input=element('input');input.type='checkbox';input.checked=selected.has(m.path);input.onchange=()=>{if(input.checked)selected.add(m.path);else selected.delete(m.path);onChange();};row.append(input,element('span',`${m.table} · šířka modelu ${m.width.toFixed(2)} m · ${m.path.slice(7)}`));list.append(row);}for(const warning of catalog.warnings)list.append(element('p',warning,'notice'));
  }
  async function reloadModels(){if(waiting||loading)return;loading=true;catalog=null;busy(waiting);onChange();try{await load();}catch(error){catalog=null;lastError=error.message;}finally{loading=false;onChange();busy(waiting);}}
  reload.onclick=reloadModels;enabled.onchange=()=>{if(enabled.checked&&!catalog)void reloadModels();else onChange();};density.addEventListener('input',onChange);
  return {section,busy,settings,get enabled(){return enabled.checked;},get ready(){return !loading&&Boolean(plan);},invalidate(){plan=null;report.textContent='Načtěte oblast.';},
    async accept(source,saved){plan=null;enabled.checked=Boolean(saved);density.value=saved?.density??20;if(saved)await load(saved);},
    update(roads,surface){plan=null;report.textContent=!enabled.checked?'Automobilový provoz je vypnutý.':!catalog?(lastError||'Načtěte rodiny aut z projektu.'):!roads?'Načtěte oblast a vyberte ulice.':'';if(enabled.checked&&catalog&&roads){try{plan=osmTrafficPlan(roads,surface,settings());report.textContent=`${plan.models.length} rodin aut · hustota ${plan.density} · ${plan.roads.length} úseků · minimální průjezdný pás ${plan.clearance.toFixed(2)} m na směr. ${catalog.warnings.length} nepodporovaných modelů.`;}catch(error){report.textContent=error.message;}}}
  };
}
