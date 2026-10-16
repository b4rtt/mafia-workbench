import { ShapeUtils } from 'three/src/extras/ShapeUtils.js';
import { Vector2 } from 'three/src/math/Vector2.js';
import { materialFlags as flags } from '../shared/material-settings.js';

const fail = (where, message) => { throw new Error(`OBJ/MTL ${where}: ${message}`); };
const cross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const sub = (a,b) => a.map((v,i)=>v-b[i]);
const dot = (a,b) => a.reduce((sum,v,i)=>sum+v*b[i],0);
const unit = (v,where) => { const size=Math.hypot(...v);if(!size)fail(where,'nulová normála nebo degenerovaná plocha.');return v.map(n=>n/size); };
const identifier = (value,where) => {if(value.length>255)fail(where,'název části nebo materiálu má přes 255 znaků.');return value;};
function numbers(args,count,where) {
  if(args.length!==count||args.some(v=>!/^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i.test(v)))fail(where,`očekávám ${count} čísel.`);
  const values=args.map(Number);if(values.some(v=>!Number.isFinite(v)||!Number.isFinite(Math.fround(v))))fail(where,'souřadnice přesahují float32.');return values;
}
function lines(file) {
  let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(file.data);}catch{fail(file.name,'text musí být UTF-8.');}
  if(text.includes('\0'))fail(file.name,'binární data místo textu.');
  const result=[];let pending='',start=0;
  for(const [i,line]of text.split(/\r?\n/).entries()){
    const value=line.replace(/#.*$/,'').trim();if(!pending)start=i+1;
    if(value.endsWith('\\')){pending+=value.slice(0,-1)+' ';continue;}
    const full=(pending+value).trim();pending='';if(!full)continue;
    const match=/^(\S+)(?:\s+(.*))?$/.exec(full);result.push({op:match[1],rest:match[2]??'',where:`${file.name}:${start}`});
  }
  if(pending)fail(file.name,'nedokončené pokračování řádku.');return result;
}
// References are names only. Even a safe relative directory is flattened and
// resolved exclusively against files explicitly selected by the user.
function reference(value,extension,where,warnings) {
  let name=value.trim();if(name.startsWith('"')&&name.endsWith('"'))name=name.slice(1,-1);
  const pieces=name.replaceAll('\\','/').split('/');
  if(!name||/^[\/\\]|^[a-z]:/i.test(name)||pieces.some(p=>p==='..'||!p)||/[<>:"|?*]/.test(name))fail(where,'nebezpečná nebo nejednoznačná cesta závislosti.');
  name=pieces.at(-1);
  if(!/^[\x20-\x7e]+$/.test(name)||name.length>120||!name.toLowerCase().endsWith(extension)||name.length<=extension.length||name.trim()!==name||/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name))fail(where,`závislost musí být ${extension} s názvem bez diakritiky.`);
  if(pieces.length>1)warnings.add(`Cesta ${value} se převede na samotný název ${name}; soubor vyberte ručně.`);
  return name;
}
function libraries(rest,where,warnings) {
  const values=rest.match(/"[^"]*"|\S+/g)??[];
  if(!values.length)fail(where,'chybí název knihovny MTL.');
  return values.map(v=>reference(v,'.mtl',where,warnings));
}
function materialLibrary(file,warnings) {
  const materials=new Map();let current;
  for(const {op,rest,where}of lines(file)){
    const args=rest.split(/\s+/);
    if(op==='newmtl'){
      if(!identifier(rest,where)||materials.has(rest))fail(where,'prázdný nebo opakovaný materiál.');
      current={name:rest,flags:0x00800001|flags.colored,ambient:[1,1,1],diffuse:[1,1,1],emission:[0,0,0],opacity:1,texture:''};materials.set(rest,current);continue;
    }
    if(!current)fail(where,'vlastnost bez newmtl.');
    if(['Ka','Kd','Ke'].includes(op)){
      const values=numbers(args,3,where);if(values.some(n=>n<0||n>1))fail(where,'barva musí být RGB v rozsahu 0–1.');
      current[{Ka:'ambient',Kd:'diffuse',Ke:'emission'}[op]]=values;
    }else if(op==='d'||op==='Tr'){
      const [value]=numbers(args,1,where);if(value<0||value>1)fail(where,'krytí musí být v rozsahu 0–1.');
      const opacity=op==='Tr'?1-value:value;if(current.alphaDefined&&Math.abs(opacity-current.opacity)>1e-6)fail(where,'rozporné hodnoty d/Tr.');current.opacity=opacity;current.alphaDefined=true;
    }else if(op==='map_Kd'||op==='map_d'){
      let value=rest;const clamp=/^-clamp\s+(on|off)\s+(.+)$/.exec(value);
      if(clamp)value=clamp[2];
      if(value.startsWith('-'))fail(where,'volby mapy kromě -clamp nejsou podporované; aplikujte je při exportu.');
      const name=reference(value,'.bmp',where,warnings),field=op==='map_Kd'?'texture':'alphaTexture';
      if(current[field]&&(current[field]!==name||current[field+'Clamp']!==(clamp?.[1]??'off')))fail(where,'opakovaná rozdílná textura nebo -clamp.');current[field]=name;
      current[field+'Clamp']=clamp?.[1]??'off';
    }else if(['Ks','Ns','Ni','illum','Tf','Pr','Pm','Ps','Pc','Pcr','aniso','anisor'].includes(op)){
      numbers(args,['Ks','Tf'].includes(op)?3:1,where);warnings.add('Odlesky, index lomu a PBR nastavení MTL se nepřevádějí; používá se difuzní materiál Mafia.');
    }else fail(where,`nepodporovaná vlastnost ${op}; převeďte ji v modelovacím programu.`);
  }
  for(const material of materials.values()){
    if(material.alphaTexture&&!material.texture)fail(file.name,`materiál ${material.name}: map_d potřebuje také map_Kd.`);
    if(material.alphaTexture&&material.textureClamp!==material.alphaTextureClamp)fail(file.name,`materiál ${material.name}: map_d a map_Kd musí mít shodné -clamp.`);
    if(material.textureClamp==='on')material.flags|=flags.noTileU|flags.noTileV;
    if(material.texture)material.flags|=flags.diffuse;
    if(material.alphaTexture)material.flags|=flags.alpha|flags.alphaTexture;
  }
  return materials;
}
function triangulate(corners,vertices,where) {
  if(corners.length<3||corners.length>1024)fail(where,'plocha potřebuje 3–1024 vrcholů.');
  const points=corners.map(c=>vertices[c.v]),origin=points[0],relative=points.map(p=>sub(p,origin)),normal=[0,0,0];
  for(let i=1;i<points.length-1;i++){const n=cross(relative[i],relative[i+1]);for(let axis=0;axis<3;axis++)normal[axis]+=n[axis];}
  const axisNormal=unit(normal,where),size=Math.max(...relative.map(p=>Math.hypot(...p)));
  if(relative.some(p=>Math.abs(dot(p,axisNormal))>Math.max(1e-7,size*1e-5)))fail(where,'neplanární polygon; triangulujte jej před exportem.');
  const drop=axisNormal.map(Math.abs).indexOf(Math.max(...axisNormal.map(Math.abs))),axes=[0,1,2].filter(a=>a!==drop),contour=relative.map(p=>new Vector2(p[axes[0]],p[axes[1]]));
  const orient=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x),epsilon=size*size*1e-12;
  const onSegment=(a,b,p)=>Math.abs(orient(a,b,p))<=epsilon&&p.x>=Math.min(a.x,b.x)-size*1e-12&&p.x<=Math.max(a.x,b.x)+size*1e-12&&p.y>=Math.min(a.y,b.y)-size*1e-12&&p.y<=Math.max(a.y,b.y)+size*1e-12;
  for(let i=0;i<contour.length;i++){
    const a=contour[i],b=contour[(i+1)%contour.length];if(a.distanceTo(b)<=size*1e-10)fail(where,'opakovaný vrchol polygonu.');
    for(let j=i+1;j<contour.length;j++){
      if(j===i+1||(i===0&&j===contour.length-1))continue;
      const c=contour[j],d=contour[(j+1)%contour.length],abC=orient(a,b,c),abD=orient(a,b,d),cdA=orient(c,d,a),cdB=orient(c,d,b);
      if((abC*abD<0&&cdA*cdB<0)||onSegment(a,b,c)||onSegment(a,b,d)||onSegment(c,d,a)||onSegment(c,d,b))fail(where,'polygon se protíná.');
    }
  }
  const triangles=corners.length===3?[[0,1,2]]:ShapeUtils.triangulateShape(contour,[]);let area=0;
  for(const triangle of triangles){const n=cross(sub(points[triangle[1]],points[triangle[0]]),sub(points[triangle[2]],points[triangle[0]]));if(Math.hypot(...n)<=epsilon)fail(where,'degenerovaný trojúhelník.');if(dot(n,normal)<0)[triangle[1],triangle[2]]=[triangle[2],triangle[1]];area+=Math.hypot(...n);}
  if(triangles.length!==corners.length-2||Math.abs(area-Math.hypot(...normal))>Math.max(1e-10,area*1e-6))fail(where,'polygon nelze bezpečně triangulovat; odstraňte kolineární hrany nebo triangulujte před exportem.');
  return {triangles,normal};
}

export function objModel(source,companions,options={}) {
  if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(k=>!['up','scale'].includes(k)))fail(source.name,'neplatné nastavení převodu.');
  const up=options.up??'y',scale=options.scale??1;
  if(!['y','z'].includes(up)||typeof scale!=='number'||!Number.isFinite(scale)||scale<=0||scale>1000000)fail(source.name,'osa musí být Y/Z a měřítko kladné, nejvýše 1000000.');
  const transform=p=>up==='y'?[p[0],p[1],-p[2]]:[p[0],p[2],p[1]],warnings=new Set(),vertices=[],uv=[],normals=[],polygons=[],requested=new Map();
  let object='Model',group='',part=0,smooth='',material='',triangleTotal=0;
  for(const {op,rest,where}of lines(source)){
    const args=rest.split(/\s+/);
    if(op==='v'){
      if(![3,4].includes(args.length))fail(where,'podporuji XYZ a volitelné W=1, bez barev vrcholů.');
      const values=numbers(args,args.length,where);if(![3,4].includes(values.length)||(values.length===4&&values[3]!==1))fail(where,'podporuji XYZ a volitelné W=1, bez barev vrcholů.');vertices.push(values.slice(0,3));
    }else if(op==='vt'){
      if(args.length<1||args.length>3)fail(where,'podporuji UV souřadnice s volitelným W=0.');
      const values=numbers(args,args.length,where);if(values.length<1||values.length>3||(values.length===3&&values[2]!==0))fail(where,'podporuji UV souřadnice s volitelným W=0.');uv.push([values[0],values[1]??0]);
    }else if(op==='vn')normals.push(unit(numbers(args,3,where),where));
    else if(op==='mtllib')for(const name of libraries(rest,where,warnings))requested.set(name.toLowerCase(),name);
    else if(op==='usemtl'){if(!rest)fail(where,'chybí název materiálu.');material=identifier(rest,where);}
    else if(op==='o'||op==='g'){identifier(rest,where);if(op==='o')object=rest||'Model';else group=rest==='off'?'':rest;part++;}
    else if(op==='s'){if(!/^(?:off|on|\d+)$/.test(rest)||!['on','off'].includes(rest)&&!Number.isSafeInteger(Number(rest)))fail(where,'neplatná vyhlazovací skupina.');smooth=rest==='off'||Number(rest)===0?'':rest==='on'?'1':String(Number(rest));}
    else if(op==='f'){
      if(args.length<3||args.length>1024)fail(where,'plocha potřebuje 3–1024 vrcholů.');
      const index=(value,length)=>{if(!/^[+-]?\d+$/.test(value))fail(where,'neplatný index vrcholu.');const n=Number(value),at=n<0?length+n:n-1;if(!Number.isSafeInteger(n)||!n||at<0||at>=length)fail(where,'index odkazuje mimo dosud definované vrcholy.');return at;};
      const corners=args.map(value=>{const fields=value.split('/');if(fields.length>3||!fields[0]||(fields.length===2&&!fields[1])||(fields.length===3&&!fields[2]))fail(where,'neplatná vazba v/vt/vn.');return {v:index(fields[0],vertices.length),t:fields[1]?index(fields[1],uv.length):null,n:fields[2]?index(fields[2],normals.length):null};});
      const triangulated=triangulate(corners,vertices,where);triangleTotal+=triangulated.triangles.length;if(triangleTotal>2000000)fail(where,'nejvýše 2000000 trojúhelníků na jeden import.');polygons.push({corners,...triangulated,part,name:group?`${object}_${group}`:object,smooth,material,where});
      if(polygons.length>500000)fail(where,'nejvýše 500000 polygonů na jeden import.');
    }else fail(where,`nepodporovaná geometrie nebo příkaz ${op}; exportujte statickou polygonovou síť.`);
    if(Math.max(vertices.length,uv.length,normals.length)>1000000)fail(where,'nejvýše 1000000 zdrojových pozic, UV nebo normál.');
  }
  if(!polygons.length)fail(source.name,'model nemá žádné polygonové plochy.');
  const blocked=[],materialsByName=new Map();
  for(const [canonical,name]of requested){
    const file=companions.find(f=>f.name.toLowerCase()===canonical);
    if(!file){blocked.push(`Chybí knihovna ${name}. Vyberte ji spolu s BMP texturami.`);continue;}
    for(const [name,material]of materialLibrary(file,warnings)){if(materialsByName.has(name))fail(file.name,`materiál ${name} je definovaný ve více knihovnách.`);materialsByName.set(name,material);}
  }
  for(const file of companions.filter(f=>f.extension==='.mtl'))if(!requested.has(file.name.toLowerCase()))warnings.add(`Knihovna ${file.name} není uvedená v mtllib a nepoužije se.`);
  const materials=[],materialIds=new Map(),defaultMaterial={name:'Default',flags:0x00800001|flags.colored,ambient:[1,1,1],diffuse:[.8,.8,.8],emission:[0,0,0],opacity:1,texture:''};
  for(const polygon of polygons){
    if(!materialIds.has(polygon.material)){
      const material=polygon.material?materialsByName.get(polygon.material):defaultMaterial;
      if(!material&&!blocked.length)fail(polygon.where,`materiál ${polygon.material} není definovaný v MTL.`);
      materials.push(material??defaultMaterial);materialIds.set(polygon.material,materials.length);
      if(materials.length>65535)fail(source.name,'příliš mnoho materiálů.');
    }
    const mat=materials[materialIds.get(polygon.material)-1];if(mat.texture&&polygon.corners.some(c=>c.t===null))fail(polygon.where,'texturovaná plocha nemá UV u všech vrcholů.');
  }
  const smoothNormals=new Map();
  for(const polygon of polygons)if(polygon.smooth)for(const v of new Set(polygon.corners.map(c=>c.v))){
    const key=`${polygon.smooth}/${v}`,sum=smoothNormals.get(key)??[0,0,0];for(let axis=0;axis<3;axis++)sum[axis]+=polygon.normal[axis];smoothNormals.set(key,sum);
  }
  const meshes=[],names=new Set(),nameCounts=new Map();let mesh,lookup,face,previousPart,totalVertices=0;
  const begin=polygon=>{
    const base=polygon.name.replace(/[^a-zA-Z0-9_.-]+/g,'_').slice(0,100)||'Model';let n=nameCounts.get(base.toLowerCase())??1,name=n===1?base:`${base}_${n}`;while(names.has(name.toLowerCase()))name=`${base}_${++n}`;names.add(name.toLowerCase());nameCounts.set(base.toLowerCase(),n+1);
    if(base!==polygon.name)warnings.add('Názvy částí jsou převedené na ASCII pro herní 4DS.');
    mesh={id:meshes.length+1,name,type:1,visual:0,renderFlags:0,logicFlags:0x2a,culling:9,parent:0,position:[0,0,0],rotation:[1,0,0,0],scale:[1,1,1],lods:[{distance:0,vertices:0,positions:[],normals:[],uv:[],faces:[]}]};meshes.push(mesh);lookup=new Map();face=null;
    if(meshes.length>65535)fail(source.name,'příliš mnoho částí modelu.');
  };
  for(const [polygonIndex,polygon]of polygons.entries())for(const triangle of polygon.triangles){
    const corners=triangle.map(i=>polygon.corners[i]),keys=corners.map(c=>`${c.v}/${c.t}/${c.n===null?polygon.smooth?`s${polygon.smooth}`:`f${polygonIndex}`:`n${c.n}`}`),material=materialIds.get(polygon.material);
    if(!mesh||previousPart!==polygon.part||mesh.lods[0].vertices+new Set(keys.filter(k=>!lookup.has(k))).size>65535||(!face||face.material!==material||face.indices.length===65535*3)&&mesh.lods[0].faces.length===255)begin(polygon);
    previousPart=polygon.part;const lod=mesh.lods[0];
    if(!face||face.material!==material||face.indices.length===65535*3){face={material,indices:[]};lod.faces.push(face);}
    const indices=corners.map((c,i)=>{
      if(lookup.has(keys[i]))return lookup.get(keys[i]);
      const at=lod.vertices++,position=transform(vertices[c.v]).map(v=>Math.fround(v*scale)),normal=transform(c.n===null?unit(polygon.smooth?smoothNormals.get(`${polygon.smooth}/${c.v}`):polygon.normal,polygon.where):normals[c.n]),texture=c.t===null?[0,0]:[uv[c.t][0],1-uv[c.t][1]];
      if(++totalVertices>1000000)fail(source.name,'nejvýše 1000000 výsledných vrcholů.');
      if(position.some(v=>!Number.isFinite(v)))fail(polygon.where,'měřítko překračuje rozsah float32.');
      lod.positions.push(...position);lod.normals.push(...normal);lod.uv.push(...texture);lookup.set(keys[i],at);return at;
    });
    // Reflect source right-handed coordinates to LS3D and reverse winding so
    // geometric normals still agree with the transformed authored normals.
    const points=indices.map(i=>lod.positions.slice(i*3,i*3+3));if(!Math.hypot(...cross(sub(points[1],points[0]),sub(points[2],points[0]))))fail(polygon.where,'po převodu na float32 zanikl trojúhelník; posuňte model blíž k počátku nebo změňte měřítko.');
    face.indices.push(indices[0],indices[2],indices[1]);
  }
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];let vertexCount=0,triangleCount=0;
  for(const mesh of meshes){const lod=mesh.lods[0];vertexCount+=lod.vertices;triangleCount+=lod.faces.reduce((n,f)=>n+f.indices.length/3,0);for(let i=0;i<lod.positions.length;i++) {const axis=i%3;min[axis]=Math.min(min[axis],lod.positions[i]);max[axis]=Math.max(max[axis],lod.positions[i]);}}
  return {model:{version:29,materials,meshes},blocked,warnings:[...warnings],summary:{source:'obj',vertices:vertexCount,triangles:triangleCount,bounds:{min,max},up,scale}};
}
