import {osmBuildingPlan} from './buildings.js';
import {osmShellPlan} from './building-shells.js';
import {osmGreenReservation} from './green-areas.js';

// Both passes use the same immutable source. Originals reserve their actual
// bounds and collision budget before complete OSM outlines are filled.
export function osmHybridPlan(source,roads,surface,catalog,options){
  if(options?.mode!=='hybrid')throw Error('OpenStreetMap · budovy: neplatný společný režim.');
  const original=osmBuildingPlan(source,roads,surface,catalog,options),placed=new Set(original.placements.map(p=>p.way));
  const shells=osmShellPlan(source,roads,surface,{...options,mode:'footprint',selected:options.selected.filter(id=>!placed.has(id))},{
    footprints:original.placements.map(p=>[[...p.footprint,p.footprint[0]]]),
    vertices:osmGreenReservation(null,original,catalog),count:original.placements.length,
  });
  return {mode:'hybrid',placements:[...original.placements.map(p=>({...p,method:'original'})),...shells.placements.map(p=>({...p,method:'footprint',fallbackReason:original.skipped.find(s=>s.way===p.way)?.reason}))],skipped:shells.skipped.map(s=>({...s,originalReason:original.skipped.find(o=>o.way===s.way)?.reason}))};
}
