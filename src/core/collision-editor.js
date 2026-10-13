import { Matrix4, Vector3 } from 'three';
import { parseCollision } from './collision.js';
import { collisionFace, collisionTriangleVertices } from './collision-surfaces.js';

const fail=message=>{throw new Error(`KLZ: ${message}`);};
const pad=n=>(4-n%4)%4;
const own=(object,key)=>Object.hasOwn(object,key);
const fields={triangles:['points','reverse','material','flags'],aabbs:['min','max','link','material','flags'],xtobbs:['extentMin','extentMax','matrix','link','material','flags'],obbs:['extentMin','extentMax','matrix','link','material','flags'],spheres:['center','radius','link','material','flags'],cylinders:['center','radius','link','material','flags']};
const finite=n=>typeof n==='number'&&Number.isFinite(Math.fround(n));
function vector(value,length,label){if(!Array.isArray(value)||value.length!==length||value.some(n=>!finite(n)))fail(`neplatné ${label}.`);return value.map(Math.fround);}
function byte(value,label){if(!Number.isInteger(value)||value<0||value>255)fail(`neplatné ${label}.`);return value;}
function bounds(points){return {min:[0,1,2].map(i=>Math.min(...points.map(p=>p[i]))),max:[0,1,2].map(i=>Math.max(...points.map(p=>p[i])))};}
function corners(min,max){return Array.from({length:8},(_,i)=>[0,1,2].map(axis=>(i&(1<<axis)?max:min)[axis]));}
function transform(points,matrix){const m=new Matrix4().fromArray(matrix);return points.map(p=>new Vector3(...p).applyMatrix4(m).toArray());}

// 0x83 is a rectangle at local Y=0, not a solid oriented box. 0x84 stores
// only X/Z and radius, and its native line/sphere tests ignore Y entirely.
export function collisionRecordGeometry(parsed,array,record,resolveFrame){
  if(array==='triangles'){const points=collisionTriangleVertices(parsed,record,resolveFrame);return {...bounds(points),points,shape:'triangle'};}
  if(array==='aabbs')return {min:record.min,max:record.max,points:corners(record.min,record.max),shape:'box'};
  if(array==='xtobbs'){const points=transform(corners(record.extentMin,record.extentMax),record.matrix);return {...bounds(points),points,shape:'oriented-box'};}
  if(array==='obbs'){const a=record.extentMin,b=record.extentMax,points=transform([[a[0],0,a[2]],[b[0],0,a[2]],[b[0],0,b[2]],[a[0],0,b[2]]],record.matrix);return {...bounds(points),points,shape:'rectangle'};}
  if(array==='spheres')return {min:record.center.map(n=>n-record.radius),max:record.center.map(n=>n+record.radius),shape:'sphere'};
  if(array==='cylinders')return {min:[record.center[0]-record.radius,-Infinity,record.center[1]-record.radius],max:[record.center[0]+record.radius,Infinity,record.center[1]+record.radius],shape:'vertical-cylinder',unboundedY:true};
  fail('neznámé pole primitiv.');
}

function primitiveRaw(parsed,array,changes,existing,allocatePoints){
  const spec=parsed.primitives[array];
  if(!changes||typeof changes!=='object'||Array.isArray(changes)||Object.entries(changes).some(([k,v])=>!fields[array].includes(k)||v===undefined||v===null))fail('neplatná vlastnost kolize.');
  const raw=existing?Buffer.from(existing.raw):Buffer.alloc(spec.size);if(!existing)raw[0]=spec.type;
  for(const [field,offset] of [['material',3],['flags',2]])if(own(changes,field)||!existing)raw[offset]=byte(changes[field]??0,field);
  if(array==='triangles'){
    if(!existing&&!own(changes,'points'))fail('chybí vrcholy trojúhelníku.');
    if(own(changes,'reverse')&&typeof changes.reverse!=='boolean')fail('neplatné obrácení povrchu.');
    // Metadata-only edits keep native frame links, plane, sort bits and indices.
    if(own(changes,'points')||own(changes,'reverse')){
      const points=own(changes,'points')?changes.points:collisionTriangleVertices(parsed,existing,allocatePoints.resolveFrame);
      if(!Array.isArray(points)||points.length!==3)fail('trojúhelník musí mít tři vrcholy.');
      const xyz=points.map(p=>vector(p,3,'vrcholy trojúhelníku'));
      // Existing vertices are X-sorted. The sort parity encodes their winding;
      // preserve it in this input order, even after a rotation over 90 degrees.
      const oldReverse=Boolean(existing?.sort&1),reverse=oldReverse!==Boolean(changes.reverse);
      const face=collisionFace(xyz.flat(),[0,1,2],raw[3],reverse),indices=allocatePoints(xyz,existing);
      for(let i=0;i<3;i++)face.raw.writeUInt16LE(indices[face.raw.readUInt16LE(4+i*4)],4+i*4);
      face.raw[2]=raw[2];return {raw:face.raw,geometry:face,spatial:true};
    }
    return {raw,spatial:false};
  }
  const link=changes.link??existing?.link;
  if(!Number.isInteger(link)||link<0||link>=parsed.links.length)fail('vyberte existující odkaz na frame.');raw.writeUInt32LE(link,4);
  // No link guessing or automatic new frame names: missing frame names can
  // become null runtime pointers. The project layer supplies known bindings.
  const get=field=>changes[field]??existing?.[field],write=(values,offset)=>values.forEach((n,i)=>raw.writeFloatLE(n,offset+i*4));
  const spatial=!existing||Object.keys(changes).some(k=>!['material','flags','link'].includes(k));
  if(!spatial)return {raw,spatial:false};
  let record;
  if(array==='aabbs'){
    const min=vector(get('min'),3,'minimum boxu'),max=vector(get('max'),3,'maximum boxu');if(min.some((n,i)=>n>=max[i]))fail('box musí mít kladné rozměry.');write(min,8);write(max,20);record={min,max};
  }else if(array==='xtobbs'||array==='obbs'){
    const extentMin=vector(get('extentMin'),3,'místní minimum'),extentMax=vector(get('extentMax'),3,'místní maximum'),matrix=vector(get('matrix'),16,'matice');
    if(extentMin.some((n,i)=>n>extentMax[i]||(array==='xtobbs'||i!==1)&&n===extentMax[i]))fail('neplatné místní rozměry.');
    if(matrix[3]!==0||matrix[7]!==0||matrix[11]!==0||matrix[15]!==1)fail('matice musí být afinní.');
    const m=new Matrix4().fromArray(matrix),det=m.determinant();if(!Number.isFinite(det)||Math.abs(det)<1e-12)fail('matice nemá bezpečnou inverzi.');
    const inverse=vector(m.clone().invert().toArray(),16,'inverzní matice'),base=array==='xtobbs'?32:8;
    write(extentMin,base);write(extentMax,base+12);write(matrix,base+24);write(inverse,base+88);record={extentMin,extentMax,matrix};
    if(array==='xtobbs'){const world=bounds(transform(corners(extentMin,extentMax),matrix));write(vector(world.min,3,'světové minimum'),8);write(vector(world.max,3,'světové maximum'),20);}
  }else{
    const center=vector(get('center'),array==='spheres'?3:2,'střed'),radius=Math.fround(get('radius'));
    if(!finite(get('radius'))||radius<=0)fail('poloměr musí být kladný.');write(center,8);raw.writeFloatLE(radius,array==='spheres'?20:16);record={center,radius};
  }
  const geometry=collisionRecordGeometry(parsed,array,record);
  if([...geometry.min,...geometry.max].some((n,i)=>!Number.isFinite(Math.fround(n))&&!(array==='cylinders'&&i%3===1)))fail('kolize přesahuje float32.');
  if(['aabbs','xtobbs','spheres','cylinders'].includes(array)&&geometry.min.some((n,i)=>!(array==='cylinders'&&i===1)&&Math.fround(n)>=Math.fround(geometry.max[i])))fail('kolize je menší než přesnost float32.');
  return {raw,geometry,spatial:true};
}

// General original-collision writer. Edits keep array positions, deletions
// remap relative offsets, and only spatially changed primitives are reindexed.
// Unchanged cell headers, padding, link gaps, arrays, separators and tail are
// preserved. The caller receives index maps for the ownership/history layer.
export function editCollision(source,operations,options={}){
  const parsed=parseCollision(source);
  if(!Array.isArray(operations)||operations.length>65536)fail('neplatný seznam změn.');
  if(!operations.length)return {bytes:Buffer.from(source),mappings:Object.fromEntries(Object.entries(parsed.primitives).map(([name,array])=>[name,array.records.map(r=>r.index)])),added:[]};
  const plans=new Map(),additions=[],touched=new Set();
  for(const operation of operations){
    if(!operation||!['edit','add','delete'].includes(operation.kind)||!own(fields,operation.array))fail('neplatná operace kolize.');
    const array=parsed.primitives[operation.array],id=`${operation.array}:${operation.index}`;
    if(operation.kind==='add')additions.push(operation);
    else{
      if(!Number.isInteger(operation.index)||operation.index<0||operation.index>=array.count||touched.has(id))fail('neplatný nebo opakovaný výběr kolize.');
      touched.add(id);plans.set(id,operation);
    }
  }
  const vertexBlocks=[],vertexBytes=Buffer.from(parsed.extraVertices),usage=new Map();let vertexCount=parsed.vertexCount;
  for(const triangle of parsed.primitives.triangles.records)if(triangle.vertices[0].link===0x7fff)for(const {index} of triangle.vertices)usage.set(index,(usage.get(index)??0)+1);
  const allocatePoints=(points,existing)=>{
    const indices=existing?.vertices.map(v=>v.index),reuse=existing?.vertices[0].link===0x7fff&&new Set(indices).size===3&&indices.every(i=>usage.get(i)===1);
    if(reuse){points.forEach((p,i)=>p.forEach((n,axis)=>vertexBytes.writeFloatLE(n,indices[i]*12+axis*4)));return indices;}
    if(vertexCount+3>65536)fail('překročen limit 65 536 světových vrcholů.');
    const block=Buffer.alloc(36);points.flat().forEach((n,i)=>block.writeFloatLE(n,i*4));vertexBlocks.push(block);const result=[vertexCount,vertexCount+1,vertexCount+2];vertexCount+=3;return result;
  };
  allocatePoints.resolveFrame=options.resolveFrame;
  const mappings={},records={},spatial=[],addedIds=[];
  for(const [name,array] of Object.entries(parsed.primitives)){
    mappings[name]=[];records[name]=[];
    for(const original of array.records){
      const operation=plans.get(`${name}:${original.index}`);if(operation?.kind==='delete'){mappings[name].push(null);continue;}
      const next=operation?primitiveRaw(parsed,name,operation.changes,original,allocatePoints):{raw:original.raw,spatial:false};
      const index=records[name].length;mappings[name].push(index);records[name].push({...next,index});
      if(next.spatial)spatial.push({...next,array:name,type:array.type,index});
    }
    for(const operation of additions.filter(o=>o.array===name)){
      const next=primitiveRaw(parsed,name,operation.changes,null,allocatePoints),index=records[name].length;records[name].push({...next,index});spatial.push({...next,array:name,type:array.type,index});addedIds.push({array:name,index});
    }
    if((records[name].length-1)*array.size>0xffffff)fail('pole přesahuje 24bitové offsety buněk.');
  }
  const {grid}=parsed;let minX=grid.minX,minZ=grid.minZ,maxX=grid.maxX,maxZ=grid.maxZ;
  for(const {geometry:g} of spatial){minX=Math.min(minX,g.min[0]);minZ=Math.min(minZ,g.min[2]);maxX=Math.max(maxX,g.max[0]);maxZ=Math.max(maxZ,g.max[2]);}
  const left=Math.ceil((grid.minX-minX)/grid.cellWidth),bottom=Math.ceil((grid.minZ-minZ)/grid.cellLength),right=Math.ceil((maxX-grid.maxX)/grid.cellWidth),top=Math.ceil((maxZ-grid.maxZ)/grid.cellLength),width=grid.width+left+right,length=grid.length+bottom+top;
  if(!Number.isSafeInteger(width*length)||width*length>1000000)fail('rozšířená mřížka je příliš velká.');
  const extend=(axis,before,after,step)=>[...Array.from({length:before},(_,i)=>Math.fround(axis[0]-(before-i)*step)),...axis,...Array.from({length:after},(_,i)=>Math.fround(axis.at(-1)+(i+1)*step))];
  const x=extend(grid.x,left,right,grid.cellWidth),z=extend(grid.z,bottom,top,grid.cellLength);
  if([x,z].some(axis=>axis.some((v,i)=>!Number.isFinite(v)||i>0&&v<=axis[i-1])))fail('mřížka přesahuje přesnost float32.');
  const lower=(axis,value,upper=false)=>{let lo=0,hi=axis.length;while(lo<hi){const mid=(lo+hi)>>>1;if(axis[mid]<value||upper&&axis[mid]===value)lo=mid+1;else hi=mid;}return lo;};
  const addedByCell=new Map(),changedSpatial=new Set(spatial.map(r=>`${r.array}:${r.index}`));let referenceCount=0;
  for(const r of spatial){
    const g=r.geometry,firstX=Math.max(0,lower(x,g.min[0])-1),lastX=Math.min(width-1,lower(x,g.max[0],true)-1),firstZ=Math.max(0,lower(z,g.min[2])-1),lastZ=Math.min(length-1,lower(z,g.max[2],true)-1);
    referenceCount+=(lastX-firstX+1)*(lastZ-firstZ+1);if(referenceCount>10000000)fail('příliš mnoho nových vazeb buněk.');
    for(let row=firstZ;row<=lastZ;row++)for(let col=firstX;col<=lastX;col++){const cell=row*width+col,list=addedByCell.get(cell)??[];list.push(r);addedByCell.set(cell,list);}
  }
  const byType=new Map(Object.entries(parsed.primitives).map(([name,spec])=>[spec.type,{name,...spec}])),minimums=new Map(),originalTriangles=new Map(mappings.triangles.map((index,original)=>[index,parsed.primitives.triangles.records[original]]));
  const minimum=index=>{
    if(!minimums.has(index)){
      const record=records.triangles[index],original=originalTriangles.get(index);
      minimums.set(index,record.geometry?.min[0]??collisionTriangleVertices(parsed,original,options.resolveFrame)[0][0]);
    }return minimums.get(index);
  };
  // Preserve per-cell flags for moved records whenever that cell already had
  // a reference to them; newly covered cells start with the native default 0.
  const cells=[];
  for(let row=0;row<length;row++)for(let col=0;col<width;col++){
    const old=col>=left&&col<left+grid.width&&row>=bottom&&row<bottom+grid.length?parsed.cells[(row-bottom)*grid.width+col-left]:null,added=addedByCell.get(row*width+col)??[],flags=new Map();
    const refs=[];
    for(const ref of old?.references??[]){const name=byType.get(ref.type).name,index=mappings[name][ref.index];if(index===null)continue;flags.set(`${name}:${index}`,ref.flag);if(!changedSpatial.has(`${name}:${index}`))refs.push({...ref,index});}
    for(const r of added)refs.push({type:r.type,index:r.index,flag:flags.get(`${r.array}:${r.index}`)??0});
    if(added.some(r=>r.type===0)){
      const volumes=refs.filter(r=>r.type!==0),triangles=refs.filter(r=>r.type===0).sort((a,b)=>minimum(a.index)-minimum(b.index));refs.splice(0,refs.length,...volumes,...triangles);
    }else if(added.length){const volumes=refs.filter(r=>r.type!==0),triangles=refs.filter(r=>r.type===0);refs.splice(0,refs.length,...volumes,...triangles);}
    const same=old&&refs.length===old.references.length&&refs.every((r,i)=>r.type===old.references[i].type&&r.index===old.references[i].index&&r.flag===old.references[i].flag);
    let height=old?.header.readFloatLE(12)??0;
    if(added.length){if(old&&!Number.isFinite(height))fail('neplatná maximální výška buňky.');height=added.reduce((h,r)=>Math.max(h,r.geometry.unboundedY?3.4028234663852886e38:r.geometry.max[1]),height);}
    if(same&&(!added.length||height===old.header.readFloatLE(12))){cells.push(old.raw);continue;}
    const count=refs.length,raw=Buffer.alloc(16+count*5+pad(count));if(old)old.header.copy(raw);raw.writeUInt32LE(count);if(!old||added.length)raw.writeFloatLE(height,12);
    refs.forEach((r,i)=>{raw.writeUInt32LE((r.type*0x1000000+r.index*byType.get(r.type).size)>>>0,16+i*4);raw[16+count*4+i]=r.flag;});
    if(old&&count===old.references.length)old.raw.subarray(16+count*5).copy(raw,16+count*5);cells.push(raw);
  }
  const gridRaw=Buffer.from(grid.raw);if(left)gridRaw.writeFloatLE(x[0],0);if(bottom)gridRaw.writeFloatLE(z[0],4);if(right)gridRaw.writeFloatLE(x.at(-1),8);if(top)gridRaw.writeFloatLE(z.at(-1),12);gridRaw.writeUInt32LE(width,24);gridRaw.writeUInt32LE(length,28);gridRaw.writeUInt32LE(vertexCount,0x60);
  const axes=Buffer.alloc((x.length+z.length)*4);[...x,...z].forEach((n,i)=>axes.writeFloatLE(n,i*4));
  for(const [name,array] of Object.entries(parsed.primitives))gridRaw.writeUInt32LE(records[name].length,array.countOffset);
  const bytes=Buffer.concat([parsed.bytes.subarray(0,parsed.gridOffset),gridRaw,axes,parsed.separator,...Object.keys(parsed.primitives).flatMap(name=>records[name].map(r=>r.raw)),vertexBytes,...vertexBlocks,parsed.cellSeparator,...cells,parsed.tail]);
  parseCollision(bytes);return {bytes,mappings,added:addedIds};
}
