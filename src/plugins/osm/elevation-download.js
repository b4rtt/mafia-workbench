import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {hash} from '../../core/files.js';
import {osmArea} from './area.js';
import {osmElevationDigest,osmElevationSource,terrainImagery} from './elevation-source.js';
import {decodeTerrariumPng} from './terrarium-png.js';
import {terrainName,terrainDatum,terrainAttribution,terrainZoom,terrainTileUrl,terrainTileCoverage,terrainPixel,terrainPixelSpacing} from './terrarium-grid.js';

const limit=1024*1024,fail=m=>{throw Error('OpenStreetMap · výšky: '+m);};
const iso=value=>new Date(value).toISOString();
async function readLimited(filename,max){const stat=await fs.stat(filename);if(!stat.isFile()||stat.size>max)throw Error('cache size');return fs.readFile(filename);}
async function publish(filename,bytes){const tmp=filename+'.'+randomUUID()+'.tmp';try{await fs.writeFile(tmp,bytes,{flag:'wx'});await fs.rename(tmp,filename);}finally{await fs.rm(tmp,{force:true});}}
async function tile(x,y,{cacheRoot,fetcher,signal,acquiredAt}){
  const url=terrainTileUrl(x,y),key=`${terrainZoom}-${x}-${y}`,filename=cacheRoot&&path.join(cacheRoot,key),cached=filename&&await (async()=>{
    try{
      const meta=JSON.parse((await readLimited(filename+'.json',4096)).toString('utf8')),bytes=await readLimited(filename+'.png',limit);
      // Validate the entire canonical provenance with the same rules as a saved
      // import, below. An invalid cache is discarded, never treated as flat land.
      if(meta.x!==x||meta.y!==y||meta.url!==url||meta.bytes!==bytes.length||meta.sha256!==hash(bytes)||!terrainImagery(meta.imagery)||!Number.isFinite(Date.parse(meta.acquiredAt))||iso(meta.acquiredAt)!==meta.acquiredAt||meta.acquiredAt>acquiredAt||meta.modifiedAt!==null&&(!Number.isFinite(Date.parse(meta.modifiedAt))||iso(meta.modifiedAt)!==meta.modifiedAt))return null;
      return {meta,samples:decodeTerrariumPng(bytes),cached:true};
    }catch{return null;}
  })();
  if(cached)return cached;
  let response;
  try{response=await fetcher(url,{redirect:'error',headers:{Accept:'image/png','User-Agent':'MafiaWorkbench/0.1 (https://github.com/b4rtt/mafia-workbench)'},signal});}catch{fail('server není dostupný nebo vypršel čas. Zkuste znovu později; požadavek se automaticky neopakuje.');}
  if(!response.ok){await response.body?.cancel();fail(`HTTP ${response.status}. Výšky nebyly načteny; rovinný podklad se automaticky nedosazuje.`);}
  const imagery=response.headers.get('x-amz-meta-x-imagery-sources')??response.headers.get('x-imagery-sources');
  if(!terrainImagery(imagery)){await response.body?.cancel();fail('dlaždice neuvádí pouze ověřený zdroj EU-DEM. Tento první poskytovatel zatím podporuje jen oblasti s EU-DEM; použijte rovinný import nebo uložený místní rastr.');}
  if(!/^image\/png(?:;|$)/i.test(response.headers.get('content-type')??'')||Number(response.headers.get('content-length'))>limit){await response.body?.cancel();fail('server nevrátil PNG do 1 MB.');}
  const parts=[];let size=0;
  if(!response.body)fail('server vrátil prázdnou odpověď.');
  try{for await(const part of response.body){size+=part.byteLength;if(size>limit)fail('dlaždice přesahuje 1 MB.');parts.push(part);}}catch(error){if(error.message.startsWith('OpenStreetMap'))throw error;fail('stahování dlaždice bylo přerušeno.');}
  const bytes=Buffer.concat(parts),samples=decodeTerrariumPng(bytes),modified=response.headers.get('last-modified'),meta={x,y,url,imagery,acquiredAt,modifiedAt:modified&&Number.isFinite(Date.parse(modified))?iso(modified):null,bytes:bytes.length,sha256:hash(bytes)};
  if(filename){await fs.mkdir(cacheRoot,{recursive:true});await publish(filename+'.png',bytes);await publish(filename+'.json',Buffer.from(JSON.stringify(meta)));}
  return {meta,samples,cached:false};
}
export async function downloadOsmElevation(value,settings,{cacheRoot,fetcher=fetch,now=()=>Date.now()}={}){
  const area=osmArea(value),acquiredAt=iso(now()),columns=Math.ceil(area.size/10),rows=columns,tiles=new Map(),coverage=terrainTileCoverage(area),signal=AbortSignal.timeout(60000);
  // Validate placement settings before any network or disk writes.
  osmElevationDigest({version:1,area,columns:1,rows:1,base:20,samples:[0,0,0,0],groundTexture:settings?.groundTexture,groundTileSize:settings?.groundTileSize,source:{kind:'local-grid',name:'validation',attribution:'validation',verticalDatum:'validation',resolution:10,acquiredAt}},area);
  for(const {x,y}of coverage)tiles.set(`${x}/${y}`,await tile(x,y,{cacheRoot,fetcher,signal,acquiredAt}));
  const pixel=(x,y)=>{const t=tiles.get(`${Math.floor(x/256)}/${Math.floor(y/256)}`);if(!t)fail('chybí sousední dlaždice pro interpolaci.');return t.samples[(y%256)*256+x%256];},samples=[];
  for(let row=0;row<=rows;row++)for(let col=0;col<=columns;col++){
    const [px,py]=terrainPixel(area,-area.size/2+col*area.size/columns,-area.size/2+row*area.size/rows),x=Math.floor(px),y=Math.floor(py),u=px-x,v=py-y;
    samples.push((pixel(x,y)*(1-u)+pixel(x+1,y)*u)*(1-v)+(pixel(x,y+1)*(1-u)+pixel(x+1,y+1)*u)*v);
  }
  const input={version:1,area,columns,rows,base:20,samples,groundTexture:settings.groundTexture,groundTileSize:settings.groundTileSize,source:{kind:'terrain-tiles-eudem',name:terrainName,attribution:terrainAttribution,verticalDatum:terrainDatum,resolution:30,acquiredAt,zoom:terrainZoom,pixelSpacing:terrainPixelSpacing(area),tiles:[...tiles.values()].map(t=>t.meta)}};
  const elevation=osmElevationSource({...input,sha256:osmElevationDigest(input,area)},area);
  return {elevation,cached:[...tiles.values()].every(t=>t.cached),downloaded:[...tiles.values()].filter(t=>!t.cached).length};
}
