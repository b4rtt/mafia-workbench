// Optional native caps follow the street graph in XZ metres, never straight-line
// proximity to a nearby but disconnected street. The 12m zone and 1.5m/s² ramp
// are conservative approximations, not vehicle-specific braking simulation.
const distance=(a,b)=>Math.hypot(b[0]-a[0],b[2]-a[2]);
const minimumTurn=Math.PI/6,zone=12,deceleration=1.5;
function ray(chain,index,step){
  const origin=chain[index];let walked=0,last=origin;
  for(let i=index+step;i>=0&&i<chain.length;i+=step){const point=chain[i],span=distance(last,point);if(walked+span>=4){const t=(4-walked)/span;return [last[0]+(point[0]-last[0])*t-origin[0],last[2]+(point[2]-last[2])*t-origin[2]];}walked+=span;last=point;}
  return [last[0]-origin[0],last[2]-origin[2]];
}
function sharp(a,b){const length=Math.hypot(...a)*Math.hypot(...b);return length>1e-8&&Math.acos(Math.max(-1,Math.min(1,-(a[0]*b[0]+a[1]*b[1])/length)))>=minimumTurn;}
function cornerGraph(plan,roads){
  const points=plan.crossings.map(c=>c.position),links=points.map(()=>[]),legs=points.map(()=>[]),seeds=new Set(),sites=new Set(),chains=[];
  for(const [index,road]of plan.roads.entries()){
    const positions=roads[index].positions,ids=[road.from];for(const point of positions){ids.push(points.length);points.push(point);links.push([]);}ids.push(road.to);chains.push(ids);
    for(let j=1;j<ids.length;j++){const a=ids[j-1],b=ids[j],length=distance(points[a],points[b]);links[a].push({to:b,length});links[b].push({to:a,length});}
    const chain=ids.map(i=>points[i]);
    if(road.cornerPaths){
      // Generated arcs retain the complete original turn, not just its tiny
      // local angles. Cap the span while displaying one marker per turn.
      const at=new Map(ids.map(i=>[points[i].join('/'),i]));
      for(const path of road.cornerPaths){const nodes=path.map(p=>at.get(p.join('/'))).filter(i=>i!==undefined);for(const i of nodes)seeds.add(i);if(nodes.length)sites.add(nodes[Math.floor(nodes.length/2)]);}
    }else for(let j=1;j<chain.length-1;j++)if(sharp(ray(chain,j,-1),ray(chain,j,1))){seeds.add(ids[j]);sites.add(ids[j]);}
    legs[road.from].push({index,vector:ray(chain,0,1),incoming:road.reverse,outgoing:road.forward});legs[road.to].push({index,vector:ray(chain,chain.length-1,-1),incoming:road.forward,outgoing:road.reverse});
  }
  legs.forEach((items,i)=>{if(items.some(a=>a.incoming&&items.some(b=>a.index!==b.index&&b.outgoing&&sharp(a.vector,b.vector)))){seeds.add(i);sites.add(i);}});
  return {points,links,seeds,sites,chains};
}
// Same sites as the speed planner, also available when slowing is disabled.
export function osmTrafficCornerSites(plan,roads){
  const {points,sites}=cornerGraph(plan,roads);return [...sites].map(i=>[...points[i]]);
}
export function osmCornerSpeeds(plan,roads,speedKmh,baseSpeed){
  const {points,links,seeds,sites,chains}=cornerGraph(plan,roads);
  const distances=new Float64Array(points.length).fill(Infinity),done=new Uint8Array(points.length);for(const i of seeds)distances[i]=0;
  const cornerSpeed=Math.min(baseSpeed,speedKmh/3.6),reach=zone+(baseSpeed**2-cornerSpeed**2)/(2*deceleration);
  for(let n=0;n<points.length;n++){let at=-1;for(let i=0;i<distances.length;i++)if(!done[i]&&(at<0||distances[i]<distances[at]))at=i;if(at<0||!Number.isFinite(distances[at])||distances[at]>reach)break;done[at]=1;for(const edge of links[at]){const d=distances[at]+edge.length;if(d<distances[edge.to])distances[edge.to]=d;}}
  const speeds=Array.from(distances,d=>Math.min(baseSpeed,Math.sqrt(cornerSpeed**2+2*deceleration*Math.max(0,d-zone))));
  return {crossingSpeeds:speeds.slice(0,plan.crossings.length),nodeSpeeds:chains.map(ids=>ids.slice(1,-1).map(i=>speeds[i])),cornering:{speedKmh,sites:sites.size,zone,deceleration,affectedCrossings:speeds.slice(0,plan.crossings.length).filter(v=>v<baseSpeed).length,affectedNodes:speeds.slice(plan.crossings.length).filter(v=>v<baseSpeed).length}};
}
