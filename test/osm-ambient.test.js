import test from 'node:test';
import assert from 'node:assert/strict';
import {osmSource,osmRoadPlan} from '../src/plugins/osm/area.js';
import {osmSurfaceDefaults,osmSurfaceModel} from '../src/plugins/osm/surface.js';
import {osmAmbientDefaults,osmAmbientPlan,validateOsmAmbient} from '../src/plugins/osm/ambient.js';
import {inspectOsmAmbientWav,loadOsmAmbientSounds} from '../src/plugins/osm/ambient-assets.js';
import {changeSceneObject,inspectScene} from '../src/core/scene.js';
import {hash} from '../src/core/files.js';
const region={latitude:50,longitude:14,size:200},layer=(patch={})=>({...osmAmbientDefaults,sound:{path:'sounds/ambience.wav',sha256:'a'.repeat(64)},...patch}),poly=(x,z,w,h)=>[[x,z],[x+w,z],[x+w,z+h],[x,z+h],[x,z]];
function fixture(){const nodes=[[-110,0],[0,0],[110,0],[0,110]].map(([x,z],i)=>({type:'node',id:i+1,lat:50+z/6371008.8*180/Math.PI,lon:14+x/6371008.8*180/Math.PI/Math.cos(50*Math.PI/180)})),source=osmSource({elements:[...nodes,{type:'way',id:10,nodes:[1,2,3],tags:{highway:'residential'}},{type:'way',id:11,nodes:[2,4],tags:{highway:'residential'}}]},region),roads=osmRoadPlan(source,[10,11]),surface=osmSurfaceModel(roads,region,{...osmSurfaceDefaults});return{source,roads,surface};}
const run=(f,settings,green=null)=>osmAmbientPlan(f.source,f.roads,f.surface,green,{version:1,...settings});
test('ambient street sources are deterministic native point sounds at bounded actual street positions with spacing and no input mutation',()=>{
 const f=fixture(),before=structuredClone(f),r=run(f,{streets:layer()});assert.deepEqual(f,before);assert.deepEqual(run(f,{streets:layer()}),r);assert(r.placements.length>3);for(const p of r.placements){assert(Math.abs(p.position[0])<100&&Math.abs(p.position[2])<100);assert(Math.abs(p.position[1]-1.55)<1e-6);assert.equal(p.parameters.type,1);assert.equal(p.parameters.loop,true);assert.deepEqual(p.parameters.range,[10,50,1,0]);assert.deepEqual(p.parameters.sectors,['Primary sector']);assert.equal(p.parameters.file,'ambience.wav');assert.equal(p.parameters.volume,.25);assert(Math.abs(p.position[0])<1e-4||Math.abs(p.position[2])<1e-4);}for(const[a,p]of r.placements.entries())for(const q of r.placements.slice(a+1))assert(Math.hypot(p.position[0]-q.position[0],p.position[2]-q.position[2])>=42);
});
test('park emitters preserve real height and polygon holes; small concave pieces get an interior source rather than a bounding-box center',()=>{
 const f=fixture(),green={placements:[{id:'relation/50/1',height:.03,grass:[[poly(-80,10,160,80),poly(-10,20,20,30)]],paths:[]},{id:70,height:.04,grass:[[poly(-80,-40,10,10)]],paths:[]}]},r=run(f,{green:layer()},green);assert(r.placements.length>2);assert(r.placements.some(p=>p.source===70));for(const p of r.placements){assert(Math.abs(p.position[1]-(p.source===70?1.54:1.53))<1e-6);assert(!(p.position[0]>-10&&p.position[0]<10&&p.position[2]>20&&p.position[2]<50),'no sound in courtyard hole');}
 const concave={placements:[{id:80,height:.03,paths:[],grass:[[[[10,10],[20,10],[20,11],[11,11],[11,20],[10,20],[10,10]]]]}]};const p=run(f,{green:layer()},concave).placements[0].position;assert(p[0]<11||p[2]<11,'triangle fallback stays within the L, not its empty center');
});
test('buildings exclude sources and excessive city density refuses the whole plan rather than silently truncating',()=>{
 const f=fixture();f.source.buildings=[{id:55,polygons:[[poly(-100,-100,200,200)]]}];assert.throws(()=>run(f,{streets:layer()}),/žádný zvuk/);f.source.buildings=[];const g={placements:[{id:1,height:.03,grass:[[poly(-100,-100,200,200)]],paths:[]}]};assert.throws(()=>run(f,{green:layer({spacing:20})},g),/64 zvuk/);assert.throws(()=>run(f,{green:layer()}),/zelených/);assert.throws(()=>run({...f,surface:null},{streets:layer()}),/povrchy/);
});
test('ambient settings reject missing hashes, unsafe native paths and invalid acoustic dimensions before use',()=>{
 validateOsmAmbient({version:1,streets:layer()});for(const patch of [{spacing:19},{spacing:151},{radius:NaN},{radius:151},{volume:0},{volume:1.01},{sound:{path:'sounds/../file.wav',sha256:'a'.repeat(64)}},{sound:{path:'sounds/a\\b.wav',sha256:'a'.repeat(64)}},{sound:{path:'sounds/a.wav',sha256:'bad'}}])assert.throws(()=>validateOsmAmbient({version:1,green:layer(patch)}),/zvuky/);for(const o of [null,{version:2,streets:layer()},{version:1}, {version:1,streets:true}])assert.throws(()=>validateOsmAmbient(o),/zvuky/);
});
function wav(bits=16){const bytes=Buffer.alloc(44+8000*(bits/8));bytes.write('RIFF');bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);bytes.writeUInt32LE(8000,24);bytes.writeUInt32LE(8000*bits/8,28);bytes.writeUInt16LE(bits/8,32);bytes.writeUInt16LE(bits,34);bytes.write('data',36);bytes.writeUInt32LE(bytes.length-44,40);return bytes;}
test('point sound assets preserve original mono PCM, metadata and hashes while rejecting corrupt, stereo and changed recordings',async()=>{
 for(const bits of [8,16])assert.deepEqual(inspectOsmAmbientWav(wav(bits)),{duration:1,sampleRate:8000,bits});for(const change of [b=>b.writeUInt16LE(2,22),b=>b.writeUInt16LE(3,20),b=>b.writeUInt32LE(1,4),b=>b.writeUInt32LE(99999999,40),b=>b.writeUInt16LE(24,34),b=>b.writeUInt32LE(0,40)]){const b=wav();change(b);assert.throws(()=>inspectOsmAmbientWav(b),/mono WAV/);}assert.throws(()=>inspectOsmAmbientWav(Buffer.alloc(2)),/mono WAV/);
 const b=wav(),original=Buffer.from(b),p={asset:()=>({path:'sounds/Ambience.WAV'}),read:async()=>b},r=await loadOsmAmbientSounds(p,['sounds/ambience.wav']);assert.equal(r[0].sha256,hash(b));assert.equal(r[0].path,'sounds/Ambience.WAV');assert.deepEqual(b,original);assert.deepEqual(await loadOsmAmbientSounds(p,r),r);await assert.rejects(loadOsmAmbientSounds(p,[{...r[0],sha256:'0'.repeat(64)}]),/změnila/);for(const items of [[],['a','b','c'],['maps/a.wav']])await assert.rejects(loadOsmAmbientSounds(p,items),/zvuky/);
});
const chunk=(type,p)=>{const b=Buffer.alloc(6);b.writeUInt16LE(type);b.writeUInt32LE(p.length+6,2);return Buffer.concat([b,p]);};
test('planned emitters serialize through the native scene writer and remain individually editable and deletable',()=>{
 const f=fixture(),r=run(f,{streets:layer()}),empty=chunk(0x4c53,chunk(0x4000,Buffer.alloc(0)));let bytes=empty;
 for(const p of r.placements)bytes=changeSceneObject(bytes,{kind:'add-sound',name:p.name,position:p.position,rotation:[1,0,0,0],parameters:p.parameters},[],[]);
 const scene=inspectScene(bytes);assert.equal(scene.objects.length,r.placements.length);for(const o of scene.objects){assert.equal(o.frameType,4);assert(scene.entries.some(e=>e.nodeId?.startsWith(o.id+'/')&&e.label==='Opakovat zvuk'&&e.value===true));}for(const name of r.placements.map(p=>p.name).reverse()){const s=inspectScene(bytes);bytes=changeSceneObject(bytes,{kind:'delete',id:s.objects.find(o=>o.name===name).id},[],[]);}assert.deepEqual(bytes,empty);
});
