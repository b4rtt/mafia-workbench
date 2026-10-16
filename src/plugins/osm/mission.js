import {osmAmbientPlan,validateOsmAmbient} from './ambient.js';
import {loadOsmAmbientSounds} from './ambient-assets.js';
import {osmPedestrianPlan,osmPedestrianBytes} from './pedestrians.js';
import {loadOsmPedestrianModels} from './pedestrian-assets.js';
import {loadOsmTrafficModels} from './traffic-assets.js';
import {osmTrafficPlan} from './traffic.js';
import {osmSource,osmRoadPlan,osmAttribution,osmPlugin} from './area.js';
import {changeRoadTopology} from '../../core/road-topology.js';
import {parseRoads} from '../../core/roads.js';
import {readEmptyMissionZip,configureEmptyMission,missionName} from '../../core/mission.js';
import {parseFourDs} from '../../core/fourds.js';
import {hash} from '../../core/files.js';
import {osmSurfaceModel} from './surface.js';
import {writeSurfaceModel} from '../../core/surface-model.js';
import {Vector3} from 'three';
import {frameMatrix} from '../../shared/scene-world.js';
import {loadOsmPropModels} from './prop-assets.js';
import {osmPropPlan} from './props.js';
import {changeSceneObject,inspectScene,editScene,editSceneSectorBindings} from '../../core/scene.js';
import {modelCollisionSurface,geometryCollisionResolver} from '../../core/model-collision.js';
import {replaceCollisionSurfaces} from '../../core/collision-surfaces.js';
import {parseCollision} from '../../core/collision.js';
import {surfaceSignature} from '../../core/scene-collision.js';
import {parseBmp} from '../../core/bmp.js';
import {loadOsmBuildingModels} from './building-assets.js';
import {osmBuildingPlan} from './buildings.js';
import {osmShellPlan,osmShellModel} from './building-shells.js';
import {loadOsmShellStyles} from './building-shell-assets.js';
import {osmGreenPlan,osmGreenModel,osmGreenReservation} from './green-areas.js';
import {loadOsmGreenTextures} from './green-assets.js';
export function osmRoadBytes(plan,traffic=null){
  let data=Buffer.alloc(12);data.writeUInt32LE(2);
  for(const crossing of plan.crossings)data=changeRoadTopology(data,{action:'create-crossing',position:crossing.position,speed:1.2,semaphore:0}).data;
  for(const [index,road]of plan.roads.entries())data=changeRoadTopology(data,{action:'connect',from:road.from,to:road.to,positions:traffic?.roads[index].positions??road.positions,speed:1.2,forwardEnabled:road.forward,reverseEnabled:road.reverse,...(traffic?{forwardLanes:traffic.roads[index].forwardLanes,reverseLanes:traffic.roads[index].reverseLanes}:{})}).data;
  const file=parseRoads(data);if(file.warnings.length)throw Error('OpenStreetMap: síť se nepodařilo nativně sestavit.');return data;
}
export async function createOsmMission(project,zip,data,area,selected,options){
  const source=osmSource(data,area),plan=osmRoadPlan(source,selected),name=missionName(options?.name),folder=`missions/${name}/`;
  if(project.manifest.assets.some(a=>a.path.toLowerCase().startsWith(folder.toLowerCase())))throw Error('Mise tohoto názvu již existuje.');
  const model=project.asset(options.model),modelBytes=await project.read(model.path);
  if(!parseFourDs(modelBytes).meshes.some(m=>m.type===10))throw Error('Model hráče musí mít kostru.');
  const first=plan.roads[0],start=first.positions[0],files=configureEmptyMission(readEmptyMissionZip(zip),{name,model:model.path,position:[start[0],10,start[2]],heading:0,sun:2,ambient:.4,initializePolice:false,trafficCars:0,pedestrians:0});
  files.set('road.bin',osmRoadBytes(plan));
  const dependencies=[{path:model.path,expectedHash:hash(modelBytes)}],extra=[],collisions=[],geometry=parseFourDs(files.get('scene.4ds'),true);let ownership=null,surface=null,generated=null,buildings=null,green=null,greenTextures=null,props=null,propCatalog=null,traffic=null,pedestrians=null,ambient=null,ambientSettings=null,buildingCatalog=[];
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
  if(options.traffic!==undefined&&options.traffic!==null){
    const catalog=await loadOsmTrafficModels(project,options.traffic);traffic=osmTrafficPlan(plan,generated,options.traffic);
    const entry=inspectScene(files.get('scene2.bin')).entries.find(e=>e.populationParameter&&e.actorKind===12);
    if(!entry)throw Error('OpenStreetMap · doprava: šablona nemá podporovaný generátor automobilů.');
    files.set('scene2.bin',editScene(files.get('scene2.bin'),entry.id,{budget:traffic.density,models:catalog.models.map(m=>({sourceIndex:null,model:m.table,weight:1,colors:1,flags:[0,0,0,0]}))}));
    files.set('road.bin',osmRoadBytes(plan,traffic));dependencies.push(...catalog.dependencies);
  }
  if(options.buildings!==undefined&&options.buildings!==null){
    const settings=options.buildings;
    if(settings.mode==='footprint'){
      if(!Array.isArray(settings.styles))throw Error('OpenStreetMap · půdorysné domy: načtěte styly fasád znovu.');
      const {styles}=await loadOsmShellStyles(project,settings.styles);
      buildings=osmShellPlan(source,plan,generated,{...settings,styles});
      if(!buildings.placements.length)throw Error('OpenStreetMap · půdorysné domy: žádná vybraná budova nevyhovuje; upravte výběr nebo vypněte budovy.');
      for(const [index,item]of buildings.placements.entries()){
        const modelName=`WB_OSMH_${name}_${index+1}`,modelPath=`models/${modelName}.4ds`,bytes=writeSurfaceModel(osmShellModel(item));
        if(project.manifest.assets.some(a=>a.path.toLowerCase()===modelPath.toLowerCase()))throw Error('Model domu tohoto názvu již existuje. Zvolte jiný název mise.');
        const {scene,object}=add(item.name,modelName+'.i3d',item.position,item.rotation,item.scale);
        collisions.push({...modelCollisionSurface(parseFourDs(bytes,true),object,scene,geometry),doubleSided:false,material:0});extra.push({path:modelPath,data:bytes});item.model=modelPath;
      }
      for(const style of styles.filter(s=>buildings.placements.some(p=>p.style===s.id)))for(const texture of style.textures)dependencies.push({path:texture.path,expectedHash:texture.sha256});
    }else{
      if(settings.mode!==undefined&&settings.mode!=='original')throw Error('OpenStreetMap · budovy: neznámý způsob generování.');
      if(!Array.isArray(settings.models)||settings.models.some(m=>typeof m?.path!=='string'||typeof m.sha256!=='string'))throw Error('OpenStreetMap · budovy: načtěte katalog modelů znovu.');
      const catalog=await loadOsmBuildingModels(project,settings.models.map(m=>m.path));buildingCatalog=catalog.models;
      if(catalog.warnings.length||catalog.models.some(m=>settings.models.find(w=>w.path.toLowerCase()===m.path.toLowerCase())?.sha256!==m.sha256))throw Error('OpenStreetMap · budovy: modely se změnily nebo nejsou dostupné. Načtěte katalog znovu.');
      buildings=osmBuildingPlan(source,plan,generated,catalog.models,settings);
      if(!buildings.placements.length)throw Error('OpenStreetMap · budovy: žádný vybraný dům se nevejde; upravte výběr nebo vypněte budovy.');
      for(const item of buildings.placements){
        const {scene,object}=add(item.name,item.model.slice(7,-4)+'.i3d',item.position,item.rotation,item.scale);
        collisions.push({...modelCollisionSurface(catalog.loaded.get(item.model.toLowerCase()),object,scene,geometry),doubleSided:false,material:0});
      }
      for(const m of catalog.models.filter(m=>buildings.placements.some(p=>p.model===m.path)))dependencies.push({path:m.path,expectedHash:m.sha256});
    }
  }
  if(options.green!==undefined&&options.green!==null){
    if(!generated)throw Error('OpenStreetMap · zeleň: nejdřív zapněte povrchy ulic, aby se zeleň ořízla kolem vozovek a chodníků.');
    green=osmGreenPlan(source,generated,options.green,osmGreenReservation(generated,buildings,buildingCatalog));
    if(!green.placements.length)throw Error('OpenStreetMap · zeleň: žádná vybraná plocha nevyhovuje; upravte výběr nebo vypněte zeleň.');
    greenTextures=await loadOsmGreenTextures(project,options.green);for(const texture of greenTextures)dependencies.push({path:texture.path,expectedHash:texture.sha256});
    for(const[index,item]of green.placements.entries()){
      const modelName=`WB_OSMG_${name}_${index+1}`,modelPath=`models/${modelName}.4ds`,bytes=writeSurfaceModel(osmGreenModel(item));
      if(project.manifest.assets.some(a=>a.path.toLowerCase()===modelPath.toLowerCase()))throw Error('Model zeleně tohoto názvu již existuje. Zvolte jiný název mise.');
      const {scene,object}=add(item.name,modelName+'.i3d',[0,0,0],[1,0,0,0],[1,1,1]);
      collisions.push({...modelCollisionSurface(parseFourDs(bytes,true),object,scene,geometry),doubleSided:false,material:0});extra.push({path:modelPath,data:bytes});item.model=modelPath;
    }
  }
  if(options.props!==undefined&&options.props!==null){
    propCatalog=await loadOsmPropModels(project,options.props.models);
    props=osmPropPlan(source,generated,propCatalog.models,options.props,green,collisions.reduce((n,c)=>n+c.positions.length/3,0));
    if(!props.placements.length)throw Error('OpenStreetMap · osazení: žádný bod nevyhovuje; upravte výběr nebo vypněte osazení.');
    for(const item of props.placements){
      const {scene,object}=add(item.name,item.model.slice(7,-4)+'.i3d',item.position,item.rotation,item.scale);
      collisions.push({...modelCollisionSurface(propCatalog.loaded.get(item.model.toLowerCase()),object,scene,geometry,{opaqueOnly:item.opaqueOnly}),...(item.opaqueOnly?{opaqueOnly:true}:{}),doubleSided:true,material:0});
      if(item.light){
        files.set('scene2.bin',changeSceneObject(files.get('scene2.bin'),{kind:'add-light',...item.light,rotation:[1,0,0,0]},geometry.meshes.map(m=>m.name),geometry.meshes));
        const light=inspectScene(files.get('scene2.bin')).objects.find(o=>o.name===item.light.name),position=new Vector3(...item.light.position).applyMatrix4(frameMatrix(item).invert()).toArray();
        files.set('scene2.bin',editSceneSectorBindings(files.get('scene2.bin'),light.id,{parent:item.name,transform:{position,rotation:[item.rotation[0],0,-item.rotation[2],0],scale:item.scale.map(n=>1/n)}}));
      }
    }
    for(const m of propCatalog.models.filter(m=>props.placements.some(p=>p.model===m.path)))for(const d of [{path:m.path,sha256:m.sha256},...m.textures])dependencies.push({path:d.path,expectedHash:d.sha256});
  }
  if(options.pedestrians!==undefined&&options.pedestrians!==null){
    const catalog=await loadOsmPedestrianModels(project,options.pedestrians);if(options.pedestrians.parkPaths&&!green)throw Error('OpenStreetMap · chodci: pro parkové cesty zapněte zeleň.');pedestrians=osmPedestrianPlan(source,plan,generated,props,options.pedestrians.parkPaths?green:null);
    const entry=inspectScene(files.get('scene2.bin')).entries.find(e=>e.populationParameter&&e.actorKind===18);
    if(!entry)throw Error('OpenStreetMap · chodci: šablona nemá podporovaný generátor chodců.');
    files.set('check.bin',osmPedestrianBytes(pedestrians));
    files.set('scene2.bin',editScene(files.get('scene2.bin'),entry.id,{budget:options.pedestrians.density,models:catalog.models.map(m=>({sourceIndex:null,model:m.model,capacity:options.pedestrians.capacity}))}));
    dependencies.push(...catalog.dependencies);
  }
  if(options.ambient!==undefined&&options.ambient!==null){
    validateOsmAmbient(options.ambient);
    const sounds=await loadOsmAmbientSounds(project,[options.ambient.streets,options.ambient.green].filter(Boolean).map(l=>l.sound));
    ambientSettings={version:1};for(const key of ['streets','green']){const layer=options.ambient[key];if(!layer){ambientSettings[key]=null;continue;}const {path,sha256}=sounds.find(s=>s.path.toLowerCase()===layer.sound.path.toLowerCase());ambientSettings[key]={sound:{path,sha256},spacing:layer.spacing,radius:layer.radius,volume:layer.volume};}
    // Canonical asset paths come from the host; native frames use sounds-relative paths.
    ambient=osmAmbientPlan(source,plan,generated,green,ambientSettings);
    for(const item of ambient.placements)files.set('scene2.bin',changeSceneObject(files.get('scene2.bin'),{kind:'add-sound',name:item.name,position:item.position,rotation:[1,0,0,0],parameters:item.parameters},geometry.meshes.map(m=>m.name),geometry.meshes));
    dependencies.push(...sounds.map(s=>({path:s.path,expectedHash:s.sha256})));
  }
  if(collisions.length){
    const scene=inspectScene(files.get('scene2.bin')),replacement=replaceCollisionSurfaces(files.get('tree.klz'),collisions,{resolveFrame:geometryCollisionResolver(scene,geometry)}),checked=parseCollision(replacement.bytes);
    ownership={path:folder+'scene2.bin',objects:replacement.groups.map(group=>({...group,kind:'mesh',...(collisions.find(c=>c.name===group.name)?.opaqueOnly?{opaqueOnly:true}:{}),signature:surfaceSignature(checked,group)}))};files.set('tree.klz',replacement.bytes);
  }
  const provenance={format:'mafia-workbench-osm-source',version:1,plugin:osmPlugin,attribution:osmAttribution,area:source.area,selected:[...selected],surface:options.surface??null,surfaceProfiles:surface?.profiles??null,...(ambient?{ambient:ambientSettings,ambientPlan:ambient}:{}),...(traffic?{traffic:options.traffic,trafficPlan:traffic}:{}),...(pedestrians?{pedestrians:options.pedestrians,pedestrianPlan:pedestrians}:{}),buildings:options.buildings??null,buildingPlan:buildings,...(green?{green:{...options.green,textures:greenTextures},greenPlan:green}:{}),...(props?{props:{...options.props,models:propCatalog.models.map(({path,sha256,textures})=>({path,sha256,textures}))},propPlan:props}:{}),timestamp:source.timestamp,projection:'local-equirectangular; X east, Z north; metres; Y=0',limitations:[...(ambient?['Manually selected looping mono point sounds on generated streets and green areas; explicit spacing, volume and radius; no OSM acoustic inference, occlusion or randomized mixing']:[]),...(pedestrians?['Ambient civilians follow native check.bin on generated sidewalks and optionally generated public park paths with boundary/obstacle clearance and curb steps up to 0.25m; disconnected surfaces remain separate; no automatic crossings, police or terrain navigation']:[]),...(props?['Mapped point trees and furniture substitute original models; explicit height/direction fallbacks, flat support surfaces; trees collide only on opaque bark; optional lamp lights remain editable children; no forest/row inference or species reconstruction']:[]),...(green?['Mapped planar grass and optional park/garden approximation; supported in-area footpaths use one manual paving material; no inferred vegetation, steps, water or elevation reconstruction']:[]),'No terrain elevations',buildings?.mode==='footprint'?'OSM exterior shells with courtyard walls and roof holes; original facade textures; flat/gabled/skillion roof approximation with explicit source/fallback, no interiors, functional doors, exact landmarks or 3D parts; missing heights estimated':buildings?'Original game houses substituted within OSM ways and complete multipolygon components with holes; one substitute per component, no exact landmark reconstruction or 3D building parts; height estimates only guide model matching':'No buildings generated',surface?`Supported OSM dimensions/sidewalk sides with explicit fallback profiles and optional lane-width estimates; ${green?'footpaths only inside selected green areas':'separate footway geometry not imported'}; planar metric UV; no markings`:'Road network only; street surfaces not generated',traffic?'One lane per enabled direction, offset fitted to carriageway width; speed 1.2 game units, uniform car family weights, one color; no OSM speed/turn restrictions or police initialization':'One default lane per enabled direction; speed 1.2 game units; no automatic cars'],data};
  files.set('osm-source.json',Buffer.from(JSON.stringify(provenance)));
  files.set('OSM-ATTRIBUTION.txt',Buffer.from(osmAttribution+'\nSource snapshot and import settings: osm-source.json\n'));
  const checkedDependencies=[...new Map(dependencies.map(d=>[d.path.toLowerCase(),d])).values()];
  await project.createFiles([...files].map(([path,data])=>({path:folder+path,data})).concat(extra),`OpenStreetMap: ${pedestrians?'chodci · ':''}${traffic?'automobilový provoz · ':''}${props?'osazené město s kolizemi':green?'ulice, zeleň'+(buildings?' a domy':'')+' s kolizemi':buildings?'ulice a budovy s kolizemi':surface?'ulice s kolizemi':'síť ulic'} ${name}`,checkedDependencies,'OpenStreetMap · nová mise',ownership);
  return {path:folder+(surface||buildings?'scene2.bin':'road.bin'),network:folder+'road.bin',scene:folder+'scene2.bin',crossings:plan.crossings.length,roads:plan.roads.length,surface,buildings,...(traffic?{traffic}:{}),...(pedestrians?{pedestrians}:{}),...(green?{green}:{}),...(props?{props}:{}),...(ambient?{ambient}:{})};
}
