import clipping from 'polygon-clipping';

const snap=n=>Math.round(n*1000)/1000;
const squaredDistance=(p,a,b)=>{const x=b[0]-a[0],y=b[1]-a[1],length=x*x+y*y,t=length?Math.max(0,Math.min(1,((p[0]-a[0])*x+(p[1]-a[1])*y)/length)):0;return (p[0]-a[0]-t*x)**2+(p[1]-a[1]-t*y)**2;};
const bounds=points=>[Math.min(...points.map(p=>p[0])),Math.min(...points.map(p=>p[1])),Math.max(...points.map(p=>p[0])),Math.max(...points.map(p=>p[1]))];
const overlap=(a,b)=>a[0]<=b[2]&&a[2]>=b[0]&&a[1]<=b[3]&&a[3]>=b[1];
const edges=polygons=>polygons.flatMap(p=>p.flatMap(r=>r.slice(1).map((b,i)=>({a:r[i],b,box:bounds([r[i],b])}))));
const topology=polygons=>[polygons.length,polygons.reduce((n,p)=>n+p.length-1,0)];

// The millimetre-quantized buffer union can split a straight boundary into
// tiny edges. Use a local simplified copy to find tangents, while retaining
// the original polygon in the final union. Never simplify away a real bend.
function cornerRing(ring){
  const points=ring.slice(0,-1),previous=points.map((_,i)=>(i+points.length-1)%points.length),next=points.map((_,i)=>(i+1)%points.length),removed=new Uint8Array(points.length),queue=points.map((_,i)=>i);let count=points.length;
  for(let at=0;at<queue.length&&count>3;at++){
    const i=queue[at];if(removed[i])continue;const a=points[previous[i]],p=points[i],b=points[next[i]],x=b[0]-a[0],y=b[1]-a[1],length=x*x+y*y,t=((p[0]-a[0])*x+(p[1]-a[1])*y)/length;
    if(t>=0&&t<=1&&squaredDistance(p,a,b)<.003**2){removed[i]=1;count--;next[previous[i]]=next[i];previous[next[i]]=previous[i];queue.push(previous[i],next[i]);}
  }return points.filter((_,i)=>!removed[i]);
}
function nearSegments(a,b,c,d){
  const cross=(p,q,r)=>(q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0]);
  if(overlap(bounds([a,b]),bounds([c,d]))&&cross(a,b,c)*cross(a,b,d)<=0&&cross(c,d,a)*cross(c,d,b)<=0)return true;
  return Math.min(squaredDistance(a,c,d),squaredDistance(b,c,d),squaredDistance(c,a,b),squaredDistance(d,a,b))<.5**2;
}

// Add tangent fillet wedges only at concave road boundaries. Outer street
// extents stay fixed, at least 0.5m separates a new wedge from their boundary,
// and adjacent tangencies use at most 45% of either edge. Radius is a request,
// not permission to delete a traffic island or join disconnected roads.
export function osmRoundedRoadCorners(road,outer,radius){
  const boundary=edges(outer),patches=[];let rounded=0,limited=0,skipped=0;
  for(const polygon of road)for(const ring of polygon){const points=cornerRing(ring);for(let i=0;i<points.length;i++){
    const p=points[i],a=points[(i+points.length-1)%points.length],b=points[(i+1)%points.length],la=Math.hypot(p[0]-a[0],p[1]-a[1]),lb=Math.hypot(b[0]-p[0],b[1]-p[1]);if(la<.01||lb<.01)continue;
    const u=[(p[0]-a[0])/la,(p[1]-a[1])/la],v=[(b[0]-p[0])/lb,(b[1]-p[1])/lb],angle=Math.acos(Math.max(-1,Math.min(1,u[0]*v[0]+u[1]*v[1])));
    if(u[0]*v[1]-u[1]*v[0]>=0||angle<.1||angle>Math.PI-.05)continue;
    let r=Math.min(radius,.45*Math.min(la,lb)/Math.tan(angle/2)),accepted=false;
    for(let attempt=0;attempt<8&&r>=.05;attempt++,r/=2){
      const d=r*Math.tan(angle/2),start=p.map((n,k)=>n-u[k]*d),end=p.map((n,k)=>n+v[k]*d),centre=[start[0]+u[1]*r,start[1]-u[0]*r],theta=Math.atan2(start[1]-centre[1],start[0]-centre[0]),steps=Math.max(2,Math.ceil(angle/(Math.PI/48))),arc=Array.from({length:steps+1},(_,j)=>[centre[0]+r*Math.cos(theta-angle*j/steps),centre[1]+r*Math.sin(theta-angle*j/steps)]);
      // Overlap the old road by 1cm. Tangents found from the simplified ring
      // can differ by a few millimetres from its quantized boundary; merely
      // touching that boundary would create tiny enclosed boolean slivers.
      arc[0]=start;arc[steps]=end;
      const inside=[p[0]-(u[1]+v[1])*.02,p[1]+(u[0]+v[0])*.02],leftStart=[start[0]-u[1]*.01,start[1]+u[0]*.01],leftEnd=[end[0]-v[1]*.01,end[1]+v[0]*.01],patch=[inside,leftStart,...arc,leftEnd,inside].map(p=>p.map(snap)),box=bounds(patch).map((n,i)=>n+(i<2?-.5:.5)),near=boundary.filter(e=>overlap(box,e.box));
      if(near.some(e=>patch.slice(1).some((b,j)=>nearSegments(patch[j],b,e.a,e.b))))continue;
      // The distance check alone cannot detect an outer hole wholly inside
      // a wedge; the boolean containment test covers that case too.
      if(clipping.difference([[patch]],outer).length)continue;
      patches.push([patch]);rounded++;if(r<radius-.001)limited++;accepted=true;break;
    }
    if(!accepted)skipped++;
  }}
  const result=patches.length?clipping.union(road,...patches):road;
  if(topology(result).some((n,i)=>n!==topology(road)[i]))throw Error('OpenStreetMap · povrchy: zaoblení by odstranilo ostrůvek nebo spojilo oddělené ulice. Zmenšete poloměr.');
  return {road:result,corners:{radius,rounded,limited,skipped,minimumOuterClearance:.5}};
}
