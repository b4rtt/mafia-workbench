import test from 'node:test';
import assert from 'node:assert/strict';
import {Ray,Vector3} from 'three';
import {osmHybridPlan} from '../src/plugins/osm/building-hybrid.js';
import {osmShellPlan,osmShellModel} from '../src/plugins/osm/building-shells.js';
import {osmBuildingPlan} from '../src/plugins/osm/buildings.js';
import {osmGreenReservation} from '../src/plugins/osm/green-areas.js';
import {writeSurfaceModel} from '../src/core/surface-model.js';
import {parseFourDs} from '../src/core/fourds.js';
import {osmTerrainSurface} from '../src/plugins/osm/terrain.js';
import {osmSurfaceDefaults} from '../src/plugins/osm/surface.js';
import {osmFoundationVertices} from '../src/plugins/osm/building-terrain.js';

const rect=(x,z,w=12,d=12)=>[[x-w/2,z-d/2],[x+w/2,z-d/2],[x+w/2,z+d/2],[x-w/2,z+d/2]];
const feature=(id,polygon,tags={})=>({id,tags:{building:'yes',height:'9',...tags},polygons:[polygon]});
const source=buildings=>({area:{size:450},ways:[],buildings});
const roads={flat:true,crossings:[{position:[-200,0,-190]},{position:[200,0,-190]}],roads:[{from:0,to:1,positions:[]}]};
const empty={model:{meshes:[]},footprints:{road:[],sidewalk:[]}};
const catalog=[{path:'models/#rad016.4ds',sha256:'a'.repeat(64),min:[-5,0,-5],max:[5,9,5],vertices:8}];
const options={version:1,mode:'hybrid',selected:[1,2],models:catalog.map(({path,sha256})=>({path,sha256})),styles:[{id:'brick'},{id:'shops'}],ground:.2,fallbackHeight:15,adjustScale:false,minCoverage:.35,matching:{version:1},facade:{version:1}};
const input=()=>source([feature(1,[rect(-25,0)],{building:'house'}),feature(2,[rect(30,0,32,24)])]);
const plan=(s=input(),change={},models=catalog,surface=empty)=>osmHybridPlan(s,roads,surface,models,{...options,selected:s.buildings.map(b=>b.id),...change});

test('mixed import retains suitable originals once and fills remaining complete outlines reproducibly',()=>{
  const s=input(),before=structuredClone(s),r=plan(s);assert.equal(r.mode,'hybrid');assert.equal(r.placements.length,2);assert.equal(r.skipped.length,0);
  const [original,shell]=r.placements;assert.equal(original.method,'original');assert.equal(original.model,catalog[0].path);assert.deepEqual(original.scale,[1,1,1]);assert.equal(shell.method,'footprint');assert.equal(shell.coverage,1);assert.deepEqual(shell.facade,{version:1});assert.match(shell.fallbackReason,/rozměrům/);assert.equal(new Set(r.placements.map(p=>p.way)).size,2);
  assert.deepEqual(r,plan(JSON.parse(JSON.stringify(s))));assert.deepEqual(s,before);
  assert.deepEqual(r.placements.filter(p=>!p.style).map(({method,...p})=>p),osmBuildingPlan(s,roads,empty,catalog,options).placements);
  assert(parseFourDs(writeSurfaceModel(osmShellModel(shell)),true).meshes.length>0);
});
test('shell fallback cannot cover original bounds or street corridors, and retains both skip reasons',()=>{
  const s=input();s.buildings[1]=feature(2,[rect(-25,0,30,30)]);const p=plan(s);assert.equal(p.placements.length,1);assert.equal(p.placements[0].way,1);assert.match(p.skipped[0].reason,/jiné budovy/);assert.match(p.skipped[0].originalReason,/rozměrům/);
  const blocked={...empty,footprints:{road:[[rect(30,0,40,40)]],sidewalk:[]}},q=plan(input(),{},catalog,blocked);assert.equal(q.placements.length,1);assert.match(q.skipped[0].reason,/vozovky/);
});
test('courtyards remain empty and special or unsupported OSM forms do not get generic replacements',()=>{
  const outer=rect(30,0,40,40),hole=rect(30,0,24,24),s=source([feature(1,[outer,hole]),feature(2,[rect(-25,0)],{building:'church'}),feature(3,[rect(0,60)],{building:'industrial'}),feature(4,[rect(224,0)])]);
  const r=plan(s);assert.equal(r.placements.length,1);const item=r.placements[0];assert.equal(item.method,'footprint');assert.deepEqual(item.polygon,[outer,hole]);const model=osmShellModel(item),ray=new Ray(new Vector3(30-item.position[0],100,-item.position[2]),new Vector3(0,-1,0));let hits=0;
  for(const mesh of model.meshes){const l=mesh.lods[0];for(const f of l.faces)for(let i=0;i<f.indices.length;i+=3){const v=f.indices.slice(i,i+3).map(n=>new Vector3(...l.positions.slice(n*3,n*3+3)));if(ray.intersectTriangle(...v,false,new Vector3()))hits++;}}
  assert.equal(hits,0);assert.equal(r.skipped.length,3);assert.match(r.skipped.find(p=>p.way===2).reason,/Zvláštní/);assert.match(r.skipped.find(p=>p.way===3).reason,/ověřený vhodný/);assert.match(r.skipped.find(p=>p.way===4).reason,/hranici/);
});
test('one collision budget covers streets, originals and fallback shells before publication',()=>{
  const r=plan(input(),{},[{...catalog[0],vertices:59990}]);assert.equal(r.placements.length,1);assert.equal(r.placements[0].method,'original');assert.match(r.skipped[0].reason,/vrcholů/);
  assert.equal(osmGreenReservation(empty,r,[{...catalog[0],vertices:59990}]),59990);
  const dense={...empty,model:{meshes:[{lods:[{positions:Array.from({length:59994*3},(_,i)=>i%3?0:Math.floor(i/3))}]}]}};assert.equal(plan(input(),{},catalog,dense).placements.length,0);
});
test('mixed import limits the total to 64 houses while keeping at most 32 original models',()=>{
  const s=source(Array.from({length:65},(_,i)=>feature(i+1,[rect(-125+i%9*29,-110+Math.floor(i/9)*29)],{building:'house'}))),r=plan(s);
  assert.equal(r.placements.filter(p=>p.method==='original').length,32);assert.equal(r.placements.length,64);assert.equal(r.skipped.length,1);assert.match(r.skipped[0].reason,/64/);
});
test('mixed terrain houses retain separate rigid and complete-outline foundations in the shared collision reservation',()=>{
  const s=input(),area={latitude:50,longitude:14,size:450};s.area=area;
  const terrain=osmTerrainSurface(roads,area,osmSurfaceDefaults,{version:1,area,columns:10,rows:10,base:2,samples:Array.from({length:121},(_,i)=>200+(-225+i%11*45)*.01+(-225+Math.floor(i/11)*45)*.005),groundTexture:'maps/ground.bmp',groundTileSize:4}),r=plan(s,{},catalog,terrain);
  assert.equal(r.placements.length,2);for(const p of r.placements){assert(p.support);assert(p.support.relief>0);assert.deepEqual(p.scale,[1,1,1]);}
  const original=r.placements.find(p=>p.method==='original'),shell=r.placements.find(p=>p.style),without={...original};delete without.support;
  assert.equal(osmGreenReservation(null,{placements:[original]},catalog)-osmGreenReservation(null,{placements:[without]},catalog),osmFoundationVertices(original.support));
  assert(osmGreenReservation(terrain,r,catalog)<60000);assert.equal(parseFourDs(writeSurfaceModel(osmShellModel(shell)),true).meshes.length,2);
});
test('family fallback uses the same declared height estimates as original matching and preserves explicit heights',()=>{
  for(const [tags,height]of [[{building:'house'},9],[{building:'bungalow'},6],[{building:'house',height:'22'},22],[{building:'house','building:levels':'3'},12]]){
    const f=feature(1,[rect(0,0,35,35)],tags);if(!Object.hasOwn(tags,'height'))delete f.tags.height;const r=plan(source([f])).placements[0];assert.equal(r.method,'footprint');assert.equal(r.height,height);
  }
  assert.throws(()=>plan(input(),{mode:'original'}),/společný režim/);assert.throws(()=>plan(input(),{styles:[]}),/nastavení/);
});
test('legacy shell mode has identical geometry and no new matching restrictions when the option is absent',()=>{
  const s=source([feature(1,[rect(0,0)],{building:'industrial'})]),o={...options,mode:'footprint',selected:[1],matching:undefined};const a=osmShellPlan(s,roads,empty,o),b=osmShellPlan(s,roads,empty,o,{footprints:[],vertices:0,count:0});assert.equal(a.placements.length,1);assert.deepEqual(a,b);assert.deepEqual(writeSurfaceModel(osmShellModel(a.placements[0])),writeSurfaceModel(osmShellModel(b.placements[0])));
  for(const reserved of [{footprints:[],vertices:-1,count:0},{footprints:[],vertices:0,count:65}])assert.throws(()=>osmShellPlan(s,roads,empty,o,reserved),/rezervace/);
});
