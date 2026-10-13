import { parseCollision } from './collision.js';

const fail=message=>{throw new Error(`KLZ: ${message}`);};
const pad=n=>(4-n%4)%4;
const finite=n=>typeof n==='number'&&Number.isFinite(Math.fround(n));

export function collisionTriangleVertices(parsed, record, resolveFrame) {
  const world=record.vertices[0].link===0x7fff;
  const points=world?record.vertices.map(v=>[0,1,2].map(axis=>parsed.extraVertices.readFloatLE(v.index*12+axis*4))):resolveFrame?.(parsed.links[record.vertices[0].link].name,record.vertices.map(v=>v.index));
  if(!Array.isArray(points)||points.length!==3||points.some(p=>!Array.isArray(p)||p.length!==3||p.some(n=>!Number.isFinite(n))))fail('nelze vyřešit světové vrcholy původní kolize.');
  return points;
}

// Match collision_classify_static_primitives: dominant plane axis followed by
// the first edge's near-zero component. The loader recalculates this byte too.
function classification(n,a,b) {
  const [x,y,z]=n.map(Math.abs);
  if(x>y&&x>=z)return Math.abs(b[1]-a[1])>=.0001?2:1;
  if(y>=x&&y>=z)return Math.abs(b[0]-a[0])<.0001?3:Math.abs(b[2]-a[2])<.0001?4:5;
  return Math.abs(b[0]-a[0])>=.0001?7:6;
}

export function collisionFace(points, indices, material, reverse) {
  const p=indices.map(i=>points.slice(i*3,i*3+3)),u=p[2].map((n,i)=>n-p[0][i]),v=p[1].map((n,i)=>n-p[0][i]);
  // Native GetNormal(v0,v2,v1), opposite the conventional rendered winding.
  let normal=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
  const magnitude=Math.hypot(...normal);if(magnitude<1e-8||!Number.isFinite(magnitude))fail('degenerovaný kolizní trojúhelník.');
  normal=normal.map(n=>Math.fround(n/magnitude*(reverse?-1:1)));
  const order=[0,1,2].sort((a,b)=>p[a][0]-p[b][0]||a-b);let parity=0;
  for(let i=0;i<3;i++)for(let j=i+1;j<3;j++)if(order[i]>order[j])parity^=1;
  const sorted=order.map(i=>p[i]),raw=Buffer.alloc(32);raw[0]=classification(normal,sorted[0],sorted[1]);raw[1]=parity^Number(reverse);raw[3]=material;
  order.forEach((i,j)=>{raw.writeUInt16LE(indices[i],4+j*4);raw.writeUInt16LE(0x7fff,6+j*4);});
  normal.forEach((n,i)=>raw.writeFloatLE(n,16+i*4));const d=Math.fround(-normal.reduce((sum,n,i)=>sum+n*p[0][i],0));if(!Number.isFinite(d))fail('rovina přesahuje float32.');raw.writeFloatLE(d,28);
  return {raw,min:[0,1,2].map(i=>Math.min(...p.map(p=>p[i]))),max:[0,1,2].map(i=>Math.max(...p.map(p=>p[i])))};
}

// Replace only caller-owned triangle records and their exclusive vertices.
// Native frame triangles, volume arrays, opaque headers, gaps and flags survive.
export function replaceCollisionSurfaces(source, surfaces, options={}) {
  const parsed=parseCollision(source),removedIndices=options.removedIndices??[],vertexBase=options.vertexBase??parsed.vertexCount;
  if(!Array.isArray(surfaces)||surfaces.length>65536||!Array.isArray(removedIndices)||new Set(removedIndices).size!==removedIndices.length||removedIndices.some(i=>!Number.isInteger(i)||i<0||i>=parsed.primitives.triangles.count)||!Number.isInteger(vertexBase)||vertexBase<0||vertexBase>parsed.vertexCount)fail('neplatná evidence odstraňovaného povrchu.');
  const removedVertices=options.removedVertexIndices??Array.from({length:parsed.vertexCount-vertexBase},(_,i)=>vertexBase+i);
  if(!Array.isArray(removedVertices)||new Set(removedVertices).size!==removedVertices.length||removedVertices.some(i=>!Number.isInteger(i)||i<0||i>=parsed.vertexCount)||options.removedVertexIndices!==undefined&&options.vertexBase!==undefined)fail('neplatná evidence odstraňovaných vrcholů.');
  if(!surfaces.length&&!removedIndices.length&&!removedVertices.length)return {bytes:Buffer.from(source),groups:[]};
  const removed=new Set(removedIndices),removedVertexSet=new Set(removedVertices),originalRetained=parsed.primitives.triangles.records.filter(t=>!removed.has(t.index)),remapped=new Map(originalRetained.map((t,i)=>[t.index,i])),vertexMap=new Map(),vertexParts=[];
  for(let i=0;i<parsed.vertexCount;i++)if(!removedVertexSet.has(i)){vertexMap.set(i,vertexParts.length);vertexParts.push(parsed.extraVertices.subarray(i*12,i*12+12));}
  if(originalRetained.some(t=>t.vertices[0].link===0x7fff&&t.vertices.some(v=>!vertexMap.has(v.index))))fail('vrcholy generované kolize používá jiný povrch.');
  const retained=originalRetained.map(t=>{
    if(t.vertices[0].link!==0x7fff||t.vertices.every(v=>vertexMap.get(v.index)===v.index))return t;
    const raw=Buffer.from(t.raw),vertices=t.vertices.map(v=>({...v,index:vertexMap.get(v.index)}));vertices.forEach((v,i)=>raw.writeUInt16LE(v.index,4+i*4));return {...t,raw,vertices};
  });
  const records=[],vertexBlocks=[],groups=[];let vertexCount=vertexParts.length;
  const {grid}=parsed;let minX=grid.minX,minZ=grid.minZ,maxX=grid.maxX,maxZ=grid.maxZ;
  for(const surface of surfaces){
    const positions=surface?.positions,indices=surface?.indices,material=surface?.material??0;
    if(!surface||typeof surface.name!=='string'||!surface.name||!Array.isArray(positions)||positions.length%3||!positions.length||positions.some(n=>!finite(n))||!Array.isArray(indices)||!indices.length||indices.length%3||indices.some(i=>!Number.isInteger(i)||i<0||i>=positions.length/3)||!Number.isInteger(material)||material<0||material>255||surface.doubleSided!==undefined&&typeof surface.doubleSided!=='boolean')fail('neplatný povrch nebo materiál modelu.');
    if(vertexCount+positions.length/3>65536)fail('povrch přesahuje limit 65 536 světových vrcholů.');
    const points=positions.map(Math.fround),block=Buffer.alloc(points.length*4);points.forEach((n,i)=>block.writeFloatLE(n,i*4));vertexBlocks.push(block);
    const group={name:surface.name,triangleStart:retained.length+records.length,triangleCount:0,vertexStart:vertexCount,vertexCount:points.length/3,doubleSided:surface.doubleSided!==false};
    for(let i=0;i<indices.length;i+=3){
      const local=indices.slice(i,i+3),front=collisionFace(points,local,material,false);for(const record of group.doubleSided?[front,collisionFace(points,local,material,true)]:[front]){
        // Local input indices become global pool indices after the plane math.
        for(let j=0;j<3;j++)record.raw.writeUInt16LE(record.raw.readUInt16LE(4+j*4)+vertexCount,4+j*4);
        records.push(record);group.triangleCount++;minX=Math.min(minX,record.min[0]);minZ=Math.min(minZ,record.min[2]);maxX=Math.max(maxX,record.max[0]);maxZ=Math.max(maxZ,record.max[2]);
      }
    }
    vertexCount+=group.vertexCount;groups.push(group);
  }
  if((retained.length+records.length-1)*32>0xffffff)fail('příliš mnoho kolizních trojúhelníků.');
  const left=Math.ceil((grid.minX-minX)/grid.cellWidth),bottom=Math.ceil((grid.minZ-minZ)/grid.cellLength),right=Math.ceil((maxX-grid.maxX)/grid.cellWidth),top=Math.ceil((maxZ-grid.maxZ)/grid.cellLength),width=grid.width+left+right,length=grid.length+bottom+top;
  if(!Number.isSafeInteger(width*length)||width*length>1000000)fail('rozšířená mřížka je příliš velká.');
  const extend=(axis,before,after,step)=>[...Array.from({length:before},(_,i)=>Math.fround(axis[0]-(before-i)*step)),...axis,...Array.from({length:after},(_,i)=>Math.fround(axis.at(-1)+(i+1)*step))];
  const x=extend(grid.x,left,right,grid.cellWidth),z=extend(grid.z,bottom,top,grid.cellLength);
  if([x,z].some(axis=>axis.some((v,i)=>!Number.isFinite(v)||i>0&&v<=axis[i-1])))fail('mřížka přesahuje přesnost float32.');
  const lower=(axis,value,upper=false)=>{let lo=0,hi=axis.length;while(lo<hi){const mid=(lo+hi)>>>1;if(axis[mid]<value||upper&&axis[mid]===value)lo=mid+1;else hi=mid;}return lo;};
  const additions=new Map();let referenceCount=0;
  records.forEach((record,i)=>{
    const firstX=Math.max(0,lower(x,record.min[0])-1),lastX=Math.min(width-1,lower(x,record.max[0],true)-1),firstZ=Math.max(0,lower(z,record.min[2])-1),lastZ=Math.min(length-1,lower(z,record.max[2],true)-1);
    referenceCount+=(lastX-firstX+1)*(lastZ-firstZ+1);if(referenceCount>10000000)fail('příliš mnoho nových vazeb buněk.');
    for(let row=firstZ;row<=lastZ;row++)for(let col=firstX;col<=lastX;col++){const cell=row*width+col,list=additions.get(cell)??[];list.push({type:0,index:retained.length+i,flag:0});additions.set(cell,list);}
  });
  const minimums=new Map();const minimum=index=>{
    if(index>=retained.length)return records[index-retained.length].min[0];
    if(!minimums.has(index)){const points=collisionTriangleVertices(parsed,originalRetained[index],options.resolveFrame);minimums.set(index,points[0][0]);}return minimums.get(index);
  };
  const cells=[];
  for(let row=0;row<length;row++)for(let col=0;col<width;col++){
    const old=col>=left&&col<left+grid.width&&row>=bottom&&row<bottom+grid.length?parsed.cells[(row-bottom)*grid.width+col-left]:null,added=additions.get(row*width+col)??[];
    let refs=(old?.references??[]).filter(r=>r.type!==0||!removed.has(r.index)).map(r=>r.type===0?{...r,index:remapped.get(r.index)}:r);
    if(!added.length&&old&&refs.length===old.references.length){
      if(refs.every((ref,i)=>ref.index===old.references[i].index)){cells.push(old.raw);continue;}
      const raw=Buffer.from(old.raw);refs.forEach((r,i)=>{if(r.type===0)raw.writeUInt32LE(r.index*32,16+i*4);});cells.push(raw);continue;
    }
    if(added.length){const volumes=refs.filter(r=>r.type!==0),triangles=[...refs.filter(r=>r.type===0),...added];triangles.sort((a,b)=>minimum(a.index)-minimum(b.index));refs=[...volumes,...triangles];}
    const count=refs.length,raw=Buffer.alloc(16+count*5+pad(count));if(old)old.header.copy(raw);raw.writeUInt32LE(count);
    if(added.length){const height=old?.header.readFloatLE(12)??-Infinity;if(old&&!Number.isFinite(height))fail('neplatná maximální výška buňky.');raw.writeFloatLE(added.reduce((h,r)=>Math.max(h,records[r.index-retained.length].max[1]),height),12);}
    refs.forEach((r,i)=>{const size=r.type===0?32:Object.values(parsed.primitives).find(a=>a.type===r.type).size;raw.writeUInt32LE((r.type*0x1000000+r.index*size)>>>0,16+i*4);raw[16+count*4+i]=r.flag;});cells.push(raw);
  }
  const gridRaw=Buffer.from(grid.raw);gridRaw.writeFloatLE(x[0],0);gridRaw.writeFloatLE(z[0],4);gridRaw.writeFloatLE(x.at(-1),8);gridRaw.writeFloatLE(z.at(-1),12);gridRaw.writeUInt32LE(width,24);gridRaw.writeUInt32LE(length,28);gridRaw.writeUInt32LE(retained.length+records.length,0x30);gridRaw.writeUInt32LE(vertexCount,0x60);
  const bounds=Buffer.alloc((x.length+z.length)*4);[...x,...z].forEach((n,i)=>bounds.writeFloatLE(n,i*4));
  const bytes=Buffer.concat([parsed.bytes.subarray(0,parsed.gridOffset),gridRaw,bounds,parsed.separator,...Object.values(parsed.primitives).flatMap(a=>a.type===0?[...retained.map(t=>t.raw),...records.map(t=>t.raw)]:[a.raw]),...vertexParts,...vertexBlocks,parsed.cellSeparator,...cells,parsed.tail]);
  parseCollision(bytes);return {bytes,groups};
}
