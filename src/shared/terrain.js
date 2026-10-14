import { geometryNormals } from './geometry-draft.js';

export function terrainModel(options){
  if(!options||typeof options!=='object'||Array.isArray(options))throw new Error('Terén: neplatné nastavení.');
  const {name,texture,width,depth,columns,rows,heights,tileSize}=options;
  if(typeof name!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(name)||/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(name))throw new Error('Terén: název musí mít 1–80 znaků bez cesty, přípony či diakritiky.');
  if(typeof texture!=='string'||!/^maps\/[A-Za-z0-9_ #!.-]+\.bmp$/i.test(texture)||texture.slice(5).length>120)throw new Error('Terén: vyberte BMP z hlavní složky maps.');
  for(const value of [width,depth,tileSize])if(typeof value!=='number'||!Number.isFinite(value)||value<.01||value>8192)throw new Error('Terén: rozměry a velikost opakování musí být 0,01–8192 metrů.');
  for(const value of [columns,rows])if(!Number.isInteger(value)||value<1||value>128)throw new Error('Terén: počet polí musí být celé číslo 1–128 v každém směru.');
  if(!Array.isArray(heights)||heights.length!==4||!Array.from(heights).every(value=>typeof value==='number'&&Number.isFinite(value)&&Math.abs(value)<=32768))throw new Error('Terén: čtyři výšky rohů musí být konečné v rozsahu ±32768 metrů.');
  const positions=[],uv=[],indices=[];
  // Native Y is up; corners follow (-X,-Z), (+X,-Z), (-X,+Z), (+X,+Z).
  for(let z=0;z<=rows;z++)for(let x=0;x<=columns;x++){
    const u=x/columns,v=z/rows,y=(heights[0]*(1-u)+heights[1]*u)*(1-v)+(heights[2]*(1-u)+heights[3]*u)*v;
    positions.push(...[width*(u-.5),y,depth*(v-.5)].map(Math.fround));
    uv.push(Math.fround(width*u/tileSize),Math.fround(-depth*v/tileSize));
  }
  for(let z=0;z<rows;z++)for(let x=0;x<columns;x++){const a=z*(columns+1)+x,b=a+1,c=a+columns+1,d=c+1;indices.push(a,c,b,b,c,d);}
  const faces=[{material:1,indices}],normals=geometryNormals(positions,faces).map(Math.fround);
  if(normals.some(value=>!Number.isFinite(value)))throw new Error('Terén: neplatné normály.');
  const material={flags:0x00840001,ambient:[1,1,1],diffuse:[1,1,1],emission:[0,0,0],opacity:1,texture:texture.slice(5)};
  const mesh={id:1,name:'Terrain',type:1,visual:0,renderFlags:0,logicFlags:0x2a,culling:9,parent:0,position:[0,0,0],rotation:[1,0,0,0],scale:[1,1,1],properties:'',instance:0,lods:[{distance:0,vertices:positions.length/3,positions,normals,uv,faces}]};
  return {version:29,materials:[material],meshes:[mesh],animated:0};
}
