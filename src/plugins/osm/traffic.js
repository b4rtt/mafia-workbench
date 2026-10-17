import {osmCornerSpeeds} from './traffic-speeds.js';
const fail=message=>{throw Error('OpenStreetMap · doprava: '+message);};
export function validateOsmTraffic(options){
  if(!options||![1,2].includes(options.version)||!Number.isInteger(options.density)||options.density<1||options.density>100||!/^[a-f0-9]{64}$/.test(options.tableHash??'')||!Array.isArray(options.models)||!options.models.length||options.models.length>32||new Set(options.models.map(m=>m?.path?.toLowerCase())).size!==options.models.length||options.models.some(m=>typeof m?.path!=='string'||!/^models\/[a-zA-Z0-9_ -]+10\.4ds$/i.test(m.path)||typeof m.table!=='string'||!/^[a-zA-Z0-9_ -]{1,19}$/.test(m.table)||!/^[a-f0-9]{64}$/.test(m.sha256??'')||!Number.isFinite(m.width)||m.width<.5||m.width>5))fail('načtěte katalog aut a vyberte 1–32 rodin; hustota je 1–100.');
  if(options.speedKmh!==undefined&&(!Number.isFinite(options.speedKmh)||options.speedKmh<1||options.speedKmh>50))fail('rychlost musí být 1–50 km/h.');
  if(options.cornerSpeedKmh!==undefined&&(!Number.isFinite(options.cornerSpeedKmh)||options.cornerSpeedKmh<1||options.cornerSpeedKmh>50))fail('rychlost v zatáčkách musí být 1–50 km/h.');
}
// One native traffic lane per permitted direction. Keep the legacy network
// byte-exact when this explicit, versioned feature is absent.
export function osmTrafficPlan(plan,surface,options){
  validateOsmTraffic(options);if(!surface?.profiles||surface.profiles.length!==plan.roads.length)fail('zapněte povrchy ulic.');
  if(surface.elevation&&!plan.elevated)fail('nejdřív usaďte silniční plán na společný výškový podklad.');
  const clearance=Math.max(...options.models.map(m=>m.width))+.4;
  const roads=plan.roads.map((road,index)=>{
    const width=surface.profiles[index]?.width,both=road.forward&&road.reverse;if(!Number.isFinite(width)||width<=0)fail('neplatný profil vozovky.');
    if(width<(both?2:1)*clearance)fail(`ulice ${road.tags.name??road.way} má ${width.toFixed(2)} m; vybraná auta potřebují alespoň ${((both?2:1)*clearance).toFixed(2)} m. Změňte výběr aut/ulic nebo profil vozovky.`);
    // The engine places the first lane at half its stored distance. Version 1
    // treated that field as a centre offset; retain its bytes on saved imports.
    const distance=both?width/(options.version===2?2:4):0,lanes=()=>[{type:2,distance},...Array.from({length:3},()=>({type:0,distance:0}))];
    // The engine smooths sparse road nodes and can cut far across an OSM bend.
    // Retain every mapped point and bound interpolation spans to two metres.
    const chain=[plan.crossings[road.from].position,...road.positions,plan.crossings[road.to].position],positions=[];
    for(let i=1;i<chain.length;i++){const a=chain[i-1],b=chain[i],steps=Math.ceil(Math.hypot(b[0]-a[0],b[2]-a[2])/2);for(let n=1;n<=steps;n++)if(i<chain.length-1||n<steps)positions.push(a.map((v,k)=>Math.fround(v+(b[k]-v)*n/steps)));}
    return {index,way:road.way,width,positions,forward:road.forward,reverse:road.reverse,forwardLanes:lanes(),reverseLanes:lanes()};
  });
  if(roads.reduce((n,r)=>n+r.positions.length,0)>4096)fail('síť potřebuje více než 4096 jízdních bodů; zmenšete oblast nebo výběr ulic.');
  let cornering=null,crossingSpeeds=null;
  if(options.cornerSpeedKmh!==undefined){const result=osmCornerSpeeds(plan,roads,options.cornerSpeedKmh,(options.speedKmh??4.32)/3.6);cornering=result.cornering;crossingSpeeds=result.crossingSpeeds;roads.forEach((road,i)=>road.nodeSpeeds=result.nodeSpeeds[i]);}
  return {...(cornering?{cornering,crossingSpeeds}:{}),density:options.density,...(options.speedKmh===undefined?{}:{speed:options.speedKmh/3.6}),clearance,roads,models:options.models.map(m=>m.table)};
}
