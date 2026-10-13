import { Matrix4, Vector3 } from 'three';

export const collisionLabels={triangles:'Trojúhelníky',aabbs:'Boxy AABB',xtobbs:'Otočené boxy',obbs:'Kolizní plochy OBB',spheres:'Koule',cylinders:'Svislé válce'};
export function collisionBounds(points){return {min:[0,1,2].map(i=>Math.min(...points.map(p=>p[i]))),max:[0,1,2].map(i=>Math.max(...points.map(p=>p[i])))};}
export function collisionCorners(min,max){return Array.from({length:8},(_,i)=>[0,1,2].map(axis=>(i&(1<<axis)?max:min)[axis]));}
export function collisionTransform(points,matrix){const m=new Matrix4().fromArray(matrix);return points.map(p=>new Vector3(...p).applyMatrix4(m).toArray());}

// Native coordinates. The viewport alone reflects Z. Neither OBB's stored Y
// extents nor the display height of a cylinder become a physical volume.
export function collisionShapeGeometry(array,record,trianglePoints=record.points){
  if(array==='triangles')return {...collisionBounds(trianglePoints),points:trianglePoints,shape:'triangle'};
  if(array==='aabbs')return {min:record.min,max:record.max,points:collisionCorners(record.min,record.max),shape:'box'};
  if(array==='xtobbs'){const points=collisionTransform(collisionCorners(record.extentMin,record.extentMax),record.matrix);return {...collisionBounds(points),points,shape:'oriented-box'};}
  if(array==='obbs'){const a=record.extentMin,b=record.extentMax,points=collisionTransform([[a[0],0,a[2]],[b[0],0,a[2]],[b[0],0,b[2]],[a[0],0,b[2]]],record.matrix);return {...collisionBounds(points),points,shape:'rectangle'};}
  if(array==='spheres')return {min:record.center.map(n=>n-record.radius),max:record.center.map(n=>n+record.radius),shape:'sphere'};
  if(array==='cylinders')return {min:[record.center[0]-record.radius,-Infinity,record.center[1]-record.radius],max:[record.center[0]+record.radius,Infinity,record.center[1]+record.radius],shape:'vertical-cylinder',unboundedY:true};
  throw new Error('KLZ: neznámé pole primitiv.');
}

export function collisionTransformPatch(record,delta){
  const matrix=delta instanceof Matrix4?delta:new Matrix4().fromArray(delta);
  if(record.array==='triangles')return {points:collisionTransform(record.points,matrix.toArray())};
  if(record.array==='aabbs')return collisionBounds(collisionTransform(collisionCorners(record.min,record.max),matrix.toArray()));
  if(record.array==='xtobbs'||record.array==='obbs')return {matrix:matrix.clone().multiply(new Matrix4().fromArray(record.matrix)).toArray()};
  if(record.array==='spheres')return {center:new Vector3(...record.center).applyMatrix4(matrix).toArray()};
  if(record.array==='cylinders'){const point=new Vector3(record.center[0],0,record.center[1]).applyMatrix4(matrix);return {center:[point.x,point.z]};}
  throw new Error('KLZ: neznámý kolizní tvar.');
}
