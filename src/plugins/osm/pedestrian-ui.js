import {osmPedestrianPlan,validateOsmPedestrians} from './pedestrians.js';

export function osmPedestrianControls({element,field,numeric,api,onChange}){
  const section=element('details'),enabled=element('input'),fields=element('div',undefined,'osm-location'),reload=element('button','Načíst civilní modely'),list=element('div',undefined,'osm-ways'),report=element('p');
  enabled.type='checkbox';reload.type='button';section.append(element('summary','Chodci a pěší navigace'));field('Vytvořit chodce na chodnících',enabled,section);
  const density=numeric('Hustota chodců (1–100)',30,1,100,fields),capacity=numeric('Kapacita každého modelu (1–20)',3,1,20,fields);density.step=capacity.step='1';
  section.append(element('p','Nativní chodci a upravitelný check.bin podle vygenerovaných chodníků. Trasy mají odstup 0,4 m od hran, domů a základny mobiliáře; příliš úzká místa se vynechají. Oddělené chodníky se nepropojují přes vozovku. Parkové cesty, přechody a policie vyžadují další úpravy. Vyberte 1–16 civilních modelů. Kapacita je horní počet na model; skutečný výskyt řídí engine podle hustoty a kamery.'),fields,reload,list,report);
  let catalog=null,selected=new Set(),plan=null,waiting=false,loading=false,lastError='';
  const settings=()=>({version:1,density:Number(density.value),capacity:Number(capacity.value),models:(catalog?.models??[]).filter(m=>selected.has(m.path)).map(m=>({...m}))});
  function busy(value){waiting=value;value=value||loading;enabled.disabled=value;reload.disabled=value||!enabled.checked;for(const input of [density,capacity,...list.querySelectorAll('input')])input.disabled=value||!enabled.checked;}
  async function load(saved){
    catalog=null;lastError='';const result=await api.osmPedestrianModels();
    if(saved){validateOsmPedestrians(saved);if(saved.models.some(m=>!result.models.some(c=>c.path===m.path&&c.model===m.model&&c.sha256===m.sha256)))throw Error('Civilní modely se změnily; načtěte katalog znovu.');}
    catalog=result;selected=new Set(saved?.models.map(m=>m.path)??catalog.models.filter(m=>/^civil(?:13|16)\.i3d$/i.test(m.model)).map(m=>m.path));if(!saved&&!selected.size&&catalog.models[0])selected.add(catalog.models[0].path);
    list.replaceChildren();for(const m of catalog.models){const row=element('label',undefined,'osm-way'),input=element('input');input.type='checkbox';input.checked=selected.has(m.path);input.onchange=()=>{if(input.checked)selected.add(m.path);else selected.delete(m.path);onChange();};row.append(input,element('span',m.model));list.append(row);}for(const warning of catalog.warnings)list.append(element('p',warning,'notice'));
  }
  async function reloadModels(){if(waiting||loading)return;loading=true;catalog=null;busy(waiting);onChange();try{await load();}catch(error){catalog=null;lastError=error.message;}finally{loading=false;onChange();busy(waiting);}}
  reload.onclick=reloadModels;enabled.onchange=()=>{if(enabled.checked&&!catalog)void reloadModels();else onChange();};for(const input of [density,capacity])input.addEventListener('input',onChange);
  return {section,busy,settings,get enabled(){return enabled.checked;},get ready(){return !loading&&Boolean(plan);},invalidate(){plan=null;report.textContent='Načtěte oblast.';},
    async accept(source,saved){plan=null;enabled.checked=Boolean(saved);density.value=saved?.density??30;capacity.value=saved?.capacity??3;if(saved)await load(saved);},
    update(source,roads,surface,props){plan=null;report.textContent=!enabled.checked?'Chodci jsou vypnutí.':!catalog?(lastError||'Načtěte civilní modely z projektu.'):!roads?'Načtěte oblast a vyberte ulice.':'';if(enabled.checked&&catalog&&roads){try{validateOsmPedestrians(settings());plan=osmPedestrianPlan(source,roads,surface,props);report.textContent=`${plan.positions.length} pěších bodů · ${plan.links.length} obousměrných spojení · ${plan.components} oddělených oblastí · kapacita nejvýše ${settings().models.length*settings().capacity} chodců. ${catalog.warnings.length} nepodporovaných modelů.`;}catch(error){report.textContent=error.message;}}},
    draw(context,point){if(!enabled.checked||!plan)return;context.strokeStyle='#9843b0';context.lineWidth=1;context.beginPath();for(const [a,b]of plan.links){context.moveTo(...point(plan.positions[a]));context.lineTo(...point(plan.positions[b]));}context.stroke();}
  };
}
