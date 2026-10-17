import {hash} from '../../core/files.js';
import {osmElevationGrid} from './elevation.js';
import {terrainName,terrainDatum,terrainAttribution,terrainZoom,terrainTileUrl,terrainTileCoverage,terrainPixelSpacing} from './terrarium-grid.js';

const fail=m=>{throw Error('OpenStreetMap · zdroj výšek: '+m);};
const text=(v,max)=>typeof v==='string'&&v.trim().length>0&&v.length<=max&&!/[\x00-\x08\x0b-\x1f\x7f]/.test(v);
const date=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
export const terrainImagery=value=>typeof value==='string'&&value.length<=2048&&value.split(',').every(v=>/^eudem\/[A-Za-z0-9_-]+\.tif$/.test(v.trim()));
function provenance(s,area){
  if(s?.kind==='terrain-tiles-eudem'){
    const coverage=terrainTileCoverage(area);
    if(s.name!==terrainName||s.attribution!==terrainAttribution||s.verticalDatum!==terrainDatum||s.resolution!==30||s.zoom!==terrainZoom||s.pixelSpacing!==terrainPixelSpacing(area)||!date(s.acquiredAt)||!Array.isArray(s.tiles)||s.tiles.length!==coverage.length)fail('neplatný popis Terrain Tiles EU-DEM.');
    const tiles=s.tiles.map((t,i)=>{
      const {x,y}=coverage[i];
      if(!t||t.x!==x||t.y!==y||t.url!==terrainTileUrl(x,y)||!terrainImagery(t.imagery)||!date(t.acquiredAt)||t.acquiredAt>s.acquiredAt||t.modifiedAt!==null&&!date(t.modifiedAt)||!Number.isInteger(t.bytes)||t.bytes<57||t.bytes>1024*1024||typeof t.sha256!=='string'||!/^[a-f0-9]{64}$/.test(t.sha256))fail('neplatný původ nebo pokrytí výškové dlaždice.');
      return {x,y,url:t.url,imagery:t.imagery,acquiredAt:t.acquiredAt,modifiedAt:t.modifiedAt,bytes:t.bytes,sha256:t.sha256};
    });
    return {kind:s.kind,name:s.name,attribution:s.attribution,verticalDatum:s.verticalDatum,resolution:30,acquiredAt:s.acquiredAt,zoom:terrainZoom,pixelSpacing:s.pixelSpacing,tiles};
  }
  if(s?.kind!=='local-grid'||!text(s.name,256)||!text(s.attribution,4096)||!text(s.verticalDatum,256)||!Number.isFinite(s.resolution)||s.resolution<.01||s.resolution>10000||!date(s.acquiredAt))fail('uveďte název, atribuci, výškový systém, rozlišení a datum místního rastru.');
  return {kind:'local-grid',name:s.name,attribution:s.attribution,verticalDatum:s.verticalDatum,resolution:s.resolution,acquiredAt:s.acquiredAt};
}
// A checksum guarantees snapshot consistency, not provider authenticity/accuracy.
function snapshot(input,area){
  const field=osmElevationGrid(input,area),source=provenance(input.source,field.area);
  if(typeof input.groundTexture!=='string'||!/^maps\/[\x20-\x7e]+\.bmp$/i.test(input.groundTexture)||/[\\/:*?"<>|]/.test(input.groundTexture.slice(5))||input.groundTexture.slice(5).length>120||!Number.isFinite(input.groundTileSize)||input.groundTileSize<.25||input.groundTileSize>20)fail('neplatná BMP textura nebo opakování podkladu.');
  return {version:1,area:Object.fromEntries(['latitude','longitude','size'].map(k=>[k,field.area[k]])),columns:field.columns,rows:field.rows,base:field.base,samples:[...field.samples],groundTexture:input.groundTexture,groundTileSize:input.groundTileSize,source};
}
export const osmElevationDigest=(input,area)=>hash(Buffer.from(JSON.stringify(snapshot(input,area))));
export function osmElevationSource(input,area){
  const value=snapshot(input,area),sha256=hash(Buffer.from(JSON.stringify(value)));
  if(input.sha256!==sha256)fail('rastr nebo jeho popis se změnil; kontrolní součet nesouhlasí.');
  return {...value,sha256};
}
export function osmElevationCredit(elevation){
  const s=elevation.source,lines=[`Elevation: ${s.name}`,s.attribution,`Datum: ${s.verticalDatum}; resolution: ${s.resolution}m; acquired: ${s.acquiredAt}`,`Snapshot SHA-256: ${elevation.sha256}`];
  if(s.kind==='terrain-tiles-eudem'){
    lines.push(`Terrain Tiles accessed ${[...new Set(s.tiles.map(t=>t.acquiredAt.slice(0,10)))].join(', ')} from https://registry.opendata.aws/terrain-tiles/`,`Nominal source resolution: 30m; output grid spacing: ${elevation.area.size/elevation.columns}m. Pixel/grid spacing is not measurement accuracy.`);
    for(const t of s.tiles)lines.push(t.url,`Sources: ${t.imagery}; fetched: ${t.acquiredAt}; tile modified: ${t.modifiedAt??'unknown'}; SHA-256: ${t.sha256}`);
  }
  return lines.join('\n')+'\n';
}
