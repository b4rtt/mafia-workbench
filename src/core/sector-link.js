import {parseFourDs} from './fourds.js';
import {inspectScene} from './scene.js';
import {sceneWorld} from './model-collision.js';
import {sectorLinkPlan,sectorPortalPairPlan} from '../shared/sector-link.js';
import {editSectorGeometry} from './sector-geometry.js';

export function inspectSectorLinks(source,sceneSource,mesh){
  const geometry=parseFourDs(source,true),scene=inspectScene(sceneSource),world=sceneWorld(scene,geometry),sectors=geometry.meshes.filter(m=>m.sector).map(m=>({...m,worldMatrix:world(m.name).toArray()}));
  if(!Number.isInteger(mesh)||!sectors.some(s=>s.id===mesh))throw new Error('Vyberte sektor geometrie mise.');return {sourceId:mesh,sectors};
}
export function linkSectorPortal(source,sceneSource,request){
  const context=inspectSectorLinks(source,sceneSource,request?.mesh),plan=sectorLinkPlan(context,request);if(plan.already)return Buffer.from(source);
  const sector=context.sectors.find(s=>s.id===plan.target).sector,portals=sector.portals.map((_,source)=>({source}));portals.push({positions:plan.positions});
  return editSectorGeometry(source,{mesh:plan.target,sector:{portals}});
}

export function changeSectorPortalPair(source,sceneSource,request){
  const context=inspectSectorLinks(source,sceneSource,request?.mesh),plan=sectorPortalPairPlan(context,request);if(plan.unchanged)return Buffer.from(source);
  let result=Buffer.from(source);
  for(const [mesh,index,positions] of [[request.mesh,request.portal,plan.sourcePositions],[plan.target,plan.targetPortal,plan.positions]]){
    const original=context.sectors.find(s=>s.id===mesh).sector.portals;
    const portals=original.flatMap((_,source)=>source===index?(request.kind==='remove'?[]:[{source,positions}]):[{source}]);
    result=editSectorGeometry(result,{mesh,sector:{portals}});
  }
  if(request.kind==='update'){
    const linked=sectorLinkPlan(inspectSectorLinks(result,sceneSource,request.mesh),{mesh:request.mesh,portal:request.portal,target:request.target});
    if(!linked.already||linked.targetPortal!==plan.targetPortal)throw new Error('Spojení sektorů: uložený protikus neodpovídá otvoru.');
  }
  return result;
}
