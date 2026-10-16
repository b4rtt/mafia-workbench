import clipping from 'polygon-clipping';
import {ShapeUtils,Vector2} from 'three';
import {osmSurfaceModel} from './surface.js';
import {osmElevationGrid,elevationCoordinate} from './elevation.js';

const fail=message=>{throw Error('OpenStreetMap · terén: '+message);};
const validTexture=p=>typeof p==='string'&&/^maps\/[\x20-\x7e]+\.bmp$/i.test(p)&&!/[\\/:*?"<>|]/.test(p.slice(5))&&p.slice(5).length<=120;

// Internal generator foundation. The ordinary mission importer must not use
// it until placement, native networks and source publication share this grid.
export function osmTerrainSurface(plan,area,options,settings){
  const field=osmElevationGrid(settings,area);
  if(!validTexture(settings.groundTexture)||!Number.isFinite(settings.groundTileSize)||settings.groundTileSize<.25||settings.groundTileSize>20)fail('vyberte BMP podkladu a opakování 0,25–20 m.');
  const flat=osmSurfaceModel(plan,area,options),meshes=[],unique=new Set(),counts=[0,0,0,0];let positions=[],normals=[],uv=[],faces=[1,2,3,4].map(material=>({material,indices:[]})),triangles=0;
  // The planar generator rounds its clipped rings to millimetres. On a
  // fractional-size area that can move an edge just outside the native grid.
  // Restore rounded boundary planes before clipping: inward rounding must
  // not leave a thin unpaved strip under a native road endpoint either.
  const low=Math.round(-area.size/2*1000)/1000,high=Math.round(area.size/2*1000)/1000,restore=(n,axis)=>n===low?axis[0]:n===high?axis.at(-1):n;
  const bounds=[[[field.x[0],field.z[0]],[field.x.at(-1),field.z[0]],[field.x.at(-1),field.z.at(-1)],[field.x[0],field.z.at(-1)],[field.x[0],field.z[0]]]],footprints={};
  for(const kind of ['road','sidewalk']){
    const restored=flat.footprints[kind].map(p=>p.map(r=>r.map(([x,z])=>[restore(x,field.x),restore(z,field.z)])));
    try{footprints[kind]=clipping.intersection(restored,bounds).map(p=>p.map(r=>r.map(v=>v.map(elevationCoordinate))));}catch{fail('okraj povrchu nelze oříznout k výškovému podkladu.');}
  }
  function flush(){
    if(!positions.length)return;
    meshes.push({...flat.model.meshes[0],id:meshes.length+1,name:`OSM_TERRAIN_${meshes.length+1}`,lods:[{distance:0,vertices:positions.length/3,positions,normals,uv,faces}]});
    positions=[];normals=[];uv=[];faces=[1,2,3,4].map(material=>({material,indices:[]}));
  }
  function triangle(input,tex,material){
    const p=input.map(([x,y,z])=>{x=elevationCoordinate(x);z=elevationCoordinate(z);return [x,Math.fround(field.heightAt(x,z)+y),z];}),[a,b,c]=p,ab=b.map((n,i)=>n-a[i]),ac=c.map((n,i)=>n-a[i]),normal=[ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0]],length=Math.hypot(...normal);
    if(length<1e-8)return;
    if(++triangles>60000)fail('přes 60 000 trojúhelníků; zmenšete oblast nebo hustotu výškového rastru.');
    for(const point of p)unique.add(point.join('/'));if(unique.size>60000)fail('přes 60 000 kolizních vrcholů; ponechte prostor i pro ostatní objekty.');
    if(positions.length/3+3>60000)flush();const at=positions.length/3;
    positions.push(...p.flat());normals.push(...[0,1,2].flatMap(()=>normal.map(n=>Math.fround(n/length))));uv.push(...tex.flat().map(Math.fround));faces[material-1].indices.push(at,at+1,at+2);counts[material-1]++;
  }
  const layers=[[footprints.road,.05,1,options.tileSize],[footprints.sidewalk,Math.fround(.05+options.curbHeight),2,options.sidewalkTileSize]];
  for(let j=0;j<field.rows;j++)for(let i=0;i<field.columns;i++){
    const a=[field.x[i],field.z[j]],b=[field.x[i+1],field.z[j]],c=[field.x[i],field.z[j+1]],d=[field.x[i+1],field.z[j+1]];
    for(const t of [[a,c,b],[b,c,d]]){
      // Continuous ground under the raised street layers; no reliance on the
      // template's old flat floor when the city climbs or descends.
      triangle(t.map(([x,z])=>[x,0,z]),t.map(([x,z])=>[x/settings.groundTileSize,z/settings.groundTileSize]),4);
      for(const [polygons,y,material,tile]of layers){
        let clipped;try{clipped=clipping.intersection(polygons,[[...t,t[0]]]);}catch{fail('povrch nelze bezpečně rozdělit podle výškového rastru.');}
        for(const polygon of clipped){
          const rings=polygon.map(r=>r.slice(0,-1).map(p=>new Vector2(...p))),vertices=rings.flat();
          for(const ids of ShapeUtils.triangulateShape(rings[0],rings.slice(1))){let p=ids.map(i=>vertices[i]);if((p[1].x-p[0].x)*(p[2].y-p[0].y)-(p[1].y-p[0].y)*(p[2].x-p[0].x)>0)p=[p[0],p[2],p[1]];triangle(p.map(v=>[v.x,y,v.y]),p.map(v=>[v.x/tile,v.y/tile]),material);}
        }
      }
    }
  }
  const base=.05,top=Math.fround(base+options.curbHeight);
  for(const polygon of footprints.sidewalk)for(const ring of polygon){let distance=0;for(let i=1;i<ring.length;i++){
    const a=ring[i-1],b=ring[i],length=Math.hypot(b[0]-a[0],b[1]-a[1]),cuts=field.splitEdge(a,b);
    for(let k=1;k<cuts.length;k++){
      const lo=cuts[k-1],hi=cuts[k],p=[[lo.point[0],base,lo.point[1]],[hi.point[0],base,hi.point[1]],[lo.point[0],top,lo.point[1]],[hi.point[0],top,hi.point[1]]],tex=[[distance+length*lo.t,0],[distance+length*hi.t,0],[distance+length*lo.t,1],[distance+length*hi.t,1]];
      for(const ids of [[0,2,1],[1,2,3]])triangle(ids.map(i=>p[i]),ids.map(i=>tex[i]),3);
    }distance+=length;
  }}
  flush();return {...flat,footprints,levels:Object.freeze({road:base,sidewalk:top,ground:0}),model:{...flat.model,materials:[...flat.model.materials,{...flat.model.materials[0],texture:settings.groundTexture.slice(5)}],meshes},triangles,elevation:field,counts:{road:counts[0],sidewalk:counts[1],curb:counts[2],ground:counts[3],vertices:unique.size}};
}
