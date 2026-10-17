import {osmArea} from './area.js';

export const terrainZoom=14;
export const terrainName='Terrain Tiles · EU-DEM';
export const terrainDatum='Výškový systém zdrojového EU-DEM není ověřen';
export const terrainAttribution='Mapzen Terrain Tiles · https://registry.opendata.aws/terrain-tiles/\nProduced using Copernicus data and information funded by the European Union - EU-DEM layers.\nPodmínky a zdroje: https://github.com/tilezen/joerd/blob/master/docs/attribution.md\nÚpravy: bilineární převzorkování do místní sítě; herní výšky jsou relativní k minimu oblasti.';
export const terrainTileUrl=(x,y)=>`https://elevation-tiles-prod.s3.amazonaws.com/terrarium/${terrainZoom}/${x}/${y}.png`;
const rad=Math.PI/180,world=256*2**terrainZoom,earth=6371008.8;
// Pixel centres, not PNG image edges. The local projection is the same as OSM.
export function terrainPixel(area,x,z){
  const latitude=area.latitude+z/earth/rad,longitude=area.longitude+x/earth/rad/Math.cos(area.latitude*rad);
  return [(longitude+180)/360*world-.5,(1-Math.asinh(Math.tan(latitude*rad))/Math.PI)/2*world-.5];
}
export function terrainTileCoverage(value){
  const area=osmArea(value),h=area.size/2,p=terrainPixel(area,-h,h),q=terrainPixel(area,h,-h),tiles=[];
  // Include both neighbours used by interpolation, also across tile seams.
  for(let y=Math.floor(Math.floor(p[1])/256);y<=Math.floor((Math.floor(q[1])+1)/256);y++)for(let x=Math.floor(Math.floor(p[0])/256);x<=Math.floor((Math.floor(q[0])+1)/256);x++)tiles.push({x,y});
  if(!tiles.length||tiles.length>16)throw Error('OpenStreetMap · výšky: oblast vyžaduje příliš mnoho dlaždic.');
  return tiles;
}
export const terrainPixelSpacing=area=>Math.cos(area.latitude*rad)*2*Math.PI*6378137/world;
