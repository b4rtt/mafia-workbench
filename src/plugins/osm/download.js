import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {osmArea,osmSource,osmProviders} from './area.js';
const limit=8*1024*1024;
const requested=new Map();
async function serverError(response){
  // Gateways may return HTML; inspect only a bounded prefix and never expose it in the UI.
  let body='',size=0;
  try{for await(const part of response.body){const bytes=Buffer.from(part),remaining=4096-size;body+=bytes.subarray(0,remaining).toString('utf8');size+=bytes.length;if(size>=4096)break;}}catch{/* The HTTP status is useful even if the error body cannot be read. */}
  const capacity=/currently at capacity|all query workers are busy|request queue is full/i.test(body);
  const reason=capacity?'Server je přetížený: pracovní procesy jsou obsazené a fronta požadavků je plná.':response.status===429?'Server omezil počet požadavků.':response.status===502||response.status===504?'Brána nedostala včas platnou odpověď od serveru Overpass.':'Server nedokázal požadavek vyřídit.';
  return Error(`OpenStreetMap: HTTP ${response.status}. ${reason} Zkuste to později nebo otevřete uložený podklad; požadavky automaticky neopakuji.`);
}
export function osmQuery(value){const area=osmArea(value),box=area.bbox.map(n=>n.toFixed(9)).join(',');return `[out:json][timeout:25];(way["highway"](${box});node["natural"="tree"](${box});node["amenity"~"^(bench|waste_basket)$"](${box});node["highway"="street_lamp"](${box});way["building"](${box});rel["building"](${box});rel["type"="building"](${box});nwr["landuse"~"^(grass|meadow)$"](${box});nwr["landcover"="grass"](${box});nwr["natural"="grassland"](${box});nwr["leisure"~"^(park|garden)$"](${box});)->.seed;(rel(bw.seed)["building"];rel(bw.seed)["type"="building"];rel(bw.seed)["type"="multipolygon"];)->.parents;(.seed;.parents;);(._;>;);out body qt;`;}
export async function downloadOsm(value,{cacheRoot,provider='fossgis',fetcher=fetch,now=()=>Date.now()}={}){
  if(!Object.hasOwn(osmProviders,provider))throw Error('OpenStreetMap: neznámý poskytovatel.');
  const area=osmArea(value),query=osmQuery(area),key=createHash('sha256').update(provider+'\n'+query).digest('hex'),filename=cacheRoot&&path.join(cacheRoot,key+'.json');
  if(filename)try{const stat=await fs.stat(filename);if(stat.size<=limit&&now()-stat.mtimeMs>=0&&now()-stat.mtimeMs<86400000){const data=JSON.parse(await fs.readFile(filename,'utf8'));osmSource(data,area);return {data,cached:true};}}catch{/* An invalid/old cache is never used as a source. */}
  const last=requested.get(provider);if(last!==undefined&&now()-last<30000)throw Error('OpenStreetMap: před dalším dotazem na tento server počkejte 30 sekund nebo otevřete uložený podklad.');requested.set(provider,now());
  const response=await fetcher(osmProviders[provider].url,{method:'POST',redirect:'error',headers:{'Content-Type':'application/x-www-form-urlencoded','User-Agent':'MafiaWorkbench/0.1 (https://github.com/b4rtt/mafia-workbench)','Accept':'application/json'},body:new URLSearchParams({data:query}),signal:AbortSignal.timeout(45000)});
  if(!response.ok)throw await serverError(response);
  const chunks=[];let size=0;for await(const part of response.body){size+=part.byteLength;if(size>limit)throw Error('OpenStreetMap: odpověď přesahuje 8 MB. Zmenšete oblast.');chunks.push(part);}
  const bytes=Buffer.concat(chunks),data=JSON.parse(bytes.toString('utf8'));osmSource(data,area);
  if(filename){await fs.mkdir(cacheRoot,{recursive:true});await fs.writeFile(filename,bytes);}
  return {data,cached:false};
}
