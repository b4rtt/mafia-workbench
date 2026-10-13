import { BitmapDraft } from '../shared/bitmap-draft.js';

export function renderBitmap(main,file,{edits,run,status,busy,save}) {
  const make=(tag,text)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;};
  const bitmap=file.bitmap,draft=new BitmapDraft(bitmap,edits),tools=make('div'),area=make('div'),canvas=make('canvas'),info=make('p'),palette=make('div');
  tools.className='tools bitmap-tools';area.className='bitmap-area';palette.className='bitmap-palette';info.className='notice';
  canvas.width=bitmap.width;canvas.height=bitmap.height;canvas.setAttribute('aria-label','BMP textura: tužka kreslí, kapátko nebo Alt vybírá barvu');
  const tool=make('select'),zoom=make('select'),mode=make('select'),color=make('input'),alpha=make('input'),index=make('input'),changePalette=make('button','Změnit barvu palety'),undo=make('button','Zpět tah'),redo=make('button','Znovu tah'),submit=make('button','Uložit texturu');submit.className='primary';
  const options=(select,items,label)=>{select.setAttribute('aria-label',label);for(const [value,text]of items){const option=make('option',text);option.value=value;select.append(option);}};
  options(tool,[['pencil','Tužka'],['picker','Kapátko']],'Nástroj textury');
  options(zoom,[['fit','Celá textura'],...[25,50,100,200,400,800,1600].map(value=>[String(value),`${value} %`])],'Přiblížení textury');
  options(mode,[['opaque','Barvy bez průhlednosti'],...(bitmap.bits===8?[['key','Náhled barevného klíče']]:bitmap.bits===32?[['alpha','Náhled uložené alphy']]:[])],'Náhled průhlednosti');
  color.type='color';color.setAttribute('aria-label','Barva štětce');color.value='#ffffff';
  alpha.type='number';alpha.min='0';alpha.max='255';alpha.step='1';alpha.value='255';alpha.setAttribute('aria-label','Alpha štětce 0–255');alpha.hidden=bitmap.bits!==32;
  index.type='number';index.min='0';index.max=String(bitmap.palette.length-1);index.step='1';index.value='0';index.setAttribute('aria-label','Index palety');index.hidden=changePalette.hidden=bitmap.bits!==8;
  const alphaLabel=make('label','Alpha '),indexLabel=make('label','Index palety ');alphaLabel.hidden=bitmap.bits!==32;indexLabel.hidden=bitmap.bits!==8;alphaLabel.append(alpha);indexLabel.append(index);
  tools.append(tool,color,alphaLabel,indexLabel,changePalette,zoom,mode,undo,redo,submit);area.append(canvas);main.append(tools,info,area);
  const note=make('p',bitmap.bits===8?'Tužka používá vybraný index palety. Změna barvy palety změní všechny pixely tohoto indexu. Barevný klíč vychází z RGB barvy položky 0; průhlednost musí být zapnutá také v materiálu 4DS.':bitmap.bits===32?'Alpha štětce se ukládá do čtvrtého bajtu pixelu. Její použití ve hře řídí materiál 4DS. Náhled alphy lze přepnout nezávisle na úpravách.':'Tužka ukládá RGB přímo do pixelů. Průhlednost a případnou samostatnou alpha masku řídí materiál 4DS.');note.className='notice';main.append(note);
  if(bitmap.bits===8)main.append(palette);
  const rgb=()=>[1,3,5].map(at=>parseInt(color.value.slice(at,at+2),16)),hex=value=>'#'+value.slice(0,3).map(component=>component.toString(16).padStart(2,'0')).join('');
  let paletteIndex=0,pointer=null,last=null,queued=false;
  const paletteButtons=[];
  function update(){
    submit.disabled=busy()||!edits.size;submit.textContent=`Uložit texturu (${edits.size})`;undo.disabled=busy()||!draft.undo.length;redo.disabled=busy()||!draft.redo.length;
    info.textContent=`${bitmap.width} × ${bitmap.height} px · ${bitmap.bits} bitů · ${edits.size} změněných pixelů / barev palety`;
    for(let i=0;i<paletteButtons.length;i++){paletteButtons[i].style.backgroundColor=hex(draft.value('palette',i));paletteButtons[i].setAttribute('aria-pressed',String(i===paletteIndex));}
  }
  function draw(){if(!canvas.isConnected)return;canvas.getContext('2d').putImageData(new ImageData(draft.rgba(mode.value),bitmap.width,bitmap.height),0,0);update();}
  function schedule(){if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;draw();});update();}
  function resize(){const scale=zoom.value==='fit'?Math.min((area.clientWidth-24)/bitmap.width,(area.clientHeight-24)/bitmap.height,1):Number(zoom.value)/100;canvas.style.width=`${Math.max(.01,scale)*bitmap.width}px`;canvas.style.height=`${Math.max(.01,scale)*bitmap.height}px`;}
  function pickPalette(value){paletteIndex=value;index.value=String(value);color.value=hex(draft.value('palette',value));update();}
  for(let i=0;i<bitmap.palette.length;i++){const button=make('button');button.title=`Barva ${i}${i===0?' · barevný klíč':''}`;button.setAttribute('aria-label',button.title);button.onclick=()=>pickPalette(i);paletteButtons.push(button);palette.append(button);}
  index.onchange=()=>{const value=Number(index.value);if(Number.isInteger(value)&&value>=0&&value<bitmap.palette.length)pickPalette(value);else index.value=String(paletteIndex);};
  if(bitmap.bits===8)pickPalette(0);
  function coords(event){const rect=canvas.getBoundingClientRect(),x=Math.floor((event.clientX-rect.left)*bitmap.width/rect.width),y=Math.floor((event.clientY-rect.top)*bitmap.height/rect.height);return x>=0&&x<bitmap.width&&y>=0&&y<bitmap.height?[x,y]:null;}
  function paint(point,value){
    if(!point)return;
    const [x1,y1]=point,[x0,y0]=last??point,steps=Math.max(Math.abs(x1-x0),Math.abs(y1-y0));
    for(let step=0;step<=steps;step++){const ratio=steps?step/steps:0,x=Math.round(x0+(x1-x0)*ratio),y=Math.round(y0+(y1-y0)*ratio);draft.set('pixel',y*bitmap.width+x,value);}last=point;schedule();
  }
  let brush;
  canvas.onpointerdown=event=>{
    if(event.button!==0||busy()||pointer!==null)return;const point=coords(event);if(!point)return;
    if(tool.value==='picker'||event.altKey){const value=draft.value('pixel',point[1]*bitmap.width+point[0]);if(bitmap.bits===8)pickPalette(value);else{color.value=hex(value);if(bitmap.bits===32)alpha.value=String(value[3]);}return;}
    const opacity=Number(alpha.value);if(bitmap.bits===32&&(alpha.value===''||!Number.isInteger(opacity)||opacity<0||opacity>255)){status('Alpha musí být celé číslo 0–255.',true);return;}
    brush=bitmap.bits===8?paletteIndex:bitmap.bits===32?[...rgb(),opacity]:rgb();pointer=event.pointerId;last=null;canvas.setPointerCapture(pointer);draft.begin();paint(point,brush);event.preventDefault();
  };
  canvas.onpointermove=event=>{if(event.pointerId===pointer){const point=coords(event);if(point)paint(point,brush);else last=null;}};
  const end=event=>{if(event.pointerId!==pointer)return;draft.end();pointer=null;last=null;schedule();};canvas.onpointerup=end;canvas.onpointercancel=end;canvas.onlostpointercapture=end;
  changePalette.onclick=()=>{if(busy()||pointer!==null)return;draft.begin();draft.set('palette',paletteIndex,rgb());draft.end();schedule();};
  undo.onclick=()=>{if(busy()||pointer!==null)return;draft.step();if(bitmap.bits===8)pickPalette(paletteIndex);schedule();};redo.onclick=()=>{if(busy()||pointer!==null)return;draft.step(true);if(bitmap.bits===8)pickPalette(paletteIndex);schedule();};
  submit.onclick=async()=>{await run(async()=>{if(pointer!==null)throw new Error('Nejdřív dokončete tah štětcem.');submit.disabled=true;await save(draft.changes());});if(canvas.isConnected)update();};
  zoom.onchange=resize;mode.onchange=schedule;
  const observer=new ResizeObserver(()=>{if(!area.isConnected){observer.disconnect();return;}resize();});observer.observe(area);draw();requestAnimationFrame(resize);
}
