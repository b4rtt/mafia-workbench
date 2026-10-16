const key=(a,b)=>a<b?a+'/'+b:b+'/'+a;
const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
function distance(p,a,b){const dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dz)/(dx*dx+dz*dz)||0));return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dz);}
const intersects=(a,b,c,d)=>cross(a,b,c)*cross(a,b,d)<0&&cross(c,d,a)*cross(c,d,b)<0;
const gap=(a,b,c,d)=>intersects(a,b,c,d)?0:Math.min(distance(a,c,d),distance(b,c,d),distance(c,a,b),distance(d,a,b));
function boundaryIndex(polygons){
  const bins=new Map();for(const polygon of polygons)for(const ring of polygon)for(let i=1;i<ring.length;i++){
    const edge=[ring[i-1],ring[i]],xs=edge.map(v=>v[0]),zs=edge.map(v=>v[1]);
    for(let x=Math.floor(Math.min(...xs)/8);x<=Math.floor(Math.max(...xs)/8);x++)for(let z=Math.floor(Math.min(...zs)/8);z<=Math.floor(Math.max(...zs)/8);z++){const k=x+'/'+z;if(!bins.has(k))bins.set(k,[]);bins.get(k).push(edge);}
  }
  return (a,b,r)=>{const found=new Set();for(let x=Math.floor((Math.min(a[0],b[0])-r)/8);x<=Math.floor((Math.max(a[0],b[0])+r)/8);x++)for(let z=Math.floor((Math.min(a[1],b[1])-r)/8);z<=Math.floor((Math.max(a[1],b[1])+r)/8);z++)for(const edge of bins.get(x+'/'+z)??[])found.add(edge);return found;};
}

// Contract degree-two vertices only. Preserve every original component,
// branch, dead end and crossing landing, and retain original path witnesses
// so repeated contractions cannot gradually cut a corner or erase a bay.
export function compactPedestrianLinks(points,links,{walkable,levels,terrain,levelAt,pinned=new Set()}){
  const adjacent=points.map(()=>new Set()),witnesses=new Map(),edges=boundaryIndex(walkable),seams=boundaryIndex(levels),queue=points.map((_,i)=>i),xz=i=>[points[i][0],points[i][2]];
  for(const[a,b]of links)if(a!==b){adjacent[a].add(b);adjacent[b].add(a);witnesses.set(key(a,b),[]);}
  for(let n=0;n<queue.length;n++){
    const i=queue[n];if(pinned.has(i)||adjacent[i].size!==2)continue;const[a,b]=adjacent[i],p=points[a],q=points[b],u=xz(a),v=xz(b);
    if(adjacent[a].has(b)||Math.hypot(...p.map((c,k)=>c-q[k]))>4)continue;
    const level=levelAt(u);if(levelAt(v)!==level||levelAt(xz(i))!==level)continue;
    const original=[...witnesses.get(key(a,i)),i,...witnesses.get(key(i,b))];
    if(original.some(j=>distance(xz(j),u,v)>.05))continue;
    if([...edges(u,v,.400001)].some(([c,d])=>gap(u,v,c,d)<.400001))continue;
    // Do not collapse across a curb or a path material/height seam.
    if([...seams(u,v,0)].some(([c,d])=>gap(u,v,c,d)<1e-7))continue;
    const cuts=terrain.field.splitEdge(u,v);
    if(cuts.some(c=>levelAt(c.point)!==level||Math.abs(p[1]+(q[1]-p[1])*c.t-terrain.field.heightAt(...c.point)-level)>1e-6))continue;
    adjacent[a].delete(i);adjacent[b].delete(i);adjacent[i].clear();adjacent[a].add(b);adjacent[b].add(a);
    witnesses.delete(key(a,i));witnesses.delete(key(i,b));witnesses.set(key(a,b),original);queue.push(a,b);
  }
  return adjacent.flatMap((neighbors,i)=>[...neighbors].filter(j=>j>i).map(j=>[i,j]));
}
