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
import {loadOsmBuildingModels} from './building-assets.js';
import {osmBuildingPlan} from './buildings.js';
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
  const dependencies=[{path:model.path,expectedHash:hash(modelBytes)}],extra=[],collisions=[],geometry=parseFourDs(files.get('scene.4ds'),true);let ownership=null,surface=null,generated=null,buildings=null;
  const add=(name,model,position,rotation,scale)=>{
    files.set('scene2.bin',changeSceneObject(files.get('scene2.bin'),{kind:'add-model',name,model,position,rotation,scale},geometry.meshes.map(m=>m.name),geometry.meshes));
    const scene=inspectScene(files.get('scene2.bin'));return {scene,object:scene.objects.find(o=>o.name===name)};
  };
  if(options.surface!==undefined&&options.surface!==null){
    generated=osmSurfaceModel(plan,source.area,options.surface);
    const modelName=`WB_OSM_${name}`,modelPath=`models/${modelName}.4ds`,bytes=writeSurfaceModel(generated.model);
    if(project.manifest.assets.some(a=>a.path.toLowerCase()===modelPath.toLowerCase()))throw Error('Model povrchu tohoto názvu již existuje. Zvolte jiný název mise.');
    for(const path of [options.surface.roadTexture,options.surface.sidewalkTexture,options.surface.curbTexture]){const asset=project.asset(path),texture=await project.read(asset.path);parseBmp(texture);dependencies.push({path:asset.path,expectedHash:hash(texture)});}
    const {scene,object}=add('OSM_STREETS',modelName+'.i3d',[0,0,0],[1,0,0,0],[1,1,1]);
    collisions.push({...modelCollisionSurface(parseFourDs(bytes,true),object,scene,geometry),doubleSided:false,material:0});
    extra.push({path:modelPath,data:bytes});surface={model:modelPath,triangles:generated.triangles,collisionTriangles:collisions[0].indices.length/3,profiles:generated.profiles};
  }
  if(options.buildings!==undefined&&options.buildings!==null){
    const settings=options.buildings;
    if(!Array.isArray(settings.models)||settings.models.some(m=>typeof m?.path!=='string'||typeof m.sha256!=='string'))throw Error('OpenStreetMap · budovy: načtěte katalog modelů znovu.');
    const catalog=await loadOsmBuildingModels(project,settings.models.map(m=>m.path));
    if(catalog.warnings.length||catalog.models.some(m=>settings.models.find(w=>w.path.toLowerCase()===m.path.toLowerCase())?.sha256!==m.sha256))throw Error('OpenStreetMap · budovy: modely se změnily nebo nejsou dostupné. Načtěte katalog znovu.');
    buildings=osmBuildingPlan(source,plan,generated,catalog.models,settings);
    if(!buildings.placements.length)throw Error('OpenStreetMap · budovy: žádný vybraný dům se nevejde; upravte výběr nebo vypněte budovy.');
    for(const item of buildings.placements){
      const {scene,object}=add(item.name,item.model.slice(7,-4)+'.i3d',item.position,item.rotation,item.scale);
      collisions.push({...modelCollisionSurface(catalog.loaded.get(item.model.toLowerCase()),object,scene,geometry),doubleSided:false,material:0});
    }
    for(const m of catalog.models.filter(m=>buildings.placements.some(p=>p.model===m.path)))dependencies.push({path:m.path,expectedHash:m.sha256});
  }
  if(collisions.length){
    const scene=inspectScene(files.get('scene2.bin')),replacement=replaceCollisionSurfaces(files.get('tree.klz'),collisions,{resolveFrame:geometryCollisionResolver(scene,geometry)}),checked=parseCollision(replacement.bytes);
    ownership={path:folder+'scene2.bin',objects:replacement.groups.map(group=>({...group,kind:'mesh',signature:surfaceSignature(checked,group)}))};files.set('tree.klz',replacement.bytes);
  }
  const provenance={format:'mafia-workbench-osm-source',version:1,plugin:osmPlugin,attribution:osmAttribution,area:source.area,selected:[...selected],surface:options.surface??null,surfaceProfiles:surface?.profiles??null,buildings:options.buildings??null,buildingPlan:buildings,timestamp:source.timestamp,projection:'local-equirectangular; X east, Z north; metres; Y=0',limitations:['No terrain elevations',buildings?'Original game houses substituted within standalone OSM outlines; no exact landmark reconstruction or multipart buildings; height estimates only guide model matching':'No buildings generated',surface?'Supported OSM dimensions/sidewalk sides with explicit fallback profiles and optional lane-width estimates; separate footway geometry not imported; planar metric UV; no markings':'Road network only; street surfaces not generated','One default lane per enabled direction; speed 1.2 game units; no automatic population'],data};
  files.set('osm-source.json',Buffer.from(JSON.stringify(provenance)));
  files.set('OSM-ATTRIBUTION.txt',Buffer.from(osmAttribution+'\nSource snapshot and import settings: osm-source.json\n'));
  await project.createFiles([...files].map(([path,data])=>({path:folder+path,data})).concat(extra),`OpenStreetMap: ${buildings?'ulice a budovy s kolizemi':surface?'ulice s kolizemi':'síť ulic'} ${name}`,dependencies,'OpenStreetMap · nová mise',ownership);
  return {path:folder+(surface||buildings?'scene2.bin':'road.bin'),network:folder+'road.bin',scene:folder+'scene2.bin',crossings:plan.crossings.length,roads:plan.roads.length,surface,buildings};
}
