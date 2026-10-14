import {Vector3} from 'three';
import {ConvexHull} from 'three/addons/math/ConvexHull.js';
import {sectorCoordinates,sectorVolume} from './sector-geometry.js';

// Rebuild only on explicit request. Keep every input point and its index,
// including duplicates/interior points that the surface does not use.
export function sectorConvexHull(values){
  const positions=sectorCoordinates(values,4,1024),points=[],ids=new Map(),unique=new Set();
  for(let i=0;i<positions.length;i+=3){const p=positions.slice(i,i+3),key=p.join('/');if(unique.has(key))continue;unique.add(key);const vector=new Vector3(...p);ids.set(vector,i/3);points.push(vector);}
  const fail=()=>{throw new Error('Objem potřebuje alespoň čtyři různé body, které neleží v jedné rovině.');};
  if(points.length<4)fail();
  const origin=points[0],epsilon=Math.max(1e-5,...positions.map(v=>Math.abs(v)*2**-23*4));let line,normal,distance=0;
  for(const point of points){const delta=point.clone().sub(origin);if(delta.lengthSq()>distance){line=delta;distance=delta.lengthSq();}}
  if(!line||line.length()<=epsilon)fail();line.normalize();distance=0;
  for(const point of points){const cross=point.clone().sub(origin).cross(line);if(cross.lengthSq()>distance){normal=cross;distance=cross.lengthSq();}}
  if(!normal||normal.length()<=epsilon)fail();normal.normalize();if(!points.some(point=>Math.abs(point.clone().sub(origin).dot(normal))>epsilon))fail();
  const hull=new ConvexHull().setFromPoints(points),indices=[];
  for(const face of hull.faces){const corners=[];let edge=face.edge;do{corners.push(ids.get(edge.head().point));edge=edge.next;}while(edge!==face.edge);if(corners.length!==3)throw new Error('Konvexní objem nemá trojúhelníkové plochy.');indices.push(corners[0],corners[2],corners[1]);}
  return sectorVolume(positions,indices);
}

export function removeSectorVertex(positions,indices,index){
  sectorCoordinates(positions,4,65536);if(positions.length/3<=4||!Number.isInteger(index)||index<0||index>=positions.length/3)throw new Error('Objem potřebuje nejméně čtyři vrcholy; vyberte existující vrchol.');
  if(!Array.isArray(indices)||indices.length%3||!Array.from(indices).every(i=>Number.isInteger(i)&&i>=0&&i<positions.length/3))throw new Error('Neplatné indexy objemu.');
  const next=[...positions];next.splice(index*3,3);const triangles=[];for(let i=0;i<indices.length;i+=3){const triangle=indices.slice(i,i+3);if(!triangle.includes(index))triangles.push(...triangle.map(id=>id>index?id-1:id));}return {positions:next,indices:triangles};
}
