import {osmCrossingMarkingPlan,osmCrossingMarkingModel} from './crossing-markings.js';
import {osmWalkwayPlan,osmWalkwayModel} from './walkways.js';
import {loadOsmWalkwayTexture} from './walkway-assets.js';
import {osmAmbientPlan,validateOsmAmbient} from './ambient.js';
import {loadOsmAmbientSounds} from './ambient-assets.js';
import {osmPedestrianPlan,osmPedestrianBytes} from './pedestrians.js';
import {loadOsmPedestrianModels} from './pedestrian-assets.js';
import {loadOsmTrafficModels} from './traffic-assets.js';
import {osmTrafficPlan} from './traffic.js';
import {osmSource,osmRoadPlan,osmAttribution,osmPlugin} from './area.js';
import {changeRoadTopology} from '../../core/road-topology.js';
import {parseRoads,editRoads} from '../../core/roads.js';
import {roadConnections} from '../../shared/roads.js';
import {readEmptyMissionZip,configureEmptyMission,missionName} from '../../core/mission.js';
import {parseFourDs} from '../../core/fourds.js';
import {hash} from '../../core/files.js';
import {osmSurfaceModel} from './surface.js';
import {osmTerrainSurface} from './terrain.js';
import {osmTerrainRoadPlan} from './navigation-elevation.js';
import {osmElevationSource,osmElevationCredit} from './elevation-source.js';
import {osmBuildingFoundation} from './building-terrain.js';
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
  plan=traffic?.network??plan;
  const speed=traffic?.speed??1.2;
  let data=Buffer.alloc(12);data.writeUInt32LE(2);
  for(const [index,crossing]of plan.crossings.entries())data=changeRoadTopology(data,{action:'create-crossing',position:crossing.position,speed:traffic?.crossingSpeeds?.[index]??speed,semaphore:0}).data;
  for(const [index,road]of plan.roads.entries())data=changeRoadTopology(data,{action:'connect',from:road.from,to:road.to,positions:traffic?.roads[index].positions??road.positions,speed,forwardEnabled:traffic?.roads[index].forward??road.forward,reverseEnabled:traffic?.roads[index].reverse??road.reverse,...(traffic?{forwardLanes:traffic.roads[index].forwardLanes,reverseLanes:traffic.roads[index].reverseLanes}:{})}).data;
  if(traffic?.cornering){
    const native=parseRoads(data),changes=[];
    for(const [i,road]of plan.roads.entries()){
      const link=roadConnections(native,road.from).find(link=>link.target===road.to),speeds=traffic.roads[i].nodeSpeeds;
      if(!link||!Array.isArray(speeds)||link.nodes.length!==speeds.length)throw Error('OpenStreetMap · doprava: rychlosti neodpovídají jízdním bodům.');
      link.nodes.forEach((ref,j)=>changes.push({id:`nodes/${ref&32767}/speed`,value:speeds[j]}));
    }
    // The native editor accepts at most 1024 field edits per call; an OSM
    // network can contain 4096 nodes. Keep batches local until publication.
    for(let at=0;at<changes.length;at+=1024)data=editRoads(data,changes.slice(at,at+1024));
  }
  const file=parseRoads(data);if(file.warnings.length)throw Error('OpenStreetMap: síť se nepodařilo nativně sestavit.');return data;
}
export async function createOsmMission(project,zip,data,area,selected,options){
  const source=osmSource(data,area),plan=osmRoadPlan(source,selected),name=missionName(options?.name),folder=`missions/${name}/`;
  const elevation=options.elevation==null?null:osmElevationSource(options.elevation,source.area);let roadPlan=plan;
  if(elevation&&!options.surface)throw Error('OpenStreetMap · terén: výškový rastr vyžaduje povrchy ulic.');
  if(project.manifest.assets.some(a=>a.path.toLowerCase().startsWith(folder.toLowerCase())))throw Error('Mise tohoto názvu již existuje.');
  const model=project.asset(options.model),modelBytes=await project.read(model.path);
  if(!parseFourDs(modelBytes).meshes.some(m=>m.type===10))throw Error('Model hráče musí mít kostru.');
  const first=plan.roads[0],start=first.positions[0],files=configureEmptyMission(readEmptyMissionZip(zip),{name,model:model.path,position:[start[0],10,start[2]],heading:0,sun:2,ambient:.4,initializePolice:false,trafficCars:0,pedestrians:0});
  files.set('road.bin',osmRoadBytes(plan));
  const dependencies=[{path:model.path,expectedHash:hash(modelBytes)}],extra=[],collisions=[],geometry=parseFourDs(files.get('scene.4ds'),true);let ownership=null,surface=null,generated=null,buildings=null,green=null,greenTextures=null,walkways=null,walkwayTexture=null,markings=null,markingResult=null,props=null,propCatalog=null,traffic=null,pedestrians=null,ambient=null,ambientSettings=null,buildingCatalog=[];
  const add=(name,model,position,rotation,scale)=>{
    files.set('scene2.bin',changeSceneObject(files.get('scene2.bin'),{kind:'add-model',name,model,position,rotation,scale},geometry.meshes.map(m=>m.name),geometry.meshes));
    const scene=inspectScene(files.get('scene2.bin'));return {scene,object:scene.objects.find(o=>o.name===name)};
  };
  if(options.surface!==undefined&&options.surface!==null){
    generated=elevation?osmTerrainSurface(plan,source.area,options.surface,elevation):osmSurfaceModel(plan,source.area,options.surface);
    if(elevation){roadPlan=osmTerrainRoadPlan(plan,generated);files.set('road.bin',osmRoadBytes(roadPlan));const player=inspectScene(files.get('scene2.bin')).objects.find(o=>o.name==='Tommy');if(!player)throw Error('OpenStreetMap · terén: šablona nemá hráče Tommy.');const point=roadPlan.roads[0].positions[0];files.set('scene2.bin',editScene(files.get('scene2.bin'),player.fields.position,[point[0],Math.fround(point[1]+1),point[2]]));}
    const modelName=`WB_OSM_${name}`,modelPath=`models/${modelName}.4ds`,bytes=writeSurfaceModel(generated.model);
    if(project.manifest.assets.some(a=>a.path.toLowerCase()===modelPath.toLowerCase()))throw Error('Model povrchu tohoto názvu již existuje. Zvolte jiný název mise.');
    for(const path of [options.surface.roadTexture,options.surface.sidewalkTexture,options.surface.curbTexture,...(elevation?[elevation.groundTexture]:[])]){const asset=project.asset(path),texture=await project.read(asset.path);parseBmp(texture);dependencies.push({path:asset.path,expectedHash:hash(texture)});}
    const {scene,object}=add('OSM_STREETS',modelName+'.i3d',[0,0,0],[1,0,0,0],[1,1,1]);
    collisions.push({...modelCollisionSurface(parseFourDs(bytes,true),object,scene,geometry),doubleSided:false,material:0});
    extra.push({path:modelPath,data:bytes});surface={model:modelPath,triangles:generated.triangles,collisionTriangles:collisions[0].indices.length/3,profiles:generated.profiles,...(generated.corners?{corners:generated.corners}:{})};
  }
  if(options.traffic!==undefined&&options.traffic!==null){
    const catalog=await loadOsmTrafficModels(project,options.traffic);traffic=osmTrafficPlan(roadPlan,generated,options.traffic);
    const entry=inspectScene(files.get('scene2.bin')).entries.find(e=>e.populationParameter&&e.actorKind===12);
    if(!entry)throw Error('OpenStreetMap · doprava: šablona nemá podporovaný generátor automobilů.');
    files.set('scene2.bin',editScene(files.get('scene2.bin'),entry.id,{budget:traffic.density,models:catalog.models.map(m=>({sourceIndex:null,model:m.table,weight:1,colors:1,flags:[0,0,0,0]}))}));
    files.set('road.bin',osmRoadBytes(roadPlan,traffic));dependencies.push(...catalog.dependencies);
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
      for(const [index,item]of buildings.placements.entries()){
        const {scene,object}=add(item.name,item.model.slice(7,-4)+'.i3d',item.position,item.rotation,item.scale);
        collisions.push({...modelCollisionSurface(catalog.loaded.get(item.model.toLowerCase()),object,scene,geometry),doubleSided:false,material:0});
        if(item.support){
          const modelName=`WB_OSMF_${name}_${index+1}`,modelPath=`models/${modelName}.4ds`,bytes=writeSurfaceModel(osmBuildingFoundation(item.support)),baseName=`OSM_FOUNDATION_${index+1}`;
          if(project.manifest.assets.some(a=>a.path.toLowerCase()===modelPath.toLowerCase()))throw Error('Model soklu tohoto názvu již existuje. Zvolte jiný název mise.');
          const base=add(baseName,modelName+'.i3d',[0,0,0],[1,0,0,0],[1,1,1]).object,position=new Vector3().applyMatrix4(frameMatrix(item).invert()).toArray();
          files.set('scene2.bin',editSceneSectorBindings(files.get('scene2.bin'),base.id,{parent:item.name,transform:{position,rotation:[item.rotation[0],0,-item.rotation[2],0],scale:item.scale.map(n=>1/n)}}));
          const bound=inspectScene(files.get('scene2.bin'));
          collisions.push({...modelCollisionSurface(parseFourDs(bytes,true),bound.objects.find(o=>o.name===baseName),bound,geometry),doubleSided:false,material:0});
          extra.push({path:modelPath,data:bytes});item.foundation={name:baseName,model:modelPath};
        }
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
      const modelName=`WB_OSMG_${name}_${index+1}`,modelPath=`models/${modelName}.4ds`,bytes=writeSurfaceModel(osmGreenModel(item,green.elevation));
      if(project.manifest.assets.some(a=>a.path.toLowerCase()===modelPath.toLowerCase()))throw Error('Model zeleně tohoto názvu již existuje. Zvolte jiný název mise.');
      const {scene,object}=add(item.name,modelName+'.i3d',[0,0,0],[1,0,0,0],[1,1,1]);
      collisions.push({...modelCollisionSurface(parseFourDs(bytes,true),object,scene,geometry),doubleSided:false,material:0});extra.push({path:modelPath,data:bytes});item.model=modelPath;
    }
  }
  if(options.walkways!==undefined&&options.walkways!==null){
    if(!generated)throw Error('OpenStreetMap · pěší cesty: zapněte povrchy ulic.');
    walkwayTexture=await loadOsmWalkwayTexture(project,options.walkways);walkways=osmWalkwayPlan(source,generated,green,options.walkways,collisions.reduce((n,c)=>n+c.positions.length/3,0));
    if(!walkways.placements.length)throw Error('OpenStreetMap · pěší cesty: žádná vybraná cesta nevyhovuje; upravte výběr nebo vypněte vrstvu.');
    const item=walkways.placements[0],modelName=`WB_OSMW_${name}`,modelPath=`models/${modelName}.4ds`,bytes=writeSurfaceModel(osmWalkwayModel(item,walkways.elevation));
    if(project.manifest.assets.some(a=>a.path.toLowerCase()===modelPath.toLowerCase()))throw Error('Model pěších cest tohoto názvu již existuje.');
    const {scene,object}=add(item.name,modelName+'.i3d',[0,0,0],[1,0,0,0],[1,1,1]);collisions.push({...modelCollisionSurface(parseFourDs(bytes,true),object,scene,geometry),doubleSided:false,material:0});extra.push({path:modelPath,data:bytes});item.model=modelPath;dependencies.push({path:walkwayTexture.path,expectedHash:walkwayTexture.sha256});
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
  if(options.crossingMarkings!==undefined&&options.crossingMarkings!==null){
    markings=osmCrossingMarkingPlan(source,plan,generated,options.crossingMarkings,props);
    if(!markings.placements.length)throw Error('OpenStreetMap · značení přechodů: žádný přechod nevyhovuje; upravte volby nebo značení vypněte.');
    const placements=[];
    for(const item of markings.placements){
      const modelPath=`models/WB_OSMC_${name}_${item.id}.4ds`;
      if(project.manifest.assets.some(a=>a.path.toLowerCase()===modelPath.toLowerCase()))throw Error('OpenStreetMap · značení přechodů: cílový model již existuje.');
      extra.push({path:modelPath,data:writeSurfaceModel(osmCrossingMarkingModel(item,markings.elevation))});
      add(item.name,modelPath.slice(7,-4)+'.i3d',item.position,[1,0,0,0],[1,1,1]);
      const {polygons,footprint,...metadata}=item;placements.push({...metadata,model:modelPath});
    }
    markingResult={placements,skipped:markings.skipped,triangles:markings.triangles};
  }
  if(options.pedestrians!==undefined&&options.pedestrians!==null){
    const catalog=await loadOsmPedestrianModels(project,options.pedestrians);if(options.pedestrians.parkPaths&&!green)throw Error('OpenStreetMap · chodci: pro parkové cesty zapněte zeleň.');if(options.pedestrians.walkways&&!walkways)throw Error('OpenStreetMap · chodci: zapněte samostatné pěší cesty.');pedestrians=osmPedestrianPlan(source,plan,generated,props,options.pedestrians.parkPaths?green:null,{crossings:options.pedestrians.crossings},options.pedestrians.walkways?walkways:null);
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
  if(elevation&&collisions.reduce((n,c)=>n+c.positions.length/3,0)>60000)throw Error('OpenStreetMap · terén: společné kolize města přesahují 60 000 vrcholů; zmenšete oblast nebo vrstvy.');
  if(collisions.length){
    const scene=inspectScene(files.get('scene2.bin')),replacement=replaceCollisionSurfaces(files.get('tree.klz'),collisions,{resolveFrame:geometryCollisionResolver(scene,geometry)}),checked=parseCollision(replacement.bytes);
    ownership={path:folder+'scene2.bin',objects:replacement.groups.map(group=>({...group,kind:'mesh',...(collisions.find(c=>c.name===group.name)?.opaqueOnly?{opaqueOnly:true}:{}),signature:surfaceSignature(checked,group)}))};files.set('tree.klz',replacement.bytes);
  }
  // The immutable field contains sampling functions used only during planning.
  // Publish the numeric source once at the root, never functions over Electron IPC.
  const greenResult=green?.elevation?Object.fromEntries(Object.entries(green).filter(([key])=>key!=='elevation')):green;
  const walkwayResult=walkways?.elevation?Object.fromEntries(Object.entries(walkways).filter(([key])=>key!=='elevation')):walkways;
  const trafficDescription=options.traffic?.version===3?`${traffic.turns?`Explicit tangent navigation connectors with radius ${traffic.turns.radius}m; ${traffic.turns.elevated?'axes and turn chords sampled on the common terrain triangles; ':''}sampled plan-view body containment, no pitch/roll, suspension, steering or collision avoidance simulation; original street dimensions retained. `:''}${traffic.exclusions?`Manual ambient-traffic exclusions: ${traffic.exclusions.ways.join(', ')}; street surfaces, collisions and special-AI metadata retained. `:''}${traffic.continuity?`Ambient directions leading to a circuit only: ${traffic.continuity.retained}/${traffic.continuity.before} retained; ${traffic.continuity.excluded} terminal directions remain AI-only; no traffic priority or swept-body guarantee. `:''}One ambient lane per ${traffic.continuity?'retained':'permitted'} OSM direction; width-fitted offset; AI-only reciprocal lane metadata on one-way streets allows special AI to use the opposite direction; manual network target ${traffic.speed??1.2} m/s${traffic.cornering?`; optional corner cap ${traffic.cornering.speedKmh} km/h with a 12m zone and 1.5m/s2 graph-distance ramp; shared junction caps also affect through traffic`:''}; uniform car family weights, one color; no vehicle-specific swept-body guarantee, OSM speed/turn restrictions or police initialization`:traffic?.cornering?`One lane per enabled direction; manual maximum target ${traffic.speed??1.2} m/s; optional corner cap ${traffic.cornering.speedKmh} km/h with a 12m zone and 1.5m/s2 graph-distance ramp; junction caps also affect through traffic; no vehicle-specific swept-body guarantee or OSM speed/turn restrictions`:'One lane per enabled direction, offset fitted to carriageway width; speed 1.2 game units, uniform car family weights, one color; no OSM speed/turn restrictions or police initialization';
  const provenance={format:'mafia-workbench-osm-source',version:1,plugin:osmPlugin,attribution:osmAttribution,area:source.area,selected:[...selected],...(elevation?{elevation}:{}),surface:options.surface??null,surfaceProfiles:surface?.profiles??null,...(markings?{crossingMarkings:options.crossingMarkings,crossingMarkingPlan:markingResult}:{}),...(walkways?{walkways:{...options.walkways,texture:walkwayTexture.path,textureHash:walkwayTexture.sha256},walkwayPlan:walkwayResult}:{}),...(ambient?{ambient:ambientSettings,ambientPlan:ambient}:{}),...(traffic?{traffic:options.traffic,trafficPlan:traffic}:{}),...(pedestrians?{pedestrians:options.pedestrians,pedestrianPlan:pedestrians}:{}),buildings:options.buildings??null,buildingPlan:buildings,...(green?{green:{...options.green,textures:greenTextures},greenPlan:greenResult}:{}),...(props?{props:{...options.props,models:propCatalog.models.map(({path,sha256,textures})=>({path,sha256,textures}))},propPlan:props}:{}),timestamp:source.timestamp,projection:elevation?'local-equirectangular; X east, Z north; metres; Y=base+sample-minimum; triangular grid':'local-equirectangular; X east, Z north; metres; Y=0',limitations:[...(ambient?['Manually selected looping mono point sounds on generated streets and green areas; explicit spacing, volume and radius; no OSM acoustic inference, occlusion or randomized mixing']:[]),...(pedestrians?['Ambient civilians follow native check.bin on generated sidewalks and optionally generated public park paths with boundary/obstacle clearance and curb steps up to 0.25m; disconnected surfaces remain separate; optional mapped uncontrolled crossings with a perpendicular/3m fallback, no crossing paint, signals, refuge islands, traffic priority, police or terrain navigation']:[]),...(props?['Mapped point trees and furniture substitute original models; explicit height/direction fallbacks, flat support surfaces; trees collide only on opaque bark; optional lamp lights remain editable children; no forest/row inference or species reconstruction']:[]),...(green?['Mapped planar grass and optional park/garden approximation; supported in-area footpaths use one manual paving material; no inferred vegetation, steps, water or elevation reconstruction']:[]),'No terrain elevations',buildings?.mode==='footprint'?'OSM exterior shells with courtyard walls and roof holes; original facade textures; flat/gabled/skillion roof approximation with explicit source/fallback, no interiors, functional doors, exact landmarks or 3D parts; missing heights estimated':buildings?'Original game houses substituted within OSM ways and complete multipolygon components with holes; one substitute per component, no exact landmark reconstruction or 3D building parts; height estimates only guide model matching':'No buildings generated',surface?`Supported OSM dimensions/sidewalk sides with explicit fallback profiles and optional lane-width estimates; ${walkways?'separate mapped pedestrian ways clipped outside streets, buildings and generated green areas':green?'footpaths only inside selected green areas':'separate footway geometry not imported'}; planar metric UV; no markings`:'Road network only; street surfaces not generated',traffic?trafficDescription:'One default lane per enabled direction; speed 1.2 game units; no automatic cars'],data};
  if(elevation)provenance.limitations=[
    'Local numeric elevation snapshot; source accuracy, datum and attribution declared by its author; no provider download, bridge/tunnel layers, automatic terracing or inferred elevation detail',
    ...(buildings?['Exterior houses with horizontal bases and terrain foundations up to 3m; original models remain rigid; no interiors or functional doors']:[]),
    ...(green?['Mapped grass and optional park approximation follow the common triangular field; one paving material; no inferred vegetation, steps or water']:[]),
    ...(props?['Upright original furniture and trees on full-base local support; excessive slopes skipped; bark-only tree collision; optional editable child lamp lights']:[]),
    ...(pedestrians?['Native pedestrian routes on actual sidewalks and optional park paths/crossings; bounded clearance and steps, disconnected surfaces stay separate; no traffic priority or signals']:[]),
    ...(traffic?['Native road heights follow the shared field; original one-lane traffic approximations and no speed/turn restrictions or police initialization']:[]),
    ...(traffic?.cornering||options.traffic?.version===3?[trafficDescription]:[]),
    ...(ambient?['Manually selected mono point sounds 1.5m above the common surfaces; no acoustic inference or occlusion']:[]),
    'Street profiles and model choices remain approximations; no road markings or exact landmarks'
  ];
  if(walkways)provenance.limitations.push((options.pedestrians?.walkways?'Native pedestrian navigation also includes these standalone paths; ':'Standalone path navigation not enabled; ')+'Selected public linear footway/path/pedestrian surfaces outside generated streets, buildings and green areas; one manual paving material and width fallback; shared terrain; no bridges, tunnels, other levels, pedestrian areas, crossing strips, stairs, side curbs or inferred missing connections');
  if(generated?.corners)provenance.limitations.push('Requested inner road-corner radius is limited by adjacent edges and at least 0.5m clearance to the unchanged outer street boundary; may narrow sidewalks; islands and disconnected street components are preserved; native driving paths are unchanged and vehicle swept-body clearance is not guaranteed');
  if(markings){
    provenance.limitations=provenance.limitations.map(s=>s.replace('no crossing paint, signals','no signals').replace('; no markings','; crossing paint only').replace('no road markings or exact landmarks','no other road markings or exact landmarks'));
    provenance.limitations.push('Uncontrolled zebra crossings only, explicit OSM pattern or manually enabled fallback; white 0.5m bars/gaps and 0.25m road-edge inset are approximations; independent editable models 0.012m above actual road triangles, no paint collisions, signals, islands, ramps, traffic priority or automatic pedestrian navigation');
  }
  const sourceBytes=Buffer.from(JSON.stringify(provenance));if(elevation&&sourceBytes.length>8*1024*1024)throw Error('OpenStreetMap · terén: uložený podklad přesahuje 8 MB; zmenšete oblast nebo rastr.');
  files.set('osm-source.json',sourceBytes);
  files.set('OSM-ATTRIBUTION.txt',Buffer.from(osmAttribution+'\n'+(elevation?osmElevationCredit(elevation):'')+'Source snapshot and import settings: osm-source.json\n'));
  const checkedDependencies=[...new Map(dependencies.map(d=>[d.path.toLowerCase(),d])).values()];
  await project.createFiles([...files].map(([path,data])=>({path:folder+path,data})).concat(extra),`OpenStreetMap: ${pedestrians?'chodci · ':''}${traffic?'automobilový provoz · ':''}${props?'osazené město s kolizemi':green?'ulice, zeleň'+(buildings?' a domy':'')+' s kolizemi':buildings?'ulice a budovy s kolizemi':surface?'ulice s kolizemi':'síť ulic'} ${name}`,checkedDependencies,'OpenStreetMap · nová mise',ownership);
  return {...(elevation?{elevation}:{}),path:folder+(surface||buildings?'scene2.bin':'road.bin'),network:folder+'road.bin',scene:folder+'scene2.bin',crossings:plan.crossings.length,roads:plan.roads.length,surface,buildings,...(markings?{crossingMarkings:markingResult}:{}),...(walkways?{walkways:walkwayResult}:{}),...(traffic?{traffic}:{}),...(pedestrians?{pedestrians}:{}),...(green?{green:greenResult}:{}),...(props?{props}:{}),...(ambient?{ambient}:{})};
}
