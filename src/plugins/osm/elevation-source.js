import {hash} from '../../core/files.js';
import {osmElevationGrid} from './elevation.js';

const fail=m=>{throw Error('OpenStreetMap · zdroj výšek: '+m);};
const text=(v,max)=>typeof v==='string'&&v.trim().length>0&&v.length<=max&&!/[\x00-\x08\x0b-\x1f\x7f]/.test(v);
// Host-only local numeric snapshots. This does not claim provider accuracy,
// download data or infer a datum/license from an arbitrary URL or filename.
function snapshot(input,area){
  const field=osmElevationGrid(input,area),s=input.source;
  if(s?.kind!=='local-grid'||!text(s.name,256)||!text(s.attribution,4096)||!text(s.verticalDatum,256)||!Number.isFinite(s.resolution)||s.resolution<.01||s.resolution>10000||typeof s.acquiredAt!=='string'||!Number.isFinite(Date.parse(s.acquiredAt))||new Date(s.acquiredAt).toISOString()!==s.acquiredAt)fail('uveďte název, atribuci, výškový systém, rozlišení a datum místního rastru.');
  if(typeof input.groundTexture!=='string'||!/^maps\/[\x20-\x7e]+\.bmp$/i.test(input.groundTexture)||/[\\/:*?"<>|]/.test(input.groundTexture.slice(5))||input.groundTexture.slice(5).length>120||!Number.isFinite(input.groundTileSize)||input.groundTileSize<.25||input.groundTileSize>20)fail('neplatná BMP textura nebo opakování podkladu.');
  return {version:1,area:Object.fromEntries(['latitude','longitude','size'].map(k=>[k,field.area[k]])),columns:field.columns,rows:field.rows,base:field.base,samples:[...field.samples],groundTexture:input.groundTexture,groundTileSize:input.groundTileSize,source:{kind:'local-grid',name:s.name,attribution:s.attribution,verticalDatum:s.verticalDatum,resolution:s.resolution,acquiredAt:s.acquiredAt}};
}
export const osmElevationDigest=(input,area)=>hash(Buffer.from(JSON.stringify(snapshot(input,area))));
export function osmElevationSource(input,area){
  const value=snapshot(input,area),sha256=hash(Buffer.from(JSON.stringify(value)));
  if(input.sha256!==sha256)fail('rastr nebo jeho popis se změnil; kontrolní součet nesouhlasí.');
  return {...value,sha256};
}
