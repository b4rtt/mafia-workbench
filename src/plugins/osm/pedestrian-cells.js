// Merge only across a shared diagonal when the entire union stays convex.
// No boundary vertex moves: holes, narrow entrances and the body inset stay
// identical. Bounded cells limit fan-out; the final graph checks native degree.
export function convexPedestrianCells(vertices,triangles){
  const cross=(a,b,c)=>(b.x-a.x)*(c.y-b.y)-(b.y-a.y)*(c.x-b.x),key=(a,b)=>a<b?a+'/'+b:b+'/'+a,edges=new Map(),polys=[],queue=[];
  function record(id,add){const ids=polys[id];for(let i=0;i<ids.length;i++){const k=key(ids[i],ids[(i+1)%ids.length]);if(add){if(!edges.has(k))edges.set(k,new Set());edges.get(k).add(id);queue.push(k);}else edges.get(k).delete(id);}}
  for(const ids of triangles){const n=cross(...ids.map(i=>vertices[i]));if(Math.abs(n)<1e-8)continue;polys.push(n>0?[...ids]:[ids[0],ids[2],ids[1]]);record(polys.length-1,true);}
  const length=k=>{const [i,j]=k.split('/').map(Number);return (vertices[i].x-vertices[j].x)**2+(vertices[i].y-vertices[j].y)**2;};queue.length=0;queue.push(...[...edges.keys()].sort((a,b)=>length(b)-length(a)));
  for(let q=0;q<queue.length;q++){
    const k=queue[q],owners=edges.get(k);if(owners.size!==2)continue;const [a,b]=owners,one=polys[a],two=polys[b];if(one.length+two.length-2>128)continue;
    const i=one.findIndex((n,j)=>key(n,one[(j+1)%one.length])===k),u=one[i],v1=one[(i+1)%one.length],j=two.indexOf(v1);
    if(two[(j+1)%two.length]!==u)continue;
    const join=[...Array.from({length:one.length-1},(_,n)=>one[(i+1+n)%one.length]),...Array.from({length:two.length-1},(_,n)=>two[(j+1+n)%two.length])];
    if(new Set(join).size!==join.length||join.some((n,i)=>cross(vertices[join[(i+join.length-1)%join.length]],vertices[n],vertices[join[(i+1)%join.length]])<0))continue;
    record(a,false);record(b,false);polys[a]=join;polys[b]=null;record(a,true);
  }
  return polys.filter(Boolean);
}
