import {sectorVolume} from './sector-geometry.js';

export function sectorBox(options){
  if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(k=>!['name','center','size','flags'].includes(k)))throw new Error('Sektor: neplatné nastavení.');
  const {name,center,size}=options,flags=Object.hasOwn(options,'flags')?options.flags:[2049,0];
  if(typeof name!=='string'||!/^[A-Za-z_][A-Za-z0-9_ -]{0,79}$/.test(name)||name.trim()!==name||['primary sector','backdrop sector'].includes(name.toLowerCase()))throw new Error('Sektor: název musí mít 1–80 ASCII písmen, číslic, mezer nebo podtržítek a začínat písmenem či podtržítkem.');
  if(!Array.isArray(center)||center.length!==3||!Array.from(center).every(v=>typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=32768))throw new Error('Sektor: střed XYZ musí být v rozsahu ±32768 metrů.');
  if(!Array.isArray(size)||size.length!==3||!Array.from(size).every(v=>typeof v==='number'&&Number.isFinite(v)&&v>=.01&&v<=8192))throw new Error('Sektor: rozměry XYZ musí být 0,01–8192 metrů.');
  if(!Array.isArray(flags)||flags.length!==2||!Array.from(flags).every(v=>Number.isInteger(v)&&v>=0&&v<=4294967295))throw new Error('Sektor: příznaky musí být dvě celé hodnoty uint32.');
  const positions=[[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]].flatMap(p=>p.map((v,i)=>center[i]+v*size[i]/2));
  const indices=[0,1,2,0,2,3,4,6,5,4,7,6,0,3,7,0,7,4,1,5,6,1,6,2,0,4,5,0,5,1,3,2,6,3,6,7];
  const geometry=sectorVolume(positions,indices);
  return {id:1,name,type:5,parent:0,position:[0,0,0],scale:[1,1,1],rotation:[1,0,0,0],culling:125,properties:'',sector:{...geometry,vertices:8,faces:12,flags:[...flags],portals:[]}};
}
