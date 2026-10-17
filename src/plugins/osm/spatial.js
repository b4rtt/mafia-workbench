const fail=message=>{throw Error(`OpenStreetMap · prostorové části: ${message}`);};
export function validateOsmSpatial(settings){
  if(!settings||settings.version!==1||!Number.isInteger(settings.cellSize)||settings.cellSize<25||settings.cellSize>250||Object.keys(settings).some(k=>!['version','cellSize'].includes(k)))fail('zadejte verzi 1 a velikost buňky 25–250 celých metrů.');
}
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const subtract=(a,b)=>a.map((n,i)=>n-b[i]);
const compare=(a,b)=>a[0]-b[0]||a[1]-b[1]||a[2]-b[2];
const range=(min,max,size)=>[Math.floor(min/size),min===max?Math.floor(max/size):Math.ceil(max/size)-1];

// Generated standard visuals only. Keep baked world coordinates, like the
// existing city geometry: no loss of precision from per-cell TRS roundtrips.
export function osmSpatialModel(model,settings){
  validateOsmSpatial(settings);const size=settings.cellSize;
  if(!model||model.animated||!Array.isArray(model.materials)||!model.materials.length||model.materials.length>255||!Array.isArray(model.meshes)||!model.meshes.length)fail('neplatný generovaný model.');
  const cells=new Map();let triangles=0;
  function emit(x,z,polygon,material,source){
    const key=`${x}/${z}`;let cell=cells.get(key);
    for(let i=1;i+1<polygon.length;i++){
      const vertices=[polygon[0],polygon[i],polygon[i+1]].map(v=>({p:v.p.map(Math.fround),n:v.n.map(Math.fround),uv:v.uv.map(Math.fround)}));
      const normal=cross(subtract(vertices[1].p,vertices[0].p),subtract(vertices[2].p,vertices[0].p));if(Math.hypot(...normal)<1e-8)continue;
      if(++triangles>60000)fail('přes 60 000 výsledných trojúhelníků; zvětšete buňky nebo zmenšete oblast.');
      if(!cell){cell={x,z,source,triangles:[]};cells.set(key,cell);if(cells.size>512)fail('přes 512 prostorových buněk.');}
      cell.triangles.push({vertices,material});
    }
  }
  for(const mesh of model.meshes){
    if(mesh.type!==1||mesh.visual!==0||mesh.parent||mesh.instance||mesh.skin||mesh.lods?.length!==1||!Array.isArray(mesh.position)||mesh.position.length!==3||mesh.position.some(n=>n!==0)||!Array.isArray(mesh.scale)||mesh.scale.length!==3||mesh.scale.some(n=>n!==1)||!Array.isArray(mesh.rotation)||mesh.rotation.length!==4||mesh.rotation.some((n,i)=>n!==(i===0?1:0)))fail('vyžaduje samostatné standardní visualy s jednotkovou transformací.');
    const lod=mesh.lods[0];if(!Array.isArray(lod.positions)||lod.positions.length!==lod.vertices*3||!Array.isArray(lod.normals)||lod.normals.length!==lod.vertices*3||!Array.isArray(lod.uv)||lod.uv.length!==lod.vertices*2||[...lod.positions,...lod.normals,...lod.uv].some(n=>!Number.isFinite(n))||!Array.isArray(lod.faces))fail('neplatné vrcholy generovaného modelu.');
    for(const face of lod.faces){
      if(!Number.isInteger(face.material)||face.material<1||face.material>model.materials.length||!Array.isArray(face.indices)||face.indices.length%3||face.indices.some(i=>!Number.isInteger(i)||i<0||i>=lod.vertices))fail('neplatné trojúhelníky generovaného modelu.');
      for(let at=0;at<face.indices.length;at+=3){
        const original=face.indices.slice(at,at+3).map((v,i)=>({p:lod.positions.slice(v*3,v*3+3),n:lod.normals.slice(v*3,v*3+3),uv:lod.uv.slice(v*2,v*2+2),edges:[i,(i+2)%3],planes:new Map()}));
        const normal=cross(subtract(original[1].p,original[0].p),subtract(original[2].p,original[0].p));if(Math.hypot(...normal)<1e-8)continue;
        const xs=original.map(v=>v.p[0]),zs=original.map(v=>v.p[2]),[x0,x1]=range(Math.min(...xs),Math.max(...xs),size),[z0,z1]=range(Math.min(...zs),Math.max(...zs),size);
        if((x1-x0+1)*(z1-z0+1)>512)fail('trojúhelník přesahuje 512 buněk.');
        function intersection(a,b,axis,value){
          if(a.p[axis]===value)return a;if(b.p[axis]===value)return b;
          const common=a.edges.filter(e=>b.edges.includes(e)),planes=new Map([...a.planes].filter(([k,v])=>b.planes.get(k)===v));planes.set(axis,value);
          let p,n,uv;
          if(common.length){
            // Always intersect the original edge, not an already clipped
            // segment. Adjacent cells therefore get identical seam attributes.
            let lo=original[common[0]],hi=original[(common[0]+1)%3];if(compare(lo.p,hi.p)>0)[lo,hi]=[hi,lo];
            const t=(value-lo.p[axis])/(hi.p[axis]-lo.p[axis]),mix=(a,b)=>a.map((v,i)=>v+(b[i]-v)*t);
            p=mix(lo.p,hi.p);p[axis]=value;n=mix(lo.n,hi.n);uv=mix(lo.uv,hi.uv);
          }else{
            // An interior grid corner. Derive it directly from the original
            // triangle plane and barycentric attributes, independent of cuts.
            if(!planes.has(0)||!planes.has(2)||normal[1]===0)fail('nejednoznačný průsečík hranice buňky.');
            const x=planes.get(0),z=planes.get(2),[a,b,c]=original.map(v=>v.p),den=(b[2]-c[2])*(a[0]-c[0])+(c[0]-b[0])*(a[2]-c[2]);
            const wa=((b[2]-c[2])*(x-c[0])+(c[0]-b[0])*(z-c[2]))/den,wb=((c[2]-a[2])*(x-c[0])+(a[0]-c[0])*(z-c[2]))/den,weights=[wa,wb,1-wa-wb];
            const weighted=key=>original[0][key].map((_,j)=>original.reduce((s,v,i)=>s+v[key][j]*weights[i],0));
            p=weighted('p');p[0]=x;p[2]=z;n=weighted('n');uv=weighted('uv');
          }
          return {p,n,uv,edges:common,planes};
        }
        function clip(polygon,axis,value,above){
          polygon=polygon.map(v=>v.p[axis]===value?{...v,planes:new Map([...v.planes,[axis,value]])}:v);
          const result=[];for(let i=0;i<polygon.length;i++){
            const a=polygon[i],b=polygon[(i+1)%polygon.length],inside=v=>above?v.p[axis]>=value:v.p[axis]<=value,ai=inside(a),bi=inside(b);
            if(ai)result.push(a);if(ai!==bi)result.push(intersection(a,b,axis,value));
          }return result;
        }
        for(let x=x0;x<=x1;x++)for(let z=z0;z<=z1;z++){
          let polygon=original;for(const [axis,value,above]of [[0,x*size,true],[0,(x+1)*size,false],[2,z*size,true],[2,(z+1)*size,false]]){polygon=clip(polygon,axis,value,above);if(polygon.length<3)break;}
          if(polygon.length>=3)emit(x,z,polygon,face.material,mesh);
        }
      }
    }
  }
  const meshes=[],parts=[],points=new Set();let bufferVertices=0;
  const coordinate=n=>n<0?'m'+(-n):'p'+n;
  for(const cell of [...cells.values()].sort((a,b)=>a.x-b.x||a.z-b.z)){
    let vertices=new Map(),positions=[],normals=[],uv=[],faces=model.materials.map((_,i)=>({material:i+1,indices:[]})),batch=0;
    function flush(){
      if(!positions.length)return;const id=meshes.length+1,name=`OSM_CELL_${coordinate(cell.x)}_${coordinate(cell.z)}_${++batch}`,usedFaces=faces.filter(f=>f.indices.length),count=usedFaces.reduce((n,f)=>n+f.indices.length/3,0),bounds=[Infinity,Infinity,Infinity,-Infinity,-Infinity,-Infinity];
      for(let i=0;i<positions.length;i+=3){points.add(positions.slice(i,i+3).join('/'));for(let j=0;j<3;j++){bounds[j]=Math.min(bounds[j],positions[i+j]);bounds[j+3]=Math.max(bounds[j+3],positions[i+j]);}}
      meshes.push({...cell.source,id,name,lods:[{distance:0,vertices:positions.length/3,positions,normals,uv,faces:usedFaces}]});
      parts.push({mesh:id,name,cell:[cell.x,cell.z],bounds,vertices:positions.length/3,triangles:count});bufferVertices+=positions.length/3;
      vertices=new Map();positions=[];normals=[];uv=[];faces=model.materials.map((_,i)=>({material:i+1,indices:[]}));
      if(meshes.length>512)fail('přes 512 výsledných visualů.');
    }
    for(const triangle of cell.triangles){
      if(positions.length/3+3>60000)flush();
      for(const v of triangle.vertices){
        const key=[...v.p,...v.n,...v.uv].join('/');let index=vertices.get(key);
        if(index===undefined){index=positions.length/3;vertices.set(key,index);positions.push(...v.p);normals.push(...v.n);uv.push(...v.uv);}faces[triangle.material-1].indices.push(index);
      }
    }flush();
  }
  if(!meshes.length)fail('nevznikl nedegenerovaný povrch.');
  return {model:{...model,meshes},spatial:{version:1,cellSize:size,triangles,vertices:points.size,bufferVertices,parts}};
}
