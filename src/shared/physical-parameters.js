// C_box_new descriptor v2. The byte mEdit calls "collide" selects box/wheel.
export const physicalFields = [
  {key:'box',label:'Fyzikální box (vypnuto = kolo)',kind:'boolean',offset:1},
  {key:'wheelRadius',label:'Poloměr kola (herní jednotky; jen kolo)',kind:'float',offset:2,min:.000001},
  {key:'mass',label:'Hmotnost (herní jednotky)',kind:'float',offset:10,min:.01,max:100000},
  {key:'friction',label:'Tření fyzikálního tělesa',kind:'float',offset:14,min:0},
  {key:'wheelDamping',label:'Tlumení kola (jen kolo)',kind:'float',offset:18,min:0},
  {key:'impactSound',label:'Sloupec nárazového zvuku (−1 = ticho)',kind:'int',offset:22,min:-1,max:13},
  {key:'restartSound',label:'Nový náraz může přerušit předchozí zvuk',kind:'boolean',offset:26},
  {key:'hitParameter',label:'Parametr zásahu (původní raw ID)',kind:'int',offset:27,min:-2147483648,max:2147483647}
];
