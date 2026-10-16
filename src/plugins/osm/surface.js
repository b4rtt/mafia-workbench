import clipping from 'polygon-clipping';
import {ShapeUtils,Vector2} from 'three';

export const osmSurfaceDefaults=Object.freeze({width:6,sidewalkWidth:2,curbHeight:.15,tileSize:4,sidewalkTileSize:2,roadTexture:'maps/0OASF.BMP',sidewalkTexture:'maps/^chdnk01.bmp',curbTexture:'maps/^obrub01.bmp'});
const fail=message=>{throw Error(`OpenStreetMap · povrchy: ${message}`);};
const snap=n=>Math.round(n*1000)/1000;
// A planar street footprint is a union, rather than overlapping per-link
// meshes. This also joins OSM way boundaries, acute junctions and short links.
export function osmSurfaceModel(plan,area,options){
  if(!options||typeof options!=='object'||Array.isArray(options))fail('neplatné nastavení.');
  for(const[key,min,max]of [['width',2,20],['sidewalkWidth',.5,5],['curbHeight',.05,.4],['tileSize',.25,20],['sidewalkTileSize',.25,10]])if(typeof options[key]!=='number'||!Number.isFinite(options[key])||options[key]<min||options[key]>max)fail(`neplatný rozměr ${key}.`);
  for(const key of ['roadTexture','sidewalkTexture','curbTexture'])if(typeof options[key]!=='string'||!/^maps\/[\x20-\x7e]+\.bmp$/i.test(options[key])||/[\\/:*?"<>|]/.test(options[key].slice(5))||options[key].slice(5).length>120)fail('vyberte BMP textury z hlavní složky maps.');
  if(!plan?.flat||!Array.isArray(plan.roads)||!plan.roads.length||plan.roads.length>1024||!Array.isArray(plan.crossings)||!Number.isFinite(area?.size)||area.size<50||area.size>450)fail('neplatná rovinná síť.');
  const chains=plan.roads.map(road=>[plan.crossings[road.from]?.position,...road.positions,plan.crossings[road.to]?.position]);
  if(chains.reduce((sum,c)=>sum+c.length,0)>8192||chains.some(c=>c.length<2||c.some(p=>!Array.isArray(p)||p.length!==3||p.some(n=>!Number.isFinite(n)||Math.abs(n)>32768)||p[1]!==0)))fail('neplatné souřadnice nebo příliš velká síť.');
  const half=area.size/2,box=[[[-half,-half],[half,-half],[half,half],[-half,half],[-half,-half]]];
  function footprint(radius){
    const polygons=[],centers=new Set();
    for(const chain of chains){
      for(let i=1;i<chain.length;i++){
        const a=chain[i-1],b=chain[i],dx=b[0]-a[0],dz=b[2]-a[2],length=Math.hypot(dx,dz);if(length<.01)fail('příliš krátký úsek.');
        const x=dz/length*radius,z=-dx/length*radius;
        polygons.push([[[a[0]+x,a[2]+z],[b[0]+x,b[2]+z],[b[0]-x,b[2]-z],[a[0]-x,a[2]-z]].map(p=>p.map(snap))]);
      }
      for(const p of chain){const key=`${snap(p[0])}/${snap(p[2])}`;if(centers.has(key))continue;centers.add(key);polygons.push([Array.from({length:24},(_,i)=>[snap(p[0]+Math.cos(i*Math.PI/12)*radius),snap(p[2]+Math.sin(i*Math.PI/12)*radius)])]);}
    }
    const merged=clipping.intersection(clipping.union(polygons),box);
    // Quantize before triangulation: native float32 must retain identical
    // boundaries for the road, raised sidewalk and collision triangles.
    return clipping.union(merged.map(poly=>poly.map(ring=>ring.map(p=>p.map(snap)))));
  }
  let road,outer,sidewalk;
  try{road=footprint(options.width/2);outer=footprint(options.width/2+options.sidewalkWidth);sidewalk=clipping.difference(outer,road);}catch(error){if(error.message.startsWith('OpenStreetMap'))throw error;fail('půdorysy nelze spojit; zmenšete oblast nebo upravte výběr.');}
  if(!road.length||!sidewalk.length)fail('ve výběru nevznikl úplný povrch ulice.');
  const meshes=[],base=.05,top=Math.fround(base+options.curbHeight),materials=[options.roadTexture,options.sidewalkTexture,options.curbTexture].map(path=>({flags:0x00840001,ambient:[1,1,1],diffuse:[1,1,1],emission:[0,0,0],opacity:1,texture:path.slice(5)}));
  let positions=[],normals=[],uv=[],faces=[1,2,3].map(material=>({material,indices:[]})),triangles=0;
  function flush(){if(!positions.length)return;meshes.push({id:meshes.length+1,name:`OSM_${meshes.length+1}`,type:1,visual:0,renderFlags:0,logicFlags:0x2a,culling:9,parent:0,position:[0,0,0],rotation:[1,0,0,0],scale:[1,1,1],properties:'',instance:0,lods:[{distance:0,vertices:positions.length/3,positions,normals,uv,faces}]});positions=[];normals=[];uv=[];faces=[1,2,3].map(material=>({material,indices:[]}));}
  function triangle(points,tex,material){
    points=points.map(p=>p.map(Math.fround));const[a,b,c]=points,ab=b.map((v,i)=>v-a[i]),ac=c.map((v,i)=>v-a[i]),n=[ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0]],length=Math.hypot(...n);
    // Boolean intersections can create collinear slivers. Once their native
    // float32 area is zero they have no surface or collision to serialize.
    if(length<1e-8)return;
    if(++triangles>60000)fail('povrch je příliš podrobný; zmenšete oblast.');
    if(positions.length/3+3>60000)flush();const at=positions.length/3;positions.push(...points.flat());normals.push(...Array.from({length:3},()=>n.map(v=>Math.fround(v/length))).flat());uv.push(...tex.flat().map(Math.fround));faces[material-1].indices.push(at,at+1,at+2);
  }
  function surface(polygons,height,material,tile){
    for(const polygon of polygons){
      const rings=polygon.map(ring=>ring.slice(0,-1).map(p=>new Vector2(...p))),vertices=rings.flat(),indices=ShapeUtils.triangulateShape(rings[0],rings.slice(1));
      for(let ids of indices){let points=ids.map(i=>vertices[i]);if((points[1].x-points[0].x)*(points[2].y-points[0].y)-(points[1].y-points[0].y)*(points[2].x-points[0].x)>0)points=[points[0],points[2],points[1]];triangle(points.map(p=>[p.x,height,p.y]),points.map(p=>[p.x/tile,p.y/tile]),material);}
    }
  }
  surface(road,base,1,options.tileSize);surface(sidewalk,top,2,options.sidewalkTileSize);
  // Output rings keep filled area to the left; both outer curbs and the
  // curb against the roadway face away from the raised pavement.
  for(const polygon of sidewalk)for(const ring of polygon){let distance=0;for(let i=1;i<ring.length;i++){
    const a=ring[i-1],b=ring[i],length=Math.hypot(b[0]-a[0],b[1]-a[1]);if(length<1e-6)continue;
    const points=[[a[0],base,a[1]],[b[0],base,b[1]],[a[0],top,a[1]],[b[0],top,b[1]]],tex=[[distance,0],[distance+length,0],[distance,1],[distance+length,1]];
    for(const ids of [[0,2,1],[1,2,3]])triangle(ids.map(i=>points[i]),ids.map(i=>tex[i]),3);distance+=length;
  }}
  flush();return {model:{version:29,materials,meshes,animated:0},footprints:{road,sidewalk},triangles};
}
