import {osmSource,osmRoadPlan,osmAttribution,osmPlugin} from './area.js';
import {changeRoadTopology} from '../../core/road-topology.js';
import {parseRoads} from '../../core/roads.js';
import {readEmptyMissionZip,configureEmptyMission,missionName} from '../../core/mission.js';
import {parseFourDs} from '../../core/fourds.js';
import {hash} from '../../core/files.js';
export function osmRoadBytes(plan){
  let data=Buffer.alloc(12);data.writeUInt32LE(2);
  for(const crossing of plan.crossings)data=changeRoadTopology(data,{action:'create-crossing',position:crossing.position,speed:1.2,semaphore:0}).data;
  for(const road of plan.roads)data=changeRoadTopology(data,{action:'connect',from:road.from,to:road.to,positions:road.positions,speed:1.2,forwardEnabled:road.forward,reverseEnabled:road.reverse}).data;
  const file=parseRoads(data);if(file.warnings.length)throw Error('OpenStreetMap: síť se nepodařilo nativně sestavit.');return data;
}
export async function createOsmMission(project,zip,data,area,selected,options){
  const source=osmSource(data,area),plan=osmRoadPlan(source,selected),name=missionName(options?.name),folder=`missions/${name}/`;
  if(project.manifest.assets.some(a=>a.path.toLowerCase().startsWith(folder.toLowerCase())))throw Error('Mise tohoto názvu již existuje.');
  const model=project.asset(options.model),modelBytes=await project.read(model.path);
  if(!parseFourDs(modelBytes).meshes.some(m=>m.type===10))throw Error('Model hráče musí mít kostru.');
  const first=plan.roads[0],start=first.positions[0],files=configureEmptyMission(readEmptyMissionZip(zip),{name,model:model.path,position:[start[0],10,start[2]],heading:0,sun:2,ambient:.4,initializePolice:false,trafficCars:0,pedestrians:0});
  files.set('road.bin',osmRoadBytes(plan));
  const provenance={format:'mafia-workbench-osm-source',version:1,plugin:osmPlugin,attribution:osmAttribution,area:source.area,selected:[...selected],timestamp:source.timestamp,projection:'local-equirectangular; X east, Z north; metres; Y=0',limitations:['No terrain elevations','Road network only; street surfaces/buildings not generated','One default lane per enabled direction; speed 1.2 game units; no automatic population'],data};
  files.set('osm-source.json',Buffer.from(JSON.stringify(provenance)));
  files.set('OSM-ATTRIBUTION.txt',Buffer.from(osmAttribution+'\nSource snapshot and import settings: osm-source.json\n'));
  await project.createFiles([...files].map(([path,data])=>({path:folder+path,data})),`OpenStreetMap: síť ulic ${name}`,[{path:model.path,expectedHash:hash(modelBytes)}],'OpenStreetMap · nová mise');
  return {path:folder+'road.bin',scene:folder+'scene2.bin',crossings:plan.crossings.length,roads:plan.roads.length};
}
