import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {osmSource} from './area.js';

const fail=message=>{throw Error(`OpenStreetMap · sloučení: ${message}`);};
const fileLimit=8*1024*1024,totalLimit=32*1024*1024;
// Sort object keys only. Node sequences and relation member order carry topology.
function canonical(value,depth=0){
  if(depth>64)fail('příliš hluboce vnořená data.');
  if(value===null||typeof value==='string'||typeof value==='boolean')return JSON.stringify(value);
  if(typeof value==='number'&&Number.isFinite(value))return JSON.stringify(value);
  if(Array.isArray(value))return '['+value.map(v=>canonical(v,depth+1)).join(',')+']';
  if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k],depth+1)).join(',')+'}';
  fail('podklad musí obsahovat platné JSON hodnoty.');
}
function completeReferences(data){
  const ids=new Set(data.elements.map(r=>`${r.type}/${r.id}`));
  for(const row of data.elements){
    if(row.type==='way'&&(!Array.isArray(row.nodes)||row.nodes.length<2||row.nodes.some(id=>!Number.isSafeInteger(id)||id<=0||!ids.has(`node/${id}`))))fail(`cesta way/${row.id} nemá všechny uzly.`);
    if(row.type==='relation'&&(!Array.isArray(row.members)||row.members.some(m=>!m||!['node','way','relation'].includes(m.type)||!Number.isSafeInteger(m.ref)||m.ref<=0||typeof m.role!=='string'||!ids.has(`${m.type}/${m.ref}`))))fail(`relace relation/${row.id} nemá všechny členy.`);
  }
}
export function osmMergeInfo(data){
  const info=data?.workbench_merge;if(info===undefined)return null;
  if(info?.version!==1||!Array.isArray(info.inputs)||info.inputs.length<2||info.inputs.length>16||!Number.isSafeInteger(info.duplicates)||info.duplicates<0||info.inputs.some(i=>!i||!/^[a-f0-9]{64}$/.test(i.sha256)||!Number.isSafeInteger(i.elements)||i.elements<0||i.timestamp!==null&&(typeof i.timestamp!=='string'||i.timestamp.length>80))||!Array.isArray(data.elements)||info.inputs.reduce((n,i)=>n+i.elements,0)!==data.elements.length+info.duplicates)fail('neplatná evidence původu sloučených částí.');
  const timestamps=info.inputs.map(i=>i.timestamp);
  return {files:info.inputs.length,elements:data.elements.length,duplicates:info.duplicates,sameSnapshot:timestamps[0]!==null&&timestamps.every(t=>t===timestamps[0])};
}
export function mergeOsmInputs(inputs,area){
  if(!Array.isArray(inputs)||inputs.length<2||inputs.length>16)fail('vyberte 2–16 podkladů.');
  const entities=new Map(),provenance=[];let duplicates=0,total=0;
  for(const input of inputs){
    const saved=input?.format==='mafia-workbench-osm-source'&&input.version===1,data=saved?input.data:input;
    // Every part must be complete on its own; a second file must never conceal
    // a broken response, timeout, duplicate identity or missing way member.
    const source=osmSource(data,saved?input.area:area);osmMergeInfo(data);completeReferences(data);
    const encoded=canonical(data),size=Buffer.byteLength(encoded);total+=size;
    if(size>fileLimit||total>totalLimit)fail('nejvýše 8 MB na podklad a 32 MB celkem.');
    provenance.push({sha256:createHash('sha256').update(encoded).digest('hex'),elements:data.elements.length,timestamp:source.timestamp});
    for(const row of data.elements){
      const key=`${row.type}/${row.id}`,signature=canonical(row),previous=entities.get(key);
      if(previous){if(previous.signature!==signature)fail(`prvek ${key} má rozdílné verze. Použijte části stejného snímku mapy.`);duplicates++;}
      else entities.set(key,{signature,row:JSON.parse(signature)});
    }
  }
  const order={node:0,way:1,relation:2},elements=[...entities.values()].map(v=>v.row).sort((a,b)=>order[a.type]-order[b.type]||a.id-b.id);
  provenance.sort((a,b)=>a.sha256.localeCompare(b.sha256,'en'));
  const timestamp=provenance[0].timestamp,sameSnapshot=timestamp!==null&&provenance.every(p=>p.timestamp===timestamp);
  const data={version:0.6,generator:'Mafia Workbench · merged OSM source',...(sameSnapshot?{osm3s:{timestamp_osm_base:timestamp}}:{}),elements,workbench_merge:{version:1,inputs:provenance,duplicates}};
  if(Buffer.byteLength(JSON.stringify(data))>fileLimit)fail('sloučený podklad přesahuje 8 MB. Rozdělte vstup na menší oblasti.');
  return {data,source:osmSource(data,area),merge:osmMergeInfo(data)};
}
export async function readOsmMergeFiles(filenames,area){
  if(!Array.isArray(filenames)||filenames.length<2||filenames.length>16)fail('vyberte 2–16 podkladů.');
  const inputs=[];let total=0;
  for(const filename of filenames){
    const stat=await fs.stat(filename);if(!stat.isFile()||stat.size>fileLimit)fail('nejvýše 8 MB na podklad.');
    const bytes=await fs.readFile(filename);total+=bytes.length;if(bytes.length>fileLimit||total>totalLimit)fail('nejvýše 8 MB na podklad a 32 MB celkem.');
    inputs.push(JSON.parse(bytes.toString('utf8')));
  }
  return mergeOsmInputs(inputs,area);
}
