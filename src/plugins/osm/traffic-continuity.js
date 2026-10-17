// Ambient traffic excludes the incoming road when choosing a next branch.
// At a terminal it falls back to a U-turn, which can leave a clipped surface.
// Retain only directed arrivals with a non-returning continuation. Feeders
// into a circuit are useful; a disconnected circuit need not be invented.
export function osmTrafficContinuity(plan){
  let directions=plan.roads.map(r=>({forward:r.forward,reverse:r.reverse}));
  const before=directions.reduce((n,r)=>n+Number(r.forward)+Number(r.reverse),0);
  for(;;){
    const outgoing=plan.crossings.map(()=>[]);
    plan.roads.forEach((r,i)=>{if(directions[i].forward)outgoing[r.from].push(i);if(directions[i].reverse)outgoing[r.to].push(i);});
    const next=plan.roads.map((r,i)=>({forward:directions[i].forward&&outgoing[r.to].some(j=>j!==i),reverse:directions[i].reverse&&outgoing[r.from].some(j=>j!==i)}));
    if(next.every((r,i)=>r.forward===directions[i].forward&&r.reverse===directions[i].reverse))break;
    directions=next;
  }
  const retained=directions.reduce((n,r)=>n+Number(r.forward)+Number(r.reverse),0);
  return {directions,before,retained,excluded:before-retained};
}
