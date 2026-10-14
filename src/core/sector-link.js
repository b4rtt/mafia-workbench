import {parseFourDs} from './fourds.js';
import {inspectScene} from './scene.js';
import {sceneWorld} from './model-collision.js';
import {sectorLinkPlan} from '../shared/sector-link.js';
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
