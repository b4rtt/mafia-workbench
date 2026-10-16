import { roadConnections, roadSettingsPair } from './roads.js';
import { geometryNormals } from './geometry-draft.js';
import { roadJunctionPlan } from './road-junction.js';

const fail=message=>{throw new Error(`Ulice: ${message}`);};
const cross=(a,b,c)=>(b[0]-a[0])*(c[2]-a[2])-(b[2]-a[2])*(c[0]-a[0]);
// Convex segment footprints must not overlap, including when wide sidewalks
// meet a nearby part of the route. Adjacent segments share their miter edge.
function overlap(a,b){
  for(const polygon of [a,b])for(let i=0;i<4;i++){
    const p=polygon[i],q=polygon[(i+1)%4],axis=[q[2]-p[2],p[0]-q[0]],project=r=>r[0]*axis[0]+r[2]*axis[1];
    const x=a.map(project),y=b.map(project);
    if(Math.max(...x)<Math.min(...y)-1e-6||Math.max(...y)<Math.min(...x)-1e-6)return false;
  }
  return true;
}
export function roadSurfaceModel(file,options){
  if(!options||typeof options!=='object'||Array.isArray(options))fail('neplatné nastavení.');
  const {name,from,slot,roadTexture,sidewalkTexture,curbTexture,width,sidewalkWidth,curbHeight,roadTileLength,roadTileWidth,sidewalkTileSize,curbTileLength,heightOffset}=options;
  if(typeof name!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(name)||/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(name))fail('název musí mít 1–80 znaků bez cesty, přípony či diakritiky.');
  for(const texture of [roadTexture,sidewalkTexture,curbTexture])if(typeof texture!=='string'||!/^maps\/[\x20-\x7e]+\.bmp$/i.test(texture)||/[\\/:*?"<>|]/.test(texture.slice(5))||texture.slice(5).length>120)fail('vyberte BMP textury z hlavní složky maps.');
  for(const [value,min,max]of [[width,.1,100],[sidewalkWidth,.1,20],[curbHeight,.01,1],[roadTileLength,.1,100],[roadTileWidth,.1,100],[sidewalkTileSize,.1,100],[curbTileLength,.1,100],[heightOffset,-100,100]])if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)fail('rozměry nebo výškový posun jsou mimo povolený rozsah.');
  if((options.mode!==undefined&&!['link','junction'].includes(options.mode))||(options.joinJunctions!==undefined&&typeof options.joinJunctions!=='boolean'))fail('neplatný režim povrchu.');
  if(options.mode==='junction')return junctionSurface(file,options);
  if(!Number.isInteger(from)||from<0||!Number.isInteger(slot)||slot<0||slot>3||!file?.crossings||!file?.nodes)fail('vyberte křižovatku a její propojení.');
  const link=roadConnections(file,from).find(link=>link.slot===slot);
  if(!link||!roadSettingsPair(file,from,slot))fail('propojení musí mít jednoznačnou zpětnou vazbu.');
  const points=[file.crossings[from],...link.nodes.map(ref=>file.nodes[ref&32767]),file.crossings[link.target]].map(record=>record.position);
  if(points.length>1024)fail('jedna ulice může mít nejvýše 1024 bodů; rozdělte trasu křižovatkou.');
  if(points.some(p=>!Array.isArray(p)||p.length!==3||!p.every(n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<=32768)))fail('neplatné souřadnice trasy.');
  const caps=[true,true],ends=[null,null];
  if(options.joinJunctions)for(const [end,index]of [[0,from],[1,link.target]]){
    if(file.crossings[index].links.filter(ref=>ref!==65535).length<3)continue;
    const plan=roadJunctionPlan(file,index,width,sidewalkWidth),leg=plan.legs.find(leg=>leg.target===(end===0?link.target:from)&&leg.nodes.length===link.nodes.length&&leg.nodes.every((ref,i)=>ref===link.nodes[end===0?i:link.nodes.length-1-i]));
    if(!leg)fail('výjezd nemá shodné napojení křižovatky.');
    points[end===0?0:points.length-1]=leg.center;caps[end]=false;ends[end]=leg;
  }
  if(!caps[0]&&!caps[1]&&points.length===2){const original=file.crossings[link.target].position.map((v,i)=>v-file.crossings[from].position[i]);if((points[1][0]-points[0][0])*original[0]+(points[1][2]-points[0][2])*original[2]<=.1*Math.hypot(original[0],original[2]))fail('napojené křižovatky se překrývají; prodlužte cestu nebo zmenšete šířku.');}
  const directions=[],lengths=[0];
  for(let i=1;i<points.length;i++){
    const a=points[i-1],b=points[i],dx=b[0]-a[0],dz=b[2]-a[2],horizontal=Math.hypot(dx,dz);
    if(horizontal<.01)fail('dva sousední body leží nad sebou nebo příliš blízko.');
    directions.push([dx/horizontal,dz/horizontal]);lengths.push(lengths.at(-1)+Math.hypot(dx,b[1]-a[1],dz));
  }
  const right=points.map((p,i)=>{
    const a=directions[Math.max(0,i-1)],b=directions[Math.min(i,directions.length-1)],sum=[a[1]+b[1],-a[0]-b[0]],size=Math.hypot(...sum);
    if(size<1e-6)fail('trasa se obrací zpět; rozdělte ji křižovatkou.');
    const unit=sum.map(n=>n/size),dot=unit[0]*b[1]-unit[1]*b[0];
    if(dot<.5)fail('příliš ostrá zatáčka; upravte body nebo vytvořte křižovatku.');
    return unit.map(n=>n/dot);
  });
  const edge=(offset,height)=>points.map((p,i)=>{
    const end=i===0?0:i===points.length-1?1:-1,leg=ends[end];
    if(leg){const local=offset*(end===0?1:-1),point=local===-width/2?leg.left:local===width/2?leg.right:local===-(width/2+sidewalkWidth)?leg.outerLeft:leg.outerRight;return [point[0],Math.fround(point[1]+heightOffset+height),point[2]];}
    return [p[0]+right[i][0]*offset,p[1]+heightOffset+height,p[2]+right[i][1]*offset].map(Math.fround);
  });
  const outer=width/2+sidewalkWidth,left=edge(-outer,0),rightEdge=edge(outer,0),footprints=[];
  for(let i=1;i<points.length;i++){
    const quad=[left[i-1],left[i],rightEdge[i],rightEdge[i-1]],d=directions[i-1];
    if([left,rightEdge].some(e=>(e[i][0]-e[i-1][0])*d[0]+(e[i][2]-e[i-1][2])*d[1]<.01)||quad.some((p,j)=>cross(p,quad[(j+1)%4],quad[(j+2)%4])>=-1e-6))fail('šířka ulice překrývá krátkou zatáčku; zmenšete šířku nebo upravte trasu.');
    footprints.push(quad);
  }
  for(let i=0;i<footprints.length;i++)for(let j=i+2;j<footprints.length;j++)if(overlap(footprints[i],footprints[j]))fail('ulice se kříží nebo její chodníky překrývají jiný úsek; rozdělte ji na křižovatky.');
  const positions=[],uv=[],faces=[{material:1,indices:[]},{material:2,indices:[]},{material:3,indices:[]}];
  const subtract=(a,b)=>a.map((v,i)=>v-b[i]),dot=(a,b)=>a.reduce((sum,v,i)=>sum+v*b[i],0),normalize=a=>{const n=Math.hypot(...a);if(n<1e-10)fail('zhroucený povrch.');return a.map(v=>v/n);};
  const vectorCross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  function quad(a,b,c,d,forward,origin,material,scale,swap=false){
    // Flatten each triangle isometrically, then unfold the second around its
    // shared diagonal. Even a sloping, non-planar miter keeps physical texel
    // density. Different street segments meet with an explicit texture seam.
    const normal=normalize(vectorCross(subtract(c,a),subtract(b,a))),across=normalize(vectorCross(normal,forward)),along=normalize(vectorCross(across,normal));
    const project=p=>[dot(subtract(p,origin),across),dot(subtract(p,origin),along)];
    const va=project(a),vb=project(b),vc=project(c),bc=vc.map((v,i)=>v-vb[i]),length=Math.hypot(...bc),unit=bc.map(v=>v/length),bd=Math.hypot(...subtract(d,b)),cd=Math.hypot(...subtract(d,c));
    const distance=(bd*bd+length*length-cd*cd)/(2*length),square=bd*bd-distance*distance;
    if(square< -1e-6)fail('neplatné rozvinutí povrchu.');
    const sign=bc[0]*(va[1]-vb[1])-bc[1]*(va[0]-vb[0])>0?-1:1,height=Math.sqrt(Math.max(0,square));
    const vd=[vb[0]+unit[0]*distance-unit[1]*height*sign,vb[1]+unit[1]*distance+unit[0]*height*sign];
    const tex=v=>{const pair=swap?[v[1],v[0]]:v;return pair.map((n,i)=>Math.fround(n/scale[i]));};
    const base=positions.length/3;positions.push(...a,...c,...b,...b,...c,...d);uv.push(...tex(va),...tex(vc),...tex(vb),...tex(vb),...tex(vc),...tex(vd));faces[material-1].indices.push(base,base+1,base+2,base+3,base+4,base+5);
  }
  function strip(a,b,material,scale,swap=false){
    for(let i=1;i<points.length;i++){
      const forward=normalize(subtract(points[i],points[i-1])),center=points[i-1].map((n,j)=>n+(j===1?heightOffset:0));
      // Each strip's first vertex anchors its transverse UV; longitudinal
      // phase follows centre-line distance, while segment offsets stay metric.
      const origin=material===1?center:a[i-1],before=uv.length;
      quad(a[i-1],b[i-1],a[i],b[i],forward,origin,material,scale,swap);
      for(let at=before;at<uv.length;at+=2){const longitudinal=swap?at:at+1;uv[longitudinal]=Math.fround(-uv[longitudinal]-lengths[i-1]/scale[swap?0:1]);if(material===1)uv[at+1]=Math.fround(uv[at+1]+width/2/roadTileWidth);}
    }
  }
  strip(edge(-width/2,0),edge(width/2,0),1,[roadTileLength,roadTileWidth],true);
  for(const side of [-1,1]){
    const inner=side*width/2,outer=side*(width/2+sidewalkWidth),a=Math.min(inner,outer),b=Math.max(inner,outer);
    strip(edge(a,curbHeight),edge(b,curbHeight),2,[sidewalkTileSize,sidewalkTileSize]);
    strip(edge(a,0),edge(a,curbHeight),3,[curbHeight,curbTileLength]);
    strip(edge(b,curbHeight),edge(b,0),3,[curbHeight,curbTileLength]);
    const lowA=edge(a,0),lowB=edge(b,0),topA=edge(a,curbHeight),topB=edge(b,curbHeight);
    for(const index of [0,points.length-1]){
      if(!caps[index===0?0:1])continue;
      const base=positions.length/3;positions.push(...lowA[index],...lowB[index],...topA[index],...topB[index]);uv.push(0,0,sidewalkWidth/curbTileLength,0,0,1,sidewalkWidth/curbTileLength,1);
      faces[2].indices.push(...(index===0?[base,base+2,base+1,base+1,base+2,base+3]:[base,base+1,base+2,base+1,base+3,base+2]));
    }
  }
  return surfaceModel(options,positions,uv,faces);
}
function surfaceModel(options,positions,uv,faces){
  const {roadTexture,sidewalkTexture,curbTexture}=options;
  for(const value of positions)if(!Number.isFinite(value)||Math.abs(value)>32768)fail('povrch přesahuje rozsah ±32768 metrů.');
  for(const face of faces)for(let i=0;i<face.indices.length;i+=3){
    const [a,b,c]=face.indices.slice(i,i+3).map(v=>positions.slice(v*3,v*3+3)),ab=b.map((v,j)=>v-a[j]),ac=c.map((v,j)=>v-a[j]);
    if(Math.hypot(ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0])<1e-8)fail('povrch obsahuje zhroucenou plochu po převodu na float32.');
  }
  const normals=geometryNormals(positions,faces).map(Math.fround);
  const material=texture=>({flags:0x00840001,ambient:[1,1,1],diffuse:[1,1,1],emission:[0,0,0],opacity:1,texture:texture.slice(5)});
  const mesh={id:1,name:'Street',type:1,visual:0,renderFlags:0,logicFlags:0x2a,culling:9,parent:0,position:[0,0,0],rotation:[1,0,0,0],scale:[1,1,1],properties:'',instance:0,lods:[{distance:0,vertices:positions.length/3,positions,normals,uv:uv.map(Math.fround),faces}]};
  return {version:29,materials:[material(roadTexture),material(sidewalkTexture),material(curbTexture)],meshes:[mesh],animated:0};
}

function junctionSurface(file,options){
  const {from,width,sidewalkWidth,heightOffset,curbHeight,roadTileLength,roadTileWidth,sidewalkTileSize,curbTileLength}=options,plan=roadJunctionPlan(file,from,width,sidewalkWidth);
  const positions=[],uv=[],faces=[{material:1,indices:[]},{material:2,indices:[]},{material:3,indices:[]}],at=(point,height=0)=>[point[0],Math.fround(point[1]+heightOffset+height),point[2]];
  function triangle(a,b,c,material,tex){
    const base=positions.length/3;positions.push(...a,...b,...c);uv.push(...tex(a),...tex(b),...tex(c));faces[material-1].indices.push(base,base+1,base+2);
  }
  function top(a,b,c,material){
    // XZ counterclockwise is downward in native Y-up coordinates.
    if(cross(a,b,c)>0)[b,c]=[c,b];
    const scale=material===1?[roadTileLength,roadTileWidth]:[sidewalkTileSize,sidewalkTileSize],tex=p=>[(p[0]-plan.center[0])/scale[0],(p[2]-plan.center[2])/scale[1]].map(Math.fround);
    triangle(at(a,material===2?curbHeight:0),at(b,material===2?curbHeight:0),at(c,material===2?curbHeight:0),material,tex);
  }
  function curb(a,b,outward){
    const lowA=at(a),lowB=at(b),highA=at(a,curbHeight),highB=at(b,curbHeight),length=Math.hypot(b[0]-a[0],b[2]-a[2]),base=positions.length/3;
    positions.push(...lowA,...lowB,...highA,...highB);uv.push(0,0,0,Math.fround(length/curbTileLength),1,0,1,Math.fround(length/curbTileLength));
    faces[2].indices.push(...(outward?[base,base+2,base+1,base+1,base+2,base+3]:[base,base+1,base+2,base+1,base+3,base+2]));
  }
  for(let i=0;i<plan.legs.length;i++){
    const a=plan.legs[i],b=plan.legs[(i+1)%plan.legs.length],corner=plan.corners[i];
    for(const [p,q]of [[a.right,a.left],[a.left,corner.inner],[corner.inner,b.right]])top(plan.center,p,q,1);
    for(const [p,q,r,s]of [[a.left,corner.inner,a.outerLeft,corner.outer],[corner.inner,b.right,corner.outer,b.outerRight]]){
      top(p,q,r,2);top(r,q,s,2);curb(p,q,false);curb(r,s,true);
    }
  }
  return surfaceModel(options,positions,uv,faces);
}
