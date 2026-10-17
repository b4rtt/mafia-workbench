import test from 'node:test';
import assert from 'node:assert/strict';
import {osmElevationDigest,osmElevationSource} from '../src/plugins/osm/elevation-source.js';

const area={latitude:50,longitude:14,size:50};
const snapshot=()=>{
  const input={version:1,area:{...area},columns:2,rows:1,base:2,samples:[200,201,202,201,202,203],groundTexture:'maps/ground.bmp',groundTileSize:4,source:{kind:'local-grid',name:'Synthetic slope',attribution:'Test data',verticalDatum:'Synthetic metres',resolution:25,acquiredAt:'2026-10-17T00:00:00.000Z'}};
  return {...input,sha256:osmElevationDigest(input,area)};
};
test('saved elevation snapshot preserves numeric values and source metadata through JSON without shared references',()=>{
  const input=snapshot(),before=structuredClone(input),value=osmElevationSource(JSON.parse(JSON.stringify(input)),area);
  assert.deepEqual(value,input);assert.deepEqual(input,before);assert.match(value.sha256,/^[a-f0-9]{64}$/);
  value.samples[0]=999;value.area.latitude=51;value.source.name='changed';assert.deepEqual(input,before);
  assert.equal(osmElevationDigest({...input,sha256:'ignored',extra:'ignored',area:{...area,bbox:[]}},area),input.sha256);
});
test('changed elevations, placement settings and declared provenance invalidate the saved checksum',()=>{
  for(const mutate of [s=>s.samples[0]++,s=>s.base++,s=>s.groundTileSize++,s=>s.groundTexture='maps/other.bmp',s=>s.source.name+='x',s=>s.source.attribution+='x',s=>s.source.verticalDatum+='x',s=>s.source.resolution++,s=>s.source.acquiredAt='2026-10-18T00:00:00.000Z',s=>s.sha256='0'.repeat(64)]){
    const s=snapshot();mutate(s);assert.throws(()=>osmElevationSource(s,area),/kontrolní součet/);
  }
});
test('saved source rejects wrong areas, void heights, missing provenance and unsafe ground assets before hashing',()=>{
  for(const mutate of [s=>s.area.longitude++,s=>s.samples[0]=null,s=>s.samples.pop(),s=>delete s.source,s=>s.source.kind='url',s=>s.source.name='',s=>s.source.attribution='\0bad',s=>s.source.verticalDatum='',s=>s.source.resolution=0,s=>s.source.resolution='25',s=>s.source.acquiredAt='yesterday',s=>s.source.acquiredAt='2026-10-17',s=>s.groundTexture='maps/../bad.bmp',s=>s.groundTileSize=0]){
    const s=snapshot();mutate(s);assert.throws(()=>osmElevationDigest(s,area));assert.throws(()=>osmElevationSource(s,area));
  }
});
