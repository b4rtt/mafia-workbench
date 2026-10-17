import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {downloadOsmElevation} from '../src/plugins/osm/elevation-download.js';
import {osmElevationSource,osmElevationDigest} from '../src/plugins/osm/elevation-source.js';
import {terrainPixel,terrainTileCoverage,terrainTileUrl} from '../src/plugins/osm/terrarium-grid.js';
import {terrariumPng} from './helpers/terrarium.js';

const area={latitude:50,longitude:14,size:100},settings={groundTexture:'maps/ground.bmp',groundTileSize:4},now=()=>Date.parse('2026-10-17T12:00:00.000Z');
const headers={'Content-Type':'image/png','X-Amz-Meta-X-Imagery-Sources':'eudem/eudem_dem_5deg_n50e010.tif','Last-Modified':'Thu, 16 Nov 2017 08:00:00 GMT'};
const centre=terrainPixel(area,0,0),height=(x,y)=>200+(x-centre[0])*.01+(y-centre[1])*.02;
const server=(calls=[])=>async(url,options)=>{calls.push({url,options});const m=/\/14\/(\d+)\/(\d+)\.png$/.exec(url);assert(m);return new Response(terrariumPng((x,y)=>height(Number(m[1])*256+x,Number(m[2])*256+y)),{headers});};
test('height download samples pixel centres across both tile seams and preserves south-to-north rows',async()=>{
  const world=256*2**14,x=8192*256+.5,y=5550*256+.5,seam={latitude:Math.atan(Math.sinh(Math.PI*(1-2*y/world)))*180/Math.PI,longitude:x/world*360-180,size:100},calls=[];
  const {elevation:e,cached,downloaded}=await downloadOsmElevation(seam,settings,{fetcher:server(calls),now});
  assert.equal(e.samples.length,121);assert.equal(e.columns,10);assert.equal(e.rows,10);assert.equal(cached,false);assert.equal(downloaded,4);assert.equal(calls.length,4);
  for(let row=0;row<=10;row++)for(let col=0;col<=10;col++)assert(Math.abs(e.samples[row*11+col]-height(...terrainPixel(seam,-50+col*10,-50+row*10)))<1/256);
  assert(e.samples[0]>e.samples[110]);assert.equal(e.source.resolution,30);assert.equal(e.source.tiles.length,4);assert.deepEqual(osmElevationSource(JSON.parse(JSON.stringify(e)),seam),e);
  for(const c of calls){assert.equal(c.options.redirect,'error');assert(c.options.signal instanceof AbortSignal);assert.equal(c.options.headers.Accept,'image/png');}
});
test('tile cache supports offline recreation, verifies content hashes and refreshes only a corrupt tile',async()=>{
  const cacheRoot=await fs.mkdtemp(path.join(os.tmpdir(),'wb-dem-'));try{
    const calls=[],first=await downloadOsmElevation(area,settings,{cacheRoot,fetcher:server(calls),now});assert(calls.length>0);
    const second=await downloadOsmElevation(area,settings,{cacheRoot,fetcher:()=>{throw Error('offline');},now});assert(second.cached);assert.equal(second.downloaded,0);assert.deepEqual(second.elevation,first.elevation);
    const {x,y}=first.elevation.source.tiles[0];await fs.writeFile(path.join(cacheRoot,`14-${x}-${y}.png`),Buffer.alloc(57));calls.length=0;
    const third=await downloadOsmElevation(area,settings,{cacheRoot,fetcher:server(calls),now});assert.equal(third.downloaded,1);assert.equal(calls.length,1);assert.deepEqual(third.elevation,first.elevation);
    assert(!(await fs.readdir(cacheRoot)).some(p=>p.endsWith('.tmp')));
  }finally{await fs.rm(cacheRoot,{recursive:true,force:true});}
});
test('height requests reject unsupported imagery, missing provenance, HTTP failure and oversized streamed bodies',async()=>{
  const valid=terrariumPng();
  for(const response of [new Response('gateway',{status:502}),new Response(valid,{headers:{...headers,'X-Amz-Meta-X-Imagery-Sources':'srtm/N50E014.tif'}}),new Response(valid,{headers:{'Content-Type':'image/png'}}),new Response(valid,{headers:{...headers,'Content-Type':'text/html'}}),new Response(valid,{headers:{...headers,'Content-Length':String(2*1024*1024)}}),new Response(Buffer.alloc(1024*1024+1),{headers})]){
    let calls=0;await assert.rejects(downloadOsmElevation(area,settings,{fetcher:async()=>{calls++;return response;},now}),/OpenStreetMap/);assert.equal(calls,1);
  }
  await assert.rejects(downloadOsmElevation(area,settings,{fetcher:async()=>{throw Error('offline');},now}),/server není dostupný/);
  let calls=0;await assert.rejects(downloadOsmElevation(area,{...settings,groundTexture:'../bad.bmp'},{fetcher:()=>{calls++;},now}));assert.equal(calls,0);
});
test('provider snapshot binds area coverage, individual tile identities, hashes, dates and nominal resolution',async()=>{
  const {elevation:e}=await downloadOsmElevation(area,settings,{fetcher:server(),now});
  for(const mutate of [e=>e.source.tiles.pop(),e=>e.source.tiles[0].x++,e=>e.source.tiles[0].url='https://example.org/1.png',e=>e.source.tiles[0].imagery='eudem/../bad.tif',e=>e.source.tiles[0].acquiredAt='tomorrow',e=>e.source.tiles[0].acquiredAt='2099-01-01T00:00:00.000Z',e=>e.source.tiles[0].sha256='bad',e=>e.source.resolution=1,e=>e.source.zoom=15,e=>e.source.pixelSpacing=1]){const changed=structuredClone(e);mutate(changed);assert.throws(()=>osmElevationDigest(changed,area));}
  const changed=structuredClone(e);changed.source.tiles[0].sha256='a'.repeat(64);assert.throws(()=>osmElevationSource(changed,area),/kontrolní součet/);
  const coverage=terrainTileCoverage({latitude:80,longitude:179.9,size:450});assert(coverage.length<=16);assert(coverage.every(t=>t.x>=0&&t.y>=0&&t.x<2**14&&t.y<2**14));assert.equal(e.source.tiles[0].url,terrainTileUrl(e.source.tiles[0].x,e.source.tiles[0].y));
});
test('maximum areas near the latitude and longitude limits remain bounded in both hemispheres',async()=>{
  const bytes=terrariumPng(()=>200);
  for(const latitude of [-80,80])for(const longitude of [-179.9,179.9]){
    const value={latitude,longitude,size:450},calls=[];
    const r=await downloadOsmElevation(value,settings,{now,fetcher:async url=>{calls.push(url);return new Response(bytes,{headers});}});
    assert.equal(calls.length,terrainTileCoverage(value).length);assert(calls.length<=16);assert.equal(r.elevation.samples.length,46*46);assert(r.elevation.samples.every(n=>n===200));
  }
});
