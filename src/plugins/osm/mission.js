import {osmSource,osmRoadPlan,osmAttribution,osmPlugin} from './area.js';
import {changeRoadTopology} from '../../core/road-topology.js';
import {parseRoads} from '../../core/roads.js';
import {readEmptyMissionZip,configureEmptyMission,missionName} from '../../core/mission.js';
import {parseFourDs} from '../../core/fourds.js';
import {hash} from '../../core/files.js';
import {osmSurfaceModel} from './surface.js';
import {writeSurfaceModel} from '../../core/surface-model.js';
import {changeSceneObject,inspectScene} from '../../core/scene.js';
import {modelCollisionSurface,geometryCollisionResolver} from '../../core/model-collision.js';
import {replaceCollisionSurfaces} from '../../core/collision-surfaces.js';
import {parseCollision} from '../../core/collision.js';
import {surfaceSignature} from '../../core/scene-collision.js';
import {parseBmp} from '../../core/bmp.js';
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
  const dependencies=[{path:model.path,expectedHash:hash(modelBytes)}],extra=[];let ownership=null,surface=null;
  if(options.surface!==undefined&&options.surface!==null){
    const generated=osmSurfaceModel(plan,source.area,options.surface),modelName=`WB_OSM_${name}`,modelPath=`models/${modelName}.4ds`,bytes=writeSurfaceModel(generated.model),geometry=parseFourDs(files.get('scene.4ds'),true);
    if(project.manifest.assets.some(a=>a.path.toLowerCase()===modelPath.toLowerCase()))throw Error('Model povrchu tohoto názvu již existuje. Zvolte jiný název mise.');
    for(const path of [options.surface.roadTexture,options.surface.sidewalkTexture,options.surface.curbTexture]){const asset=project.asset(path),texture=await project.read(asset.path);parseBmp(texture);dependencies.push({path:asset.path,expectedHash:hash(texture)});}
    const sceneBytes=changeSceneObject(files.get('scene2.bin'),{kind:'add-model',name:'OSM_STREETS',model:modelName+'.i3d',position:[0,0,0],rotation:[1,0,0,0],scale:[1,1,1]},geometry.meshes.map(m=>m.name),geometry.meshes),scene=inspectScene(sceneBytes),object=scene.objects.find(o=>o.name==='OSM_STREETS');
    const collision={...modelCollisionSurface(parseFourDs(bytes,true),object,scene,geometry),doubleSided:false,material:0},replacement=replaceCollisionSurfaces(files.get('tree.klz'),[collision],{resolveFrame:geometryCollisionResolver(scene,geometry)}),checked=parseCollision(replacement.bytes);
    ownership={path:folder+'scene2.bin',objects:replacement.groups.map(group=>({...group,kind:'mesh',signature:surfaceSignature(checked,group)}))};
    files.set('scene2.bin',sceneBytes);files.set('tree.klz',replacement.bytes);extra.push({path:modelPath,data:bytes});surface={model:modelPath,triangles:generated.triangles,collisionTriangles:replacement.groups.reduce((n,g)=>n+g.triangleCount,0)};
  }
  const provenance={format:'mafia-workbench-osm-source',version:1,plugin:osmPlugin,attribution:osmAttribution,area:source.area,selected:[...selected],surface:options.surface??null,timestamp:source.timestamp,projection:'local-equirectangular; X east, Z north; metres; Y=0',limitations:['No terrain elevations or buildings',surface?'Uniform street/sidewalk dimensions selected by user; OSM width/sidewalk tags retained but not applied; planar metric UV; no markings':'Road network only; street surfaces not generated','One default lane per enabled direction; speed 1.2 game units; no automatic population'],data};
  files.set('osm-source.json',Buffer.from(JSON.stringify(provenance)));
  files.set('OSM-ATTRIBUTION.txt',Buffer.from(osmAttribution+'\nSource snapshot and import settings: osm-source.json\n'));
  await project.createFiles([...files].map(([path,data])=>({path:folder+path,data})).concat(extra),`OpenStreetMap: ${surface?'ulice s kolizemi':'síť ulic'} ${name}`,dependencies,'OpenStreetMap · nová mise',ownership);
  return {path:folder+(surface?'scene2.bin':'road.bin'),network:folder+'road.bin',scene:folder+'scene2.bin',crossings:plan.crossings.length,roads:plan.roads.length,surface};
}
