import { Matrix4, Quaternion, Vector3, Euler, Group } from 'three';
import { actionMenu } from './workspace.js';
import { CollisionViewport } from './collision-view.js';
import { collisionLabels, collisionShapeGeometry } from '../shared/collision-shapes.js';

const editable={triangles:['points','reverse','material','flags'],aabbs:['min','max','link','material','flags'],xtobbs:['extentMin','extentMax','matrix','link','material','flags'],obbs:['extentMin','extentMax','matrix','link','material','flags'],spheres:['center','radius','link','material','flags'],cylinders:['center','radius','link','material','flags']};
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function renderCollisions(main,file,previous,env){
  const {element:e,state,api,run,refresh,renderDetail,status}=env;
  const layout=e('div',undefined,'model-workspace'),center=e('section',undefined,'model-center'),inspector=e('section',undefined,'model-inspector');layout.append(center,inspector);main.append(layout);
  main.append(e('p','Vyberte kolizi ve 3D nebo rozbalte objekt vlevo. Ruční úprava generované kolize odpojí automatický přepočet pouze u jejího modelu; ostatní vazby zůstanou. Modely ani původní hra se nepřepisují. Válce jsou nekonečné v Y, náhled zobrazuje pouze 20 m kolem Y=0. OBB jsou kolizní plochy na místní Y=0.','notice'));
  for(const warning of file.warnings.slice(0,8))main.append(e('p',warning,'notice'));
  const tools=e('div',undefined,'tools'),add=e('button','Přidat kolizi…'),copy=e('button','Duplikovat'),remove=e('button','Odstranit'),fit=e('button','Zarámovat výběr'),all=e('button','Zarámovat zobrazené'),viewport=e('div',undefined,'viewport'),caption=e('p','Vyberte kolizi.','muted');tools.append(actionMenu('Kolize',[add,copy,remove]),fit,all);center.append(tools,caption,viewport);
  const index=e('div',undefined,'text-index collision-index'),search=e('input'),type=e('select'),list=e('div',undefined,'text-list'),form=e('div',undefined,'text-form'),fields=e('div',undefined,'collision-properties'),save=e('button','Uložit změny (0)','primary');
  search.type='search';search.placeholder='Objekt, ID nebo materiál…';search.setAttribute('aria-label','Hledat kolize');type.setAttribute('aria-label','Typ kolize');const option=e('option','Všechny typy');option.value='';type.append(option);for(const [value,label] of Object.entries(collisionLabels)){const option=e('option',`${label} (${file.counts[value]})`);option.value=value;type.append(option);}index.append(search,type,list);form.append(fields,save);inspector.append(index,form);
  const rows=new Map(file.records.map(r=>[r.id,r])),originals=new Map(rows),operations=new Map(),invalid=new Map(),openGroups=new Set(),limits=new Map();let newId=0,filtered=[];
  const view=new CollisionViewport(viewport,id=>{renderInspector();if(id){drawList();list.querySelector('[aria-current="true"]')?.scrollIntoView({block:'nearest'});}else markSelection();},(id,patch)=>{applyPatch(id,patch);renderInspector();});state.viewport=view;view.projectRoot=state.project.root;view.collisionPath=file.path;
  search.value=previous?.search??'';type.value=previous?.type??'';view.collisionSearch=search.value;view.collisionType=type.value;
  const modeButtons=new Map();for(const [mode,label] of [['translate','Posun'],['rotate','Rotace'],['scale','Měřítko']]){const button=e('button',label);button.onclick=()=>view.gizmo.setMode(mode);modeButtons.set(mode,button);tools.append(button);}
  view.gizmo.addEventListener('change',()=>{for(const [mode,button] of modeButtons)button.setAttribute('aria-pressed',String(view.gizmo.mode===mode));});
  if(previous?.mode)view.gizmo.setMode(previous.mode);
  function controls(){save.textContent=`Uložit změny (${operations.size})`;save.disabled=!operations.size||Boolean(file.ownershipWarning)||state.busy;copy.disabled=remove.disabled=fit.disabled=!rows.has(view.selectedId);if(copy.disabled===false)copy.disabled=Boolean(rows.get(view.selectedId).warning);const record=rows.get(view.selectedId);for(const [mode,button] of modeButtons)button.disabled=!record||Boolean(record.warning)||mode==='rotate'&&record.array==='aabbs'||mode!=='translate'&&['spheres','cylinders'].includes(record?.array);}
  function markSelection(){for(const button of list.querySelectorAll('[data-collision]')){const selected=button.dataset.collision===view.selectedId;button.classList.toggle('active',selected);button.setAttribute('aria-current',String(selected));}controls();}
  function register(id){
    const record=rows.get(id),original=originals.get(id);let operation=operations.get(id);
    if(operation?.kind!=='delete'){
      const changes={};for(const field of editable[record.array])if(record[field]!==undefined&&(!original||!equal(record[field],original[field])))changes[field]=record[field];
      operation={kind:original?'edit':'add',array:record.array,...(original?{index:original.index}:{}),changes};
      if(!original||Object.keys(changes).length||invalid.has(id))operations.set(id,operation);else operations.delete(id);
    }
    if(operations.has(id))state.texts.set(`klz:${id}`,{...operations.get(id),invalid:invalid.has(id)});else state.texts.delete(`klz:${id}`);controls();
  }
  function applyPatch(id,patch){
    const current=rows.get(id);if(!current)return;const record={...current,...patch};
    if(Object.keys(patch).some(key=>!['material','flags','link','name','reverse'].includes(key))){
      try{
        if(['spheres','cylinders'].includes(record.array)&&record.radius<=0)throw new Error('Poloměr musí být kladný.');
        record.geometry=collisionShapeGeometry(record.array,record);
        if([...record.geometry.min,...record.geometry.max].some((n,i)=>!Number.isFinite(n)&&!(record.array==='cylinders'&&i%3===1)))throw new Error('Neplatné souřadnice.');
        if(record.geometry.min.some((n,i)=>n>record.geometry.max[i]))throw new Error('Minimum musí být menší než maximum.');
        record.warning=undefined;
      }catch(error){record.geometry=undefined;record.warning=error.message;}
    }
    rows.set(id,record);register(id);view.updateRecord(record);caption.textContent=label(record)+(record.warning?' · náhled nedostupný':'');
  }
  function label(record){return `${record.name} · ${collisionLabels[record.array]} #${record.index??'nová'} · materiál ${record.material}`;}
  function drawList(){
    list.replaceChildren();const groups=new Map();for(const item of filtered){const record=rows.get(item.id);if(!record)continue;const group=groups.get(record.name)??[];group.push(record);groups.set(record.name,group);}
    for(const [name,records] of [...groups].sort(([a],[b])=>a.localeCompare(b))){
      const group=e('details',undefined,'property-group'),summary=e('summary',`${name} (${records.length})`),children=e('div');group.append(summary,children);group.open=openGroups.has(name)||records.some(r=>r.id===view.selectedId);list.append(group);
      const fill=()=>{children.replaceChildren();const limit=limits.get(name)??100,visible=records.slice(0,limit),selected=records.find(record=>record.id===view.selectedId);if(selected&&!visible.includes(selected))visible.unshift(selected);for(const record of visible){const button=e('button',`${collisionLabels[record.array]} #${record.index??'nová'} · ${record.material}${operations.has(record.id)?' ●':''}`);button.dataset.collision=record.id;button.onclick=()=>view.select(record.id);children.append(button);}if(records.length>limit){const more=e('button','Dalších 100 kolizí…');more.onclick=()=>{limits.set(name,limit+100);fill();};children.append(more);}markSelection();};
      group.ontoggle=()=>{if(group.open){openGroups.add(name);fill();}else{openGroups.delete(name);children.replaceChildren();}};if(group.open)fill();
    }
    markSelection();
  }
  function filter(){
    const query=search.value.trim().toLocaleLowerCase('cs');filtered=[...rows.values()].filter(record=>(!type.value||record.array===type.value)&&(!query||`${record.name} ${record.id} ${record.material}`.toLocaleLowerCase('cs').includes(query)));
    view.collisionSearch=search.value;view.collisionType=type.value;view.loadRecords(filtered);if(!filtered.some(r=>r.id===view.selectedId))view.select(null,false);else view.select(view.selectedId,false);drawList();
  }
  search.oninput=type.onchange=filter;
  function numberGroup(label,values,onInput,options={}){
    const group=e('fieldset'),legend=e('legend',label),inputs=e('div',undefined,'numeric-fields'),nodes=[];group.append(legend,inputs);
    for(const [i,value] of values.entries()){const name=options.labels?.[i]??(['X','Y','Z'][i]??String(i+1)),labelNode=e('label',name),input=e('input');input.type='number';input.step=options.integer?'1':'any';input.value=String(value);input.required=true;input.setAttribute('aria-label',`${label} ${name}`);if(options.min!==undefined)input.min=String(options.min);if(options.max!==undefined)input.max=String(options.max);labelNode.append(input);inputs.append(labelNode);nodes.push(input);}
    const record=rows.get(view.selectedId),pending=invalid.get(record.id)?.[label];if(pending)nodes.forEach((input,i)=>{input.value=pending[i];input.setAttribute('aria-invalid','true');});
    for(const input of nodes)input.oninput=()=>{
      const id=record.id,values=nodes.map(input=>Number(input.value)),bad=nodes.some((input,i)=>!input.value.trim()||!Number.isFinite(Math.fround(values[i]))||options.integer&&!Number.isInteger(values[i])||options.min!==undefined&&values[i]<options.min||options.max!==undefined&&values[i]>options.max||options.positive&&values[i]<=0);
      const pending={...(invalid.get(id)??{})};if(bad)pending[label]=nodes.map(input=>input.value);else delete pending[label];if(Object.keys(pending).length)invalid.set(id,pending);else invalid.delete(id);nodes.forEach(input=>input.setAttribute('aria-invalid',String(bad)));
      if(!bad)onInput(values);else register(id);
    };
    fields.append(group);return nodes;
  }
  function renderInspector(){
    fields.replaceChildren();const record=rows.get(view.selectedId);if(!record){caption.textContent='Vyberte kolizi.';fields.append(e('p','Vyberte kolizi ve 3D nebo v seznamu.'));controls();return;}
    fields.append(e('h3',record.name),e('p',`${collisionLabels[record.array]} · ${record.id}`));caption.textContent=label(record);
    if(record.owner)fields.append(e('p',`Ruční uložení této kolize odpojí automatický přepočet pro ${record.owner}. Model ani ostatní kolize se nezmění.`,'notice'));
    if(record.warning)fields.append(e('p',record.warning,'notice'));
    const id=record.id,field=(label,key,values,options)=>numberGroup(label,values,value=>applyPatch(id,{[key]:values.length===1?value[0]:value}),options);
    field('Materiál','material',[record.material],{integer:true,min:0,max:255,labels:['ID']});
    const raw=e('details'),summary=e('summary','Původní příznaky');raw.append(summary);fields.append(raw);field('Příznaky (raw byte)','flags',[record.flags],{integer:true,min:0,max:255,labels:['0–255']});raw.append(fields.lastElementChild);
    if(record.array!=='triangles'){
      const labelNode=e('label','Vazba na frame'),select=e('select');select.setAttribute('aria-label','Frame kolize');for(const link of file.links){const option=e('option',link.name+(link.resolved?'':' · nedostupný'));option.value=String(link.index);option.disabled=!link.resolved&&link.index!==record.link;select.append(option);}select.value=String(record.link);select.onchange=()=>applyPatch(id,{link:Number(select.value),name:file.links[Number(select.value)].name});labelNode.append(select);fields.append(labelNode);
    }
    if(record.array==='triangles'){
      if(record.points)record.points.forEach((point,i)=>numberGroup(`Vrchol ${i+1}`,point,values=>{const points=rows.get(id).points.map(p=>[...p]);points[i]=values;applyPatch(id,{points});}));
      const reverse=e('button','Obrátit stranu povrchu');reverse.disabled=!record.points;reverse.onclick=()=>{const reverse=!rows.get(id).reverse;applyPatch(id,{reverse:reverse||!originals.has(id)?reverse:undefined});status('Strana kolize bude obrácena při uložení.');};fields.append(reverse);
    }else if(record.array==='aabbs'){field('Minimum','min',record.min);field('Maximum','max',record.max);}
    else if(['spheres','cylinders'].includes(record.array)){field('Střed','center',record.center,record.array==='cylinders'?{labels:['X','Z']}:{});field('Poloměr','radius',[record.radius],{positive:true,min:0,labels:['Metry']});}
    else{
      field('Místní minimum','extentMin',record.extentMin);field('Místní maximum','extentMax',record.extentMax);
      numberGroup('Pozice',record.matrix.slice(12,15),values=>{const matrix=[...rows.get(id).matrix];matrix.splice(12,3,...values);applyPatch(id,{matrix});});
      const matrix=new Matrix4().fromArray(record.matrix),position=new Vector3(),rotation=new Quaternion(),scale=new Vector3();matrix.decompose(position,rotation,scale);
      if(Number.isFinite(rotation.w)&&Math.abs(matrix.determinant())>=1e-12){
        const angles=new Euler().setFromQuaternion(rotation,'XYZ'),degrees=[angles.x,angles.y,angles.z].map(n=>n*180/Math.PI);
        numberGroup('Rotace (stupně)',degrees,values=>{const current=new Matrix4().fromArray(rows.get(id).matrix);current.decompose(position,rotation,scale);rotation.setFromEuler(new Euler(...values.map(n=>n*Math.PI/180),'XYZ'));applyPatch(id,{matrix:new Matrix4().compose(position,rotation,scale).toArray()});});
        numberGroup('Měřítko',scale.toArray(),values=>{new Matrix4().fromArray(rows.get(id).matrix).decompose(position,rotation,scale);applyPatch(id,{matrix:new Matrix4().compose(position,rotation,new Vector3(...values)).toArray()});});
      }
      const reset=e('button','Obnovit orientaci a měřítko');reset.onclick=()=>{const current=rows.get(id).matrix;applyPatch(id,{matrix:new Matrix4().makeTranslation(...current.slice(12,15)).toArray()});renderInspector();};fields.append(reset);
    }
    controls();
  }
  function insert(array,changes,name='Nová kolize'){
    const id=`new/${newId++}`,record={id,array,name,...changes};record.geometry=collisionShapeGeometry(array,record);rows.set(id,record);register(id);if(type.value&&type.value!==array)type.value='';const query=search.value.trim().toLocaleLowerCase('cs');if(query&&!`${record.name} ${record.id} ${record.material}`.toLocaleLowerCase('cs').includes(query))search.value='';filter();view.select(id);drawList();
  }
  add.onclick=()=>{
    const dialog=e('dialog'),kind=e('select'),link=e('select'),message=e('p','Nová kolize se vytvoří u cíle kamery. Přesný tvar a polohu nastavíte v inspektoru před uložením.'),cancel=e('button','Zrušit'),submit=e('button','Přidat','primary'),actions=e('div',undefined,'tools');kind.setAttribute('aria-label','Nový kolizní tvar');link.setAttribute('aria-label','Frame nové kolize');
    for(const [array,label] of Object.entries(collisionLabels)){const option=e('option',label);option.value=array;option.disabled=array!=='triangles'&&!file.links.some(l=>l.resolved);kind.append(option);}kind.value=file.links.some(l=>l.resolved)?'aabbs':'triangles';for(const item of file.links.filter(l=>l.resolved)){const option=e('option',item.name);option.value=String(item.index);link.append(option);}
    const update=()=>link.hidden=kind.value==='triangles';kind.onchange=update;update();cancel.onclick=()=>dialog.close();submit.onclick=()=>{const array=kind.value,target=view.controls.target.toArray();target[2]*=-1;const [x,y,z]=target,changes={material:0,flags:0};if(array==='triangles')changes.points=[[x-.5,y,z-.5],[x+.5,y,z-.5],[x-.5,y,z+.5]];else{changes.link=Number(link.value);if(array==='aabbs'){changes.min=[x-.5,y,z-.5];changes.max=[x+.5,y+1,z+.5];}else if(array==='spheres'){changes.center=target;changes.radius=.5;}else if(array==='cylinders'){changes.center=[x,z];changes.radius=.5;}else{changes.extentMin=[-.5,array==='obbs'?0:-.5,-.5];changes.extentMax=[.5,array==='obbs'?0:.5,.5];changes.matrix=new Matrix4().makeTranslation(x,y,z).toArray();}}insert(array,changes,array==='triangles'?'Světový povrch':file.links[changes.link].name);dialog.close();};
    actions.append(cancel,submit);dialog.append(e('h2','Přidat kolizi'),kind,link,message,actions);dialog.addEventListener('close',()=>dialog.remove(),{once:true});document.body.append(dialog);dialog.showModal();
  };
  copy.onclick=()=>{const record=rows.get(view.selectedId),changes={};for(const key of editable[record.array])if(record[key]!==undefined)changes[key]=structuredClone(record[key]);if(record.array==='triangles')changes.reverse=Boolean(record.sort&1)!==Boolean(record.reverse);insert(record.array,changes,record.name);};
  remove.onclick=()=>{const id=view.selectedId,record=rows.get(id);if(!record)return;if(originals.has(id)){operations.set(id,{kind:'delete',array:record.array,index:record.index});state.texts.set(`klz:${id}`,operations.get(id));}else{operations.delete(id);state.texts.delete(`klz:${id}`);}invalid.delete(id);rows.delete(id);view.select(null,false);filter();controls();};
  const geometry=e('button','Geometrie mise');geometry.setAttribute('aria-pressed','false');tools.append(geometry);
  let geometryLoad;view.collisionGeometryWanted=previous?.geometry??false;
  async function showGeometry(value){
    view.collisionGeometryWanted=value;
    if(value&&!view.contextGeometry){
      geometryLoad??=(async()=>{
        const path=file.path.slice(0,file.path.lastIndexOf('/'))+'/scene.4ds',model=await api.inspect(path);if(view.disposed)return;
        if(model.type!=='model')throw new Error('Geometrii této mise nelze zobrazit.');
        const group=new Group();group.visible=false;view.addModel(model,group,'collision-context/');view.root.add(group);view.contextGeometry=group;
        await view.loadTextures(async texture=>{const name=texture.replaceAll('\\','/').toLowerCase(),asset=state.project.assets.find(a=>a.path.toLowerCase()===`maps/${name}`||a.path.toLowerCase()===name);return asset?api.media(asset.path):null;});
      })().catch(error=>{geometryLoad=null;throw error;});await geometryLoad;
    }
    if(view.disposed)return;if(view.contextGeometry)view.contextGeometry.visible=view.collisionGeometryWanted;
    geometry.setAttribute('aria-pressed',String(view.collisionGeometryWanted));
  }
  geometry.onclick=()=>run(()=>showGeometry(!view.collisionGeometryWanted));
  if(previous?.geometry)showGeometry(true).catch(error=>{if(!view.disposed)status(error.message,true);});
  main.append(e('p','Geometrie mise zobrazuje samotnou scene.4ds jako podklad. Další modely a aktéři ze scene2.bin se do podkladu nenačítají.','notice'));
  fit.onclick=()=>view.fit(view.proxy);all.onclick=()=>view.fit(view.batch);
  save.onclick=()=>run(async()=>{
    if(invalid.size)throw new Error('Opravte neplatné číselné hodnoty před uložením.');const ops=[...operations.values()],selected=view.selectedId,selectedOp=operations.get(selected),result=await api.saveCollision(file.path,ops,file.sha256,file.dependencyHashes,{detachGenerated:true});
    let selectedId=selected;
    if(selectedOp?.kind==='add'){const ordinal=ops.filter(op=>op.kind==='add'&&op.array===selectedOp.array).indexOf(selectedOp),added=result.added.filter(item=>item.array===selectedOp.array)[ordinal];selectedId=added?`${added.array}/${added.index}`:null;}
    else if(selected&&originals.has(selected)){const original=originals.get(selected),index=result.mappings[original.array][original.index];selectedId=index===null?null:`${original.array}/${index}`;}
    state.selectCollisionId=selectedId;state.file=result.file;state.texts.clear();await refresh();renderDetail();status(`Kolize uložené do modu se zálohou.${result.detached.length?' Automatický přepočet odpojen: '+result.detached.join(', ')+'.':''}`);
  });
  filter();if(previous?.camera)view.restoreCamera(previous.camera);else view.fit(view.batch);
  const selected=state.selectCollisionId??previous?.selectedId;state.selectCollisionId=undefined;if(selected&&rows.has(selected)){view.entries.set(selected,rows.get(selected));view.select(selected,false);drawList();}else renderInspector();controls();
}
