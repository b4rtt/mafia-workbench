// Shared spatial layout. Moving existing controls preserves their callbacks and drafts.
const make = (tag, text, className) => { const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node; };
const read = key => { try{return JSON.parse(localStorage.getItem(`workbench.layout.${key}`));}catch{return null;} };
const write = (key,value) => { try{localStorage.setItem(`workbench.layout.${key}`,JSON.stringify(value));}catch{/* Layout preferences are optional. */} };
let resizeObservers=[];
function clearResizers(){for(const observer of resizeObservers)observer.disconnect();resizeObservers=[];}
export function actionMenu(label, buttons) {
  const menu=make('details',undefined,'action-menu'),summary=make('summary',label),list=make('div',undefined,'action-menu-items');
  menu.append(summary,list);list.append(...buttons);
  list.addEventListener('click',event=>{if(event.target.closest('button')&&!event.target.closest('button').disabled)menu.open=false;});
  menu.addEventListener('focusout',event=>{if(!menu.contains(event.relatedTarget))menu.open=false;});
  menu.addEventListener('keydown',event=>{if(event.key==='Escape'){menu.open=false;summary.focus();event.stopPropagation();}});
  menu.addEventListener('toggle',()=>{if(menu.open)for(const other of document.querySelectorAll('.action-menu[open]'))if(other!==menu)other.open=false;});
  return menu;
}
export function initializeWorkspace() {
  const browser=document.querySelector('.workspace>aside'),button=document.getElementById('toggle-files');
  browser.id='asset-browser';button.setAttribute('aria-controls',browser.id);
  const remembered=read('files');
  function show(value,remember=false){document.body.classList.toggle('files-hidden',!value);browser.inert=!value;button.setAttribute('aria-pressed',String(value));button.setAttribute('aria-expanded',String(value));if(remember)write('files',value);}
  show(remembered??true);button.onclick=()=>show(document.body.classList.contains('files-hidden'),true);
  document.getElementById('close-files').onclick=()=>{show(false,true);button.focus({preventScroll:true});};
  document.addEventListener('keydown',event=>{
    if(event.key!=='Escape'||event.defaultPrevented||document.querySelector('dialog[open]')||document.body.classList.contains('files-hidden')||document.body.classList.contains('view-focused'))return;
    show(false,true);button.focus({preventScroll:true});event.preventDefault();event.stopPropagation();
  },true);
  document.addEventListener('pointerdown',event=>{
    if(!document.body.classList.contains('spatial-open')||document.body.classList.contains('files-hidden')||event.target.closest('dialog')||browser.contains(event.target)||button.contains(event.target)||event.target.closest('.category-strip'))return;
    // Dismiss the overlay without consuming the click on the editor underneath.
    show(false,true);
  });
  return {browse:()=>show(true),spatial:enabled=>{if(!enabled){clearResizers();document.getElementById('detail').onkeydown=null;}document.body.classList.remove('view-focused');document.body.classList.toggle('spatial-open',enabled);if(read('files')===null)show(!enabled);}};
}
function resizePanel(layout,panel,side,key) {
  const handle=make('div',undefined,`panel-resizer ${key}-resizer`);handle.tabIndex=0;handle.setAttribute('role','separator');handle.setAttribute('aria-orientation','vertical');handle.setAttribute('aria-label',`Šířka panelu ${side==='left'?'objektů':'vlastností'}`);
  const min=side==='left'?180:250,max=side==='left'?360:500,fallback=side==='left'?230:300,property=`--${key}-width`;
  let preferred=read(key)??fallback;
  function set(value,remember=true){const other=layout.querySelector(side==='left'?'.model-inspector':'.scene-outline'),limit=Math.min(max,Math.max(min,layout.clientWidth-(other?.clientWidth??0)-12-320));value=Math.round(Math.min(limit,Math.max(min,Number.isFinite(value)?value:fallback)));layout.style.setProperty(property,`${value}px`);handle.setAttribute('aria-valuenow',String(value));handle.setAttribute('aria-valuemax',String(Math.floor(limit)));if(remember){preferred=value;write(key,value);}}
  handle.setAttribute('aria-valuemin',String(min));set(preferred,false);
  const observer=new ResizeObserver(()=>set(preferred,false));observer.observe(layout);resizeObservers.push(observer);
  handle.onpointerdown=event=>{if(event.button!==0)return;handle.focus();const start=event.clientX,width=panel.getBoundingClientRect().width;handle.setPointerCapture(event.pointerId);handle.onpointermove=move=>set(width+(move.clientX-start)*(side==='left'?1:-1));handle.onpointerup=handle.onpointercancel=()=>{handle.onpointermove=null;};event.preventDefault();};
  handle.onkeydown=event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();set(event.key==='Home'?min:event.key==='End'?max:Number(handle.getAttribute('aria-valuenow'))+(event.key==='ArrowRight'?1:-1)*(side==='left'?1:-1)*20);};
  return handle;
}
export function spatialWorkspace(main,file,view) {
  clearResizers();
  const layout=main.querySelector(':scope>.model-workspace');main.classList.toggle('spatial-detail',Boolean(layout));if(!layout)return false;
  const center=layout.querySelector('.model-center'),inspector=layout.querySelector('.model-inspector'),viewport=center.querySelector(':scope>.viewport');if(!viewport)return false;
  const header=main.querySelector('.file-header'),fileTools=main.querySelector(':scope>.tools'),meta=main.querySelector(':scope>.file-meta');
  header.title=file.path;meta.hidden=true;
  const documentActions=[...fileTools.children].filter(node=>!node.classList.contains('primary'));
  fileTools.prepend(actionMenu('Soubor',documentActions));header.append(fileTools);fileTools.classList.add('file-actions');
  const notes=make('div',undefined,'workspace-help');
  for(const node of [...main.children])if(node.matches('p'))notes.append(node);
  notes.prepend(make('h3','Ovládání 3D'),make('p','Tažením levým tlačítkem otáčíte, pravým posouváte. Kolečko přibližuje k povrchu pod kurzorem; Shift zpomaluje přiblížení. F zarámuje výběr nebo scénu. W / E / R přepínají posun, rotaci a měřítko, pokud je vybraný objekt upravitelný. Zkratky fungují při zaměření 3D pohledu.'));
  const pane=make('div',undefined,'inspector-content');pane.append(...inspector.childNodes);
  if(!inspector.classList.contains('animation-editor'))for(const note of pane.querySelectorAll(':scope>p.notice'))notes.append(note);
  const tabs=make('div',undefined,'inspector-tabs'),properties=make('button','Vlastnosti'),help=make('button','Nápověda');tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','Inspektor');
  pane.id='inspector-properties';notes.id='inspector-help';pane.setAttribute('role','tabpanel');notes.setAttribute('role','tabpanel');
  for(const [button,id] of [[properties,pane.id],[help,notes.id]]){button.setAttribute('role','tab');button.setAttribute('aria-controls',id);button.onkeydown=event=>{if(['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();const next=button===properties?help:properties;next.click();next.focus();}};}
  function tab(showHelp){pane.hidden=showHelp;notes.hidden=!showHelp;properties.setAttribute('aria-selected',String(!showHelp));help.setAttribute('aria-selected',String(showHelp));properties.tabIndex=showHelp?-1:0;help.tabIndex=showHelp?0:-1;}
  properties.onclick=()=>tab(false);help.onclick=()=>tab(true);tab(false);tabs.append(properties,help);inspector.replaceChildren(tabs,pane,notes);
  const index=pane.querySelector('.text-index');
  if(index){
    const outline=make('section',undefined,'scene-outline');outline.setAttribute('aria-label','Objekty a vlastnosti scény');outline.append(make('h3','Objekty'),index);layout.prepend(outline,resizePanel(layout,outline,'left','outline'));
    // The object picker remains available even for uneditable geometry.
    const picker=center.querySelector(':scope>select');if(picker){const label=make('label','Vybrat ve 3D');label.append(picker);outline.insertBefore(label,index);}
    layout.classList.add('has-outline');
    // Timeline editors rebuild their property index when switching a key/channel.
    // Keep the outline attached to the current form rather than the old key's callbacks.
    const observer=new MutationObserver(()=>{const replacement=pane.querySelector('.text-index');if(replacement){outline.querySelector('.text-index')?.remove();outline.append(replacement);}});
    observer.observe(pane,{childList:true,subtree:true});resizeObservers.push(observer);
    outline.addEventListener('click',()=>tab(false));
  }
  layout.insertBefore(resizePanel(layout,inspector,'right','inspector'),inspector);
  for(const paragraph of [...center.querySelectorAll(':scope>p')]){
    if(paragraph.getAttribute('aria-label')==='Dialog cutscény')paragraph.classList.add('view-subtitle');
    else if(paragraph===viewport.previousElementSibling&&!paragraph.classList.contains('notice'))paragraph.classList.add('selection-caption');
    else if(paragraph.classList.contains('notice'))notes.append(paragraph);
    else paragraph.classList.add('view-status');
  }
  const controls=make('div',undefined,'view-controls'),primaryTools=center.querySelector(':scope>.tools');
  if(primaryTools)controls.append(primaryTools);
  const panels=make('div',undefined,'view-panel-tools'),hideInspector=make('button','Inspektor'),focus=make('button','Jen 3D');
  if(index){const toggle=make('button','Objekty'),show=value=>{layout.classList.toggle('outline-hidden',!value);toggle.setAttribute('aria-pressed',String(value));};show(!read('outline-hidden'));toggle.onclick=()=>{const visible=layout.classList.contains('outline-hidden');show(visible);write('outline-hidden',!visible);};panels.append(toggle);}
  const showInspector=value=>{layout.classList.toggle('inspector-hidden',!value);hideInspector.setAttribute('aria-pressed',String(value));};showInspector(!read('inspector-hidden'));hideInspector.onclick=()=>{const visible=layout.classList.contains('inspector-hidden');showInspector(visible);write('inspector-hidden',!visible);};
  focus.setAttribute('aria-pressed','false');focus.title='Zvětšit 3D pohled · Escape vrátí panely';
  const focusMode=value=>{document.body.classList.toggle('view-focused',value);main.classList.toggle('view-focus',value);focus.textContent=value?'Vrátit panely':'Jen 3D';focus.setAttribute('aria-pressed',String(value));};focus.onclick=()=>focusMode(!main.classList.contains('view-focus'));
  panels.append(hideInspector,focus);controls.append(panels);center.prepend(controls);
  // Playback stays under the view; long explanatory text lives in the Help tab.
  const playback=make('div',undefined,'view-playback');
  for(const node of [...center.children])if(node!==controls&&node!==viewport&&node.matches('canvas,input[type=range],output,.tools'))playback.append(node);
  if(playback.childNodes.length)center.append(playback);
  viewport.tabIndex=0;viewport.setAttribute('role','region');viewport.setAttribute('aria-label','3D pracovní pohled');
  viewport.addEventListener('pointerdown',()=>{tab(false);viewport.focus({preventScroll:true});});
  const modes=new Map([...controls.querySelectorAll('button')].filter(button=>['Posun','Rotace','Měřítko'].includes(button.textContent)).map(button=>[button,{Posun:'translate',Rotace:'rotate','Měřítko':'scale'}[button.textContent]]));
  const markMode=()=>{const current=typeof view==='function'?view():view;for(const [button,mode] of modes)button.setAttribute('aria-pressed',String(mode===current?.gizmo.mode));};markMode();controls.addEventListener('click',markMode);
  viewport.onkeydown=event=>{
    if(event.ctrlKey||event.metaKey||event.altKey)return;
    if(event.key==='Escape'){focusMode(false);return;}
    const current=typeof view==='function'?view():view;if(!current||current.disposed)return;
    if(event.key.toLowerCase()==='f'){event.preventDefault();const shot=file.type==='replay'?[...main.querySelectorAll('button')].find(button=>button.textContent==='Zarámovat záběr'):null;if(shot)shot.click();else current.fit(current.gizmo.object??current.paths??current.root);}
    const mode={w:'translate',e:'rotate',r:'scale'}[event.key.toLowerCase()];if(mode&&current.gizmo.object){event.preventDefault();current.gizmo.setMode(mode);markMode();}
  };
  main.onkeydown=event=>{if(event.key==='Escape'&&!event.target.closest('dialog'))focusMode(false);if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'){event.preventDefault();const save=pane.querySelector(inspector.classList.contains('animation-editor')?'button.primary':'.text-form button.primary');if(save&&!save.disabled)save.click();}};
  return true;
}
