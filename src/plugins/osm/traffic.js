import {osmCornerSpeeds} from './traffic-speeds.js';
import {osmTrafficContinuity} from './traffic-continuity.js';
const fail=message=>{throw Error('OpenStreetMap · doprava: '+message);};
export function validateOsmTraffic(options){
  if(!options||![1,2,3].includes(options.version)||!Number.isInteger(options.density)||options.density<1||options.density>100||!/^[a-f0-9]{64}$/.test(options.tableHash??'')||!Array.isArray(options.models)||!options.models.length||options.models.length>32||new Set(options.models.map(m=>m?.path?.toLowerCase())).size!==options.models.length||options.models.some(m=>typeof m?.path!=='string'||!/^models\/[a-zA-Z0-9_ -]+10\.4ds$/i.test(m.path)||typeof m.table!=='string'||!/^[a-zA-Z0-9_ -]{1,19}$/.test(m.table)||!/^[a-f0-9]{64}$/.test(m.sha256??'')||!Number.isFinite(m.width)||m.width<.5||m.width>5))fail('načtěte katalog aut a vyberte 1–32 rodin; hustota je 1–100.');
  if(options.speedKmh!==undefined&&(!Number.isFinite(options.speedKmh)||options.speedKmh<1||options.speedKmh>50))fail('rychlost musí být 1–50 km/h.');
  if(options.cornerSpeedKmh!==undefined&&(!Number.isFinite(options.cornerSpeedKmh)||options.cornerSpeedKmh<1||options.cornerSpeedKmh>50))fail('rychlost v zatáčkách musí být 1–50 km/h.');
  if(options.continuous!==undefined&&(typeof options.continuous!=='boolean'||options.continuous&&options.version!==3))fail('vyloučení slepých tras vyžaduje aktualizovanou dopravní síť.');
  if(options.excludedWays!==undefined&&(!Array.isArray(options.excludedWays)||options.excludedWays.length>256||new Set(options.excludedWays).size!==options.excludedWays.length||options.excludedWays.some(id=>!Number.isSafeInteger(id)||id<=0)||options.excludedWays.length&&options.version!==3))fail('výběr ulic bez běžné dopravy vyžaduje aktualizovanou síť a nejvýše 256 jedinečných OSM ID ulic.');
}
// One native traffic lane per permitted direction. Keep the legacy network
// byte-exact when this explicit, versioned feature is absent.
export function osmTrafficPlan(plan,surface,options){
  validateOsmTraffic(options);if(!surface?.profiles||surface.profiles.length!==plan.roads.length)fail('zapněte povrchy ulic.');
  if(surface.elevation&&!plan.elevated)fail('nejdřív usaďte silniční plán na společný výškový podklad.');
  const clearance=Math.max(...options.models.map(m=>m.width))+.4;
  const excluded=new Set(options.excludedWays??[]),turns=excluded.size?{...plan,roads:plan.roads.map(r=>excluded.has(r.way)?{...r,forward:false,reverse:false}:r)}:plan;
  const continuity=options.continuous?osmTrafficContinuity(turns):null;
  if(continuity&&!continuity.retained)fail('výběr nemá průběžný jízdní okruh. Rozšiřte oblast, připojte navazující ulice nebo vypněte vyloučení slepých tras.');
  const roads=plan.roads.map((road,index)=>{
    const width=surface.profiles[index]?.width,both=road.forward&&road.reverse;if(!Number.isFinite(width)||width<=0)fail('neplatný profil vozovky.');
    if(!excluded.has(road.way)&&width<(both?2:1)*clearance)fail(`ulice ${road.tags.name??road.way} má ${width.toFixed(2)} m; vybraná auta potřebují alespoň ${((both?2:1)*clearance).toFixed(2)} m. Změňte výběr aut/ulic, vypněte zde běžnou dopravu nebo upravte profil vozovky.`);
    // The engine places the first lane at half its stored distance. Version 1
    // treated that field as a centre offset; retain its bytes on saved imports.
    const distance=both?width/(options.version>=2?2:4):0,lanes=permitted=>[{type:options.version===3&&!permitted?1:2,distance},...Array.from({length:3},()=>({type:0,distance:0}))];
    // The engine smooths sparse road nodes and can cut far across an OSM bend.
    // Retain every mapped point and bound interpolation spans to two metres.
    const chain=[plan.crossings[road.from].position,...road.positions,plan.crossings[road.to].position],positions=[];
    for(let i=1;i<chain.length;i++){const a=chain[i-1],b=chain[i],steps=Math.ceil(Math.hypot(b[0]-a[0],b[2]-a[2])/2);for(let n=1;n<=steps;n++)if(i<chain.length-1||n<steps)positions.push(a.map((v,k)=>Math.fround(v+(b[k]-v)*n/steps)));}
    // The native loader drops all-zero slots. Its car path builder still reads
    // the opposite slot's lane metadata, including on one-way streets. Keep
    // that slot as AI-only (type 1); ambient traffic chooses only type 2.
    // Versions 1/2 retain the exact old disconnected representation.
    const permitted=continuity?.directions[index]??turns.roads[index];
    return {index,way:road.way,width,positions,forward:options.version===3||road.forward,reverse:options.version===3||road.reverse,forwardLanes:lanes(permitted.forward),reverseLanes:lanes(permitted.reverse)};
  });
  if(roads.reduce((n,r)=>n+r.positions.length,0)>4096)fail('síť potřebuje více než 4096 jízdních bodů; zmenšete oblast nebo výběr ulic.');
  let cornering=null,crossingSpeeds=null;
  if(options.cornerSpeedKmh!==undefined){
    const permitted=continuity?{...turns,roads:turns.roads.map((r,i)=>({...r,...continuity.directions[i]}))}:turns;
    // A manually excluded street must neither seed a corner nor carry a
    // braking ramp between two otherwise disconnected traffic routes.
    const indices=roads.flatMap((r,i)=>excluded.has(plan.roads[i].way)?[]:[i]),baseSpeed=(options.speedKmh??4.32)/3.6;
    const result=osmCornerSpeeds({...permitted,roads:indices.map(i=>permitted.roads[i])},indices.map(i=>roads[i]),options.cornerSpeedKmh,baseSpeed);
    cornering=result.cornering;crossingSpeeds=result.crossingSpeeds;roads.forEach(road=>road.nodeSpeeds=road.positions.map(()=>baseSpeed));indices.forEach((i,j)=>roads[i].nodeSpeeds=result.nodeSpeeds[j]);
  }
  const excludedRoads=plan.roads.filter(r=>excluded.has(r.way));
  return {...(excludedRoads.length?{exclusions:{ways:[...new Set(excludedRoads.map(r=>r.way))].sort((a,b)=>a-b),roads:excludedRoads.length,directions:excludedRoads.reduce((n,r)=>n+Number(r.forward)+Number(r.reverse),0)}}:{}),...(continuity?{continuity:{before:continuity.before,retained:continuity.retained,excluded:continuity.excluded}}:{}),...(cornering?{cornering,crossingSpeeds}:{}),density:options.density,...(options.speedKmh===undefined?{}:{speed:options.speedKmh/3.6}),clearance,roads,models:options.models.map(m=>m.table)};
}
