import test from 'node:test';
import assert from 'node:assert/strict';
import {deflateSync} from 'node:zlib';
import {decodeTerrariumPng} from '../src/plugins/osm/terrarium-png.js';
import {terrariumPng,pngChunk} from './helpers/terrarium.js';

test('Terrarium numeric decoder reconstructs all five PNG filters, RGB/RGBA and split IDAT without colour conversion',()=>{
  const height=(x,y)=>-123.5+x/4+y/256;
  for(const channels of [3,4]){
    const decoded=decodeTerrariumPng(terrariumPng(height,{channels}));assert.equal(decoded.length,65536);
    for(let y=0;y<256;y++)for(let x=0;x<256;x++)assert.equal(decoded[y*256+x],height(x,y));
  }
});
test('Terrarium decoder refuses voids, alpha, malformed PNG, CRC errors, extra streams and decompression bombs',()=>{
  const original=terrariumPng(),corrupt=Buffer.from(original);corrupt[50]^=1;
  const variants=[corrupt,original.subarray(0,-1),Buffer.concat([original,Buffer.from([0])]),terrariumPng(()=>-32768),terrariumPng(()=>10000),terrariumPng(()=>100,{channels:4,alpha:0}),terrariumPng(()=>100,{filter:()=>5}),Buffer.alloc(1024*1024+1)];
  for(const change of [
    chunks=>[chunks[0],pngChunk('tRNS',Buffer.alloc(6)),...chunks.slice(1)],
    chunks=>[chunks[0],pngChunk('acTL',Buffer.alloc(8)),...chunks.slice(1)],
    chunks=>[chunks[0],pngChunk('BOOM'),...chunks.slice(1)],
    chunks=>[chunks[0],chunks[1],pngChunk('tEXt'),...chunks.slice(2)],
    chunks=>[chunks[0],chunks[0],...chunks.slice(1)],
    chunks=>[chunks[0],pngChunk('IDAT',deflateSync(Buffer.alloc(2*1024*1024))),chunks.at(-1)],
    chunks=>[...chunks.slice(0,-1),pngChunk('IDAT',deflateSync(Buffer.alloc(1))),chunks.at(-1)],
    chunks=>{const header=Buffer.alloc(13);header.writeUInt32BE(512);header.writeUInt32BE(256,4);header[8]=8;header[9]=2;return [pngChunk('IHDR',header),...chunks.slice(1)];},
  ])variants.push(terrariumPng(()=>200,{transform:change}));
  for(const bytes of variants)assert.throws(()=>decodeTerrariumPng(bytes),/Terrarium PNG/);
});
