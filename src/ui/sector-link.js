import {Viewport} from './viewport.js';
import {sectorLinkPlan,sectorWorldPoints} from '../shared/sector-link.js';

export function sectorLinkDialog(context,{element,run,status,save,editPair}){
  const source=context.sectors.find(s=>s.id===context.sourceId),dialog=element('dialog',undefined,'geometry-dialog'),tools=element('div',undefined,'tools'),portal=element('select'),target=element('select'),fit=element('button','Zarámovat oba sektory'),area=element('div',undefined,'viewport'),message=element('p','','notice'),actions=element('div',undefined,'tools'),cancel=element('button','Zrušit'),submit=element('button','Vytvořit protilehlý portál','primary');
  portal.setAttribute('aria-label','Zdrojový portál');target.setAttribute('aria-label','Sousední sektor');
  source.sector.portals.forEach((p,i)=>{const option=element('option',`Portál ${i+1} · ${p.positions.length/3} bodů`);option.value=String(i);portal.append(option);});
  const empty=element('option','Vyberte sousední sektor…');empty.value='';target.append(empty);
  for(const sector of context.sectors.filter(s=>s.id!==source.id)){const option=element('option',sector.name);option.value=String(sector.id);target.append(option);}
  const edit=element('button','Upravit oba portály…');edit.disabled=true;edit.hidden=!editPair;
  tools.append(element('label','Zdrojový portál'),portal,element('label','Sousední sektor'),target,fit);actions.append(cancel,edit,submit);dialog.append(element('h2',`Propojit portál · ${source.name}`),tools,area,message,actions,element('p','Vyberte sektor na druhé straně existujícího otvoru. Protikus dostane stejné světové body v opačném pořadí. Oba portály musí ležet na společné hranici uzavřených konvexních objemů a směřovat dovnitř. Překrývající se jiné portály se odmítnou. Existující dvojici lze společně upravit nebo odstranit. Kolize a viditelné stěny se nemění.','notice'));
  let view=null,busy=false,closed=false;const request=()=>({mesh:source.id,portal:Number(portal.value),target:Number(target.value)});
  function update(){
    submit.disabled=edit.disabled=true;const camera=view?.captureCamera();view?.dispose();area.replaceChildren();view=new Viewport(area);let plan;
    try{if(target.value==='')throw new Error('Vyberte sousední sektor na druhé straně otvoru.');plan=sectorLinkPlan(context,request());message.textContent=plan.already?'Tento otvor má odpovídající protikus. Oba lze upravit společně s jedním undo.':'Protikus leží na společné hranici. Uložení změní pouze sousední sektor v geometrii mise, s jedním undo.';submit.disabled=plan.already||busy;edit.disabled=!plan.already||busy;}catch(error){message.textContent=error.message;}
    const meshes=context.sectors.filter(s=>s.id===source.id||s.id===Number(target.value)).map(s=>({...s,parent:0,position:[0,0,0],scale:[1,1,1],rotation:[1,0,0,0],sector:{...s.sector,positions:sectorWorldPoints(s.sector.positions,s.worldMatrix),portals:s.sector.portals.map(p=>({...p,positions:sectorWorldPoints(p.positions,s.worldMatrix)}))}}));
    if(plan&&!plan.already){const sector=meshes.find(s=>s.id===plan.target).sector;sector.portals.push({vertices:plan.worldPositions.length/3,positions:plan.worldPositions,flags:4,parameters:[0,0]});}
    view.addModel({version:29,materials:[],meshes,animated:0});view.showSectors(true,String(source.id));if(camera)view.restoreCamera(camera);else view.fit();
  }
  edit.onclick=()=>{if(edit.disabled||!editPair)return;const selection=request();sectorLinkPlan(context,selection);dialog.close();editPair(selection);};
  portal.onchange=target.onchange=update;fit.onclick=()=>view.fit();cancel.onclick=()=>dialog.close();submit.onclick=()=>run(async()=>{if(submit.disabled)return;const plan=sectorLinkPlan(context,request());if(plan.already)return;busy=true;submit.disabled=cancel.disabled=true;tools.inert=true;try{await save(request(),context.sha256,context.sceneHash);status('Protilehlý portál vytvořen se zálohou.');dialog.close();}catch(error){message.textContent=error.message;}finally{busy=false;tools.inert=false;cancel.disabled=false;if(!closed)submit.disabled=false;}});
  dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});dialog.addEventListener('close',()=>{closed=true;view?.dispose();dialog.remove();},{once:true});document.body.append(dialog);dialog.showModal();update();
}
