export const detectorMasks=[
  {value:0,label:'Pouze skript (bez počítání postav)'},
  {value:1,label:'Hráč'},
  {value:4,label:'Policie'},
  {value:16,label:'Gangsteři'},
  {value:128,label:'Pasažér taxi'},
  {value:129,label:'Hráč a pasažér taxi'}
];

export function proximityDetectorScript(radius,action=''){
  if(typeof radius!=='number'||!Number.isFinite(radius)||radius<=0||Math.fround(radius)<=0||!Number.isFinite(Math.fround(radius)))throw new Error('Detektor: poloměr musí být kladné konečné číslo.');
  if(typeof action!=='string'||/^\s*label\s+(?:10|20)\b/im.test(action))throw new Error('Detektor: šablona používá label 10 a 20; v akci použijte jiné labely nebo vlastní skript.');
  return `dim_flt 1\nlabel 10\ndetector_inrange 0, ${radius}\nif flt[0] > 0, 20, -1\nwait 100\ngoto 10\nlabel 20\n${action}\nend`;
}
