import * as THREE from 'three';
import {Viewport} from './viewport.js';
import {createSectorPreview} from './sector-preview.js';
import {sectorVolume,portalPolygon,sectorCoordinates,sameSectorValues} from '../shared/sector-geometry.js';

export function sectorGeometryDialog(file,context,{run,status,save}){
  const make=(tag,text)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;};
  const original=context.mesh.sector,draft={positions:[...original.positions],indices:[...original.indices],portals:original.portals.map((p,source)=>({source,positions:[...p.positions]}))};
  sectorCoordinates(draft.positions,4,65536);
  const dialog=make('dialog'),tools=make('div'),area=make('div'),fields=make('div'),message=make('p'),actions=make('div'),cancel=make('button','Zrušit'),submit=make('button','Uložit sektor a portály');
  dialog.className='geometry-dialog';tools.className=actions.className='tools';area.className='viewport';fields.className='geometry-fields';message.className='notice';submit.className='primary';
  const part=make('select'),vertex=make('input'),jump=make('button','Vybrat vrchol'),fit=make('button','Zarámovat geometrii'),focus=make('button','Přiblížit vrchol'),add=make('button','Nový portál z plochy'),clone=make('button','Duplikovat portál'),remove=make('button','Odstranit portál'),insert=make('button','Vložit bod na hranu'),erase=make('button','Odstranit bod'),reverse=make('button','Obrátit pořadí');
  part.setAttribute('aria-label','Geometrie sektoru nebo portálu');vertex.type='number';vertex.min='0';vertex.step='1';vertex.value='0';vertex.setAttribute('aria-label','Vrchol sektoru nebo portálu');tools.append(part,vertex,jump,focus,fit);
  const portalTools=make('div');portalTools.className='tools';portalTools.append(add,clone,remove,insert,erase,reverse);actions.append(cancel,submit);
  const help=make('p','Souřadnice jsou uložené XYZ v 4DS. Sektor musí zůstat uzavřený a konvexní s plochami dovnitř; změna vrcholu objemu sama neposouvá portály. Portál má 3–8 vrcholů v jedné rovině, seřazených po obvodu. Hranice objemu a rovina změněného portálu se při uložení přepočítají. Nový portál začíná uvnitř prvního trojúhelníku sektoru; vyžaduje odpovídající otvor/portál sousedního sektoru. Kolize a viditelné stěny se tímto dialogem nemění.');help.className='notice';
  dialog.append(make('h2',`Sektor a portály · ${context.mesh.name}`),tools,area,fields,portalTools,message,actions,help);document.body.append(dialog);dialog.showModal();
  let selected=-1,index=0,outline,markers,proxy,inputs=[],dirty=false;
  const view=new Viewport(area,()=>{},(_frame,values)=>{const positions=current();positions.splice(index*3,3,...values.position);dirty=true;populate();update();});
  function current(){return selected<0?draft.positions:draft.portals[selected].positions;}
  function blocked(){if(inputs.some(input=>input.getAttribute('aria-invalid')==='true')){message.textContent='Nejdřív opravte neplatné souřadnice.';return true;}return false;}
  function preview(){return {...original,positions:draft.positions,indices:draft.indices,portals:draft.portals.map(p=>({...(p.source===undefined?{flags:4,parameters:[0,0]}:original.portals[p.source]),positions:p.positions}))};}
  function validate(){try{if(!sameSectorValues(draft.positions,original.positions)||!sameSectorValues(draft.indices,original.indices))sectorVolume(draft.positions,draft.indices);for(const p of draft.portals)if(p.source===undefined||!sameSectorValues(p.positions,original.portals[p.source].positions))portalPolygon(p.positions);message.textContent=dirty?'Geometrie je rozepsaná; uložení vytvoří jednu vratnou změnu.':'';submit.disabled=!dirty;return true;}catch(error){message.textContent=error.message;submit.disabled=true;return false;}}
  function select(next){if(!Number.isInteger(next)||next<0||next>=current().length/3){message.textContent='Index vrcholu je mimo rozsah.';return;}if(blocked())return;index=next;populate();proxy.position.fromArray(current().slice(index*3,index*3+3));}
  function populate(){
    fields.replaceChildren();inputs=[];vertex.value=String(index);const values=current().slice(index*3,index*3+3);
    for(let i=0;i<3;i++){const row=make('label',['X','Y','Z'][i]),input=make('input');input.type='number';input.step='any';input.value=Object.is(values[i],-0)?'-0':String(values[i]);input.setAttribute('aria-label',`Souřadnice vrcholu ${['X','Y','Z'][i]}`);input.oninput=()=>{const valid=input.value.trim()!==''&&Number.isFinite(Number(input.value))&&Number.isFinite(Math.fround(Number(input.value)));input.setAttribute('aria-invalid',String(!valid));if(!valid){submit.disabled=true;message.textContent='Vyplňte konečné souřadnice XYZ.';return;}current()[index*3+i]=Number(input.value);dirty=true;update();};row.append(input);fields.append(row);inputs.push(input);}
  }
  function release(){view.gizmo.detach();view.root.traverse(node=>{node.geometry?.dispose();if(node.material){node.material.dispose();view.materials.delete(node.material);}});view.root.clear();}
  function update(){
    if(outline){outline.traverse(node=>{node.geometry?.dispose();if(node.material){node.material.dispose();view.materials.delete(node.material);}});outline.removeFromParent();}
    outline=createSectorPreview(preview());outline.traverse(node=>{if(node.material)view.materials.add(node.material);});view.root.add(outline);
    if(markers){markers.geometry.setAttribute('position',new THREE.Float32BufferAttribute(current(),3));markers.geometry.computeBoundingSphere();proxy.position.fromArray(current().slice(index*3,index*3+3));}
    validate();if(inputs.some(input=>input.getAttribute('aria-invalid')==='true'))submit.disabled=true;
  }
  function render(){
    const camera=outline?view.captureCamera():null;release();outline=null;part.replaceChildren();const volume=make('option',`Objem · ${draft.positions.length/3} vrcholů`);volume.value='-1';part.append(volume);for(let i=0;i<draft.portals.length;i++){const option=make('option',`Portál ${i+1} · ${draft.portals[i].positions.length/3} vrcholů`);option.value=String(i);part.append(option);}part.value=String(selected);
    const data=current();index=Math.max(0,Math.min(index,data.length/3-1));const size=Math.max(.1,new THREE.Box3().setFromArray(data).getSize(new THREE.Vector3()).length()),pointsMaterial=new THREE.PointsMaterial({color:0xffb34d,size:Math.max(.005,size*.01),depthTest:false});markers=new THREE.Points(new THREE.BufferGeometry(),pointsMaterial);markers.userData.vertexEditor=true;markers.renderOrder=2;view.root.add(markers);view.materials.add(pointsMaterial);
    const material=new THREE.MeshBasicMaterial({color:0x29caff,depthTest:false});proxy=new THREE.Mesh(new THREE.SphereGeometry(Math.max(.005,size*.005),8,6),material);proxy.userData.frame={id:'sector-vertex',name:'Vrchol'};proxy.renderOrder=3;view.root.add(proxy);view.materials.add(material);view.onVertexSelect=select;view.raycaster.params.Points.threshold=Math.max(.01,size*.02);view.gizmo.attach(proxy);view.gizmo.setMode('translate');
    clone.disabled=remove.disabled=reverse.disabled=selected<0;insert.disabled=selected<0||data.length/3>=8;erase.disabled=selected<0||data.length/3<=3;add.disabled=draft.portals.length>=255||draft.indices.length<3;update();populate();if(camera)view.restoreCamera(camera);else view.fit(outline);
  }
  function mutate(fn){if(blocked())return;try{fn();dirty=true;render();}catch(error){message.textContent=error.message;}}
  part.onchange=()=>{if(blocked()){part.value=String(selected);return;}const next=Number(part.value);try{if(next>=0)sectorCoordinates(draft.portals[next].positions,3,8);}catch(error){message.textContent=error.message;part.value=String(selected);return;}selected=next;index=0;render();};jump.onclick=()=>select(vertex.value.trim()===''?NaN:Number(vertex.value));vertex.onkeydown=event=>{if(event.key==='Enter')jump.click();};fit.onclick=()=>view.fit(outline);focus.onclick=()=>view.fit(proxy);
  add.onclick=()=>mutate(()=>{const ids=draft.indices.slice(0,3),points=ids.map(i=>draft.positions.slice(i*3,i*3+3)),center=[0,1,2].map(i=>points.reduce((n,p)=>n+p[i],0)/3),positions=points.flatMap(p=>p.map((v,i)=>center[i]+(v-center[i])*.6));portalPolygon(positions);draft.portals.push({positions});selected=draft.portals.length-1;index=0;});
  clone.onclick=()=>mutate(()=>{if(draft.portals.length>=255)throw new Error('Nejvýše 255 portálů.');draft.portals.splice(selected+1,0,structuredClone(draft.portals[selected]));selected++;index=0;});
  remove.onclick=()=>mutate(()=>{draft.portals.splice(selected,1);selected=Math.min(selected,draft.portals.length-1);index=0;});
  insert.onclick=()=>mutate(()=>{const p=current(),a=p.slice(index*3,index*3+3),b=p.slice(((index+1)%(p.length/3))*3,((index+1)%(p.length/3))*3+3);p.splice((index+1)*3,0,...a.map((v,i)=>(v+b[i])/2));index++;});
  erase.onclick=()=>mutate(()=>{current().splice(index*3,3);index=Math.max(0,index-1);});
  reverse.onclick=()=>mutate(()=>{const p=current(),reversed=Array.from({length:p.length/3},(_,i)=>p.slice(i*3,i*3+3)).reverse().flat();p.splice(0,p.length,...reversed);index=0;});
  cancel.onclick=()=>dialog.close();submit.onclick=()=>run(async()=>{if(blocked()||!validate())return;await save({mesh:context.mesh.id,sector:draft},context.sha256);status('Geometrie sektoru a portálů uložená se zálohou.');dialog.close();});
  dialog.addEventListener('close',()=>{view.dispose();dialog.remove();},{once:true});render();
}
