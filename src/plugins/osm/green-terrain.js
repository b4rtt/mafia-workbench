import clipping from 'polygon-clipping';
import {ShapeUtils,Vector2} from 'three';
import {elevationCoordinate} from './elevation.js';

const fail=m=>{throw Error('OpenStreetMap · výšková zeleň: '+m);};

// Grass and paving share the terrain's exact triangular planes. A separate
// flat mesh or bilinear sampler would leave gaps above ridges and saddles.
export function osmGreenTerrainMeshes(item,field){
  if(field?.version!==1||typeof field.heightAt!=='function'||!Array.isArray(field.x)||!Array.isArray(field.z))fail('chybí společný výškový podklad.');
  const meshes=[],unique=new Set();let positions=[],normals=[],uv=[],faces=[1,2].map(material=>({material,indices:[]})),triangles=0;
  function flush(){
    if(!positions.length)return;
    meshes.push({id:meshes.length+1,name:`OSM_GREEN_${meshes.length+1}`,type:1,visual:0,renderFlags:0,logicFlags:0x2a,culling:9,parent:0,position:[0,0,0],rotation:[1,0,0,0],scale:[1,1,1],lods:[{distance:0,vertices:positions.length/3,positions,normals,uv,faces}]});
    positions=[];normals=[];uv=[];faces=[1,2].map(material=>({material,indices:[]}));
  }
  for(let j=0;j<field.rows;j++)for(let i=0;i<field.columns;i++){
    const a=[field.x[i],field.z[j]],b=[field.x[i+1],field.z[j]],c=[field.x[i],field.z[j+1]],d=[field.x[i+1],field.z[j+1]];
    for(const t of [[a,c,b],[b,c,d]])for(const [polygons,material,tile]of [[item.grass,1,item.tileSize],[item.paths,2,item.pathTileSize]]){
      let clipped;try{clipped=clipping.intersection(polygons,[[...t,t[0]]]);}catch{fail('plochu nelze rozdělit podle výškového rastru.');}
      for(const polygon of clipped){
        const rings=polygon.map(r=>r.slice(0,-1).map(p=>new Vector2(...p))),vertices=rings.flat();
        for(const ids of ShapeUtils.triangulateShape(rings[0],rings.slice(1))){
          let p=ids.map(n=>{const x=elevationCoordinate(vertices[n].x),z=elevationCoordinate(vertices[n].y);return [x,Math.fround(field.heightAt(x,z)+item.height),z];});
          let ab=p[1].map((n,k)=>n-p[0][k]),ac=p[2].map((n,k)=>n-p[0][k]),normal=[ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0]],length=Math.hypot(...normal);
          if(Math.abs(normal[1])<1e-8)continue;
          if(normal[1]<0){p=[p[0],p[2],p[1]];normal=normal.map(n=>-n);}
          if(++triangles>60000)fail('plocha přesahuje 60 000 trojúhelníků; zmenšete oblast nebo hustotu rastru.');
          for(const v of p)unique.add(v.join('/'));if(unique.size>60000)fail('plocha přesahuje bezpečný limit kolizních vrcholů.');
          if(positions.length/3+3>60000)flush();const at=positions.length/3;
          positions.push(...p.flat());normals.push(...[0,1,2].flatMap(()=>normal.map(n=>Math.fround(n/length))));uv.push(...p.flatMap(v=>[Math.fround(v[0]/tile),Math.fround(v[2]/tile)]));faces[material-1].indices.push(at,at+1,at+2);
        }
      }
    }
  }
  flush();if(!meshes.length)fail('plocha nemá platné trojúhelníky.');return meshes;
}
