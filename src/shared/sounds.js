// I3D_SOUNDTYPE and CT_MODIFY_SOUND; angles in the file are radians.
export const soundTypes = [
  {value:1,label:'Bodový zvuk'}, {value:2,label:'Směrový zvuk'},
  {value:3,label:'Okolní zvuk'}, {value:4,label:'Objemový zvuk'},
  {value:5,label:'Bodový okolní zvuk'}
];
export const soundDefaults = {type:1,volume:1,outVolume:0,cone:[360,360],range:[1,10,1,0],loop:true};

export function validateNewSound(parameters, availableSectors) {
  if(!parameters||typeof parameters!=='object'||Array.isArray(parameters)||Object.keys(parameters).some(key=>!['file','type','volume','outVolume','cone','range','loop','sectors'].includes(key)))throw new Error('Zvuk: neplatné parametry.');
  const p={...soundDefaults,...parameters};
  const finite=n=>typeof n==='number'&&Number.isFinite(n)&&Number.isFinite(Math.fround(n));
  const vector=(value,length)=>Array.isArray(value)&&value.length===length&&Array.from(value).every(finite);
  if(typeof p.file!=='string'||p.file.length>255||!p.file.toLowerCase().endsWith('.wav')||/[\x00-\x1f\x7f/:*?"<>|]/.test(p.file)||p.file.split('\\').some(part=>!part||part==='.'||part==='..'||/[. ]$/.test(part)))throw new Error('Zvuk: vyberte WAV ze složky sounds.');
  if(!soundTypes.some(t=>t.value===p.type))throw new Error('Zvuk: vyberte podporovaný typ 1–5.');
  if(![p.volume,p.outVolume].every(n=>finite(n)&&n>=0&&n<=1))throw new Error('Zvuk: hlasitosti musí být v rozsahu 0–1.');
  if(!vector(p.range,4)||p.range[0]<0||Math.fround(p.range[1])<=Math.fround(p.range[0])||p.range.slice(2).some(n=>n<0||n>1))throw new Error('Zvuk: zadejte nezáporný vnitřní a větší vnější poloměr, oba útlumy v rozsahu 0–1.');
  if(!vector(p.cone,2)||p.cone[0]<0||Math.fround(p.cone[1]*Math.PI/180)<=0||p.cone[0]>p.cone[1]||p.cone[1]>360)throw new Error('Zvuk: kužel musí mít 0 ≤ vnitřní ≤ vnější ≤ 360 stupňů.');
  if(typeof p.loop!=='boolean')throw new Error('Zvuk: opakování musí být zapnuté nebo vypnuté.');
  if(!Array.isArray(p.sectors)||!p.sectors.length||p.sectors.length>256||p.sectors.some(name=>typeof name!=='string'))throw new Error('Zvuk: vyberte alespoň jeden sektor.');
  const key=name=>name.normalize('NFC').toLowerCase(), names=new Map(availableSectors.map(name=>[key(name),name]));
  if(new Set(p.sectors.map(key)).size!==p.sectors.length||p.sectors.some(name=>!names.has(key(name))))throw new Error('Zvuk: chybějící, duplicitní nebo nejednoznačný sektor.');
  return {...p,cone:p.cone.map(n=>n*Math.PI/180),sectors:p.sectors.map(name=>names.get(key(name)))};
}
