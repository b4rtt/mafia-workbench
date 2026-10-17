import {osmTrafficCornerSites} from './traffic-speeds.js';

// Segment arrows use the first native band's half width. They describe the
// requested lane layout, not the engine's smoothed trajectory through a bend.
export function osmTrafficPreview(plan,traffic){
  plan=traffic.network??plan;
  const arrows=[],activeRoads=[];
  for(const [index,road]of plan.roads.entries()){
    const lane=traffic.roads[index],chain=[plan.crossings[road.from].position,...road.positions,plan.crossings[road.to].position];
    const forward=lane.forward&&lane.forwardLanes[0].type===2,reverse=lane.reverse&&lane.reverseLanes[0].type===2;
    if(forward||reverse){activeRoads.push({...road,forward,reverse});}
    for(const [permitted,enabled,band,points]of [[road.forward,lane.forward,lane.forwardLanes[0],chain],[road.reverse,lane.reverse,lane.reverseLanes[0],[...chain].reverse()]]){
      if(!permitted)continue;
      const active=enabled&&band.type===2,offset=enabled?band.distance/2:0;
      for(let i=1;i<points.length;i++){
        const a=points[i-1],b=points[i],length=Math.hypot(b[0]-a[0],b[2]-a[2]);if(length<1e-8)continue;
        const forward=[(b[0]-a[0])/length,0,(b[2]-a[2])/length],right=[forward[2],0,-forward[0]],count=Math.ceil(length/20),size=Math.min(3.5,length/count*.5);
        for(let n=0;n<count;n++){
          const t=(n+.5)/count,center=a.map((v,j)=>v+(b[j]-v)*t+right[j]*offset);
          arrows.push({road:index,active,offset,center,start:center.map((v,j)=>v-forward[j]*size/2),end:center.map((v,j)=>v+forward[j]*size/2)});
        }
      }
    }
  }
  // Mark mapped bends once, rather than all nearby densified speed seeds.
  const corners=osmTrafficCornerSites({...plan,roads:activeRoads},activeRoads);
  return {arrows,corners};
}

export function drawOsmTrafficPreview(context,point,preview){
  context.save();context.lineWidth=1.6;
  for(const active of [false,true]){
    context.strokeStyle=active?'#126246':'#6b747c';context.setLineDash(active?[]:[2,2]);context.beginPath();
    for(const arrow of preview.arrows){
      if(arrow.active!==active)continue;
      const a=point(arrow.start),b=point(arrow.end),length=Math.hypot(b[0]-a[0],b[1]-a[1]);if(length<.5)continue;
      const dx=(b[0]-a[0])/length,dy=(b[1]-a[1])/length,head=Math.min(4,length*.45);
      context.moveTo(...a);context.lineTo(...b);context.moveTo(b[0]-dx*head-dy*head*.6,b[1]-dy*head+dx*head*.6);context.lineTo(...b);context.lineTo(b[0]-dx*head+dy*head*.6,b[1]-dy*head-dx*head*.6);
    }
    context.stroke();
  }
  context.setLineDash([]);context.strokeStyle='#a9500a';context.lineWidth=2;context.beginPath();
  for(const p of preview.corners){const [x,y]=point(p);context.moveTo(x+5,y);context.arc(x,y,5,0,2*Math.PI);}
  context.stroke();context.restore();
}
