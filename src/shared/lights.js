// LS3D I3D_LIGHTTYPE; CT_MODIFY_LIGHT stores cone angles in radians.
export const lightTypes = [
  {value:1,label:'Bodové světlo'}, {value:2,label:'Reflektor'},
  {value:3,label:'Směrové světlo'}, {value:4,label:'Okolní světlo'},
  {value:5,label:'Mlha'}, {value:6,label:'Bodové okolní světlo'},
  {value:7,label:'Bodová mlha'}, {value:8,label:'Vrstvená mlha'}
];
export const lightDefaults = {type:1,color:[1,1,1],power:1,cone:[20,40],range:[1,40],mode:99};

export function sceneSectors(objects = [], geometry = []) {
  const key=name=>name.normalize('NFC').toLowerCase(), result=new Map([['primary sector','Primary sector'],['backdrop sector','Backdrop sector']]);
  for(const frame of [...objects.filter(o=>o.frameType===5),...geometry.filter(o=>o.type===5)]){
    const name=frame.name;
    if(!name||objects.filter(o=>key(o.name)===key(name)).length>1||geometry.filter(o=>key(o.name)===key(name)).length>1)continue;
    result.set(key(name),name);
  }
  return [...result.values()];
}

export function validateNewLight(parameters, availableSectors) {
  if(!parameters||typeof parameters!=='object'||Array.isArray(parameters)||Object.keys(parameters).some(key=>!['type','color','power','cone','range','mode','sectors'].includes(key)))throw new Error('Světlo: neplatné parametry.');
  const p={...lightDefaults,...parameters};
  const finite=n=>typeof n==='number'&&Number.isFinite(n)&&Number.isFinite(Math.fround(n));
  const vector=(value,length)=>Array.isArray(value)&&value.length===length&&Array.from(value).every(finite);
  if(!lightTypes.some(t=>t.value===p.type))throw new Error('Světlo: vyberte podporovaný typ 1–8.');
  if(!vector(p.color,3)||p.color.some(n=>n<0||n>1))throw new Error('Světlo: barva RGB musí být v rozsahu 0–1.');
  if(!finite(p.power)||p.power<0)throw new Error('Světlo: neplatná intenzita.');
  // The game silently repairs near <= 1e-8 and far <= near. Write valid ranges.
  if(!vector(p.range,2)||p.range[0]<=1e-8||Math.fround(p.range[1])<=Math.fround(p.range[0]))throw new Error('Světlo: dosah musí mít kladný začátek a větší konec.');
  if(!vector(p.cone,2)||p.cone[0]<0||Math.fround(p.cone[1]*Math.PI/180)<=0||p.cone[0]>p.cone[1]||p.cone[1]>180)throw new Error('Světlo: kužel musí mít 0 ≤ vnitřní ≤ vnější ≤ 180 stupňů.');
  if(!Number.isInteger(p.mode)||p.mode<0||p.mode>0xffffffff)throw new Error('Světlo: režim musí být celé číslo 0–4294967295.');
  if(!Array.isArray(p.sectors)||!p.sectors.length||p.sectors.length>256||p.sectors.some(name=>typeof name!=='string'))throw new Error('Světlo: vyberte alespoň jeden sektor.');
  const key=name=>name.normalize('NFC').toLowerCase(), names=new Map(availableSectors.map(name=>[key(name),name]));
  if(new Set(p.sectors.map(key)).size!==p.sectors.length||p.sectors.some(name=>!names.has(key(name))))throw new Error('Světlo: chybějící, duplicitní nebo nejednoznačný sektor.');
  return {...p,cone:p.cone.map(n=>n*Math.PI/180),sectors:p.sectors.map(name=>names.get(key(name)))};
}
