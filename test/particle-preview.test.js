import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ParticleSimulation } from '../src/ui/particle-simulation.js';
import { ParticleViewport } from '../src/ui/particle-preview.js';

const entries = values => Object.entries(values).map(([key, value]) => ({ key, value }));
const phase = values => ({ entries: entries({ duration: 1000, scale: [1,1,1], alpha: 1, flags: 0, ...values }), children: [] });
const emitter = (values = {}, phases = [phase()], id = 'emitter') => ({ id, entries: entries({ frame: 'Part', burst: 1, lifetime: 0, position: [0,0,0], direction: [1,0,0], speed: 2, scale: [1,1,1], alpha: 1, ...values }), children: phases });
const effect = (emitters = [emitter()], values = {}) => ({ entries: entries(values), children: emitters });
const snapshot = simulation => simulation.particles.map(p => ({ id:p.id, age:p.age, emitter:p.emitter.definition.id, phase:p.phase, remaining:p.remaining, position:p.position.toArray(), velocity:p.velocity.toArray(), scale:p.scale.toArray(), alpha:p.alpha, rotation:p.rotation.toArray() }));
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`);

test('burst motion, phase interpolation, hidden phases and final retirement follow elapsed time', () => {
  const type = effect([emitter({}, [phase({duration:100,scale:[3,5,7],alpha:0}),phase({duration:100,flags:8,scale:[3,5,7],alpha:0})])], {vector1:[10,20,30]});
  const original = structuredClone(type), sim = new ParticleSimulation(type);
  assert.equal(sim.particles.length,1);assert.deepEqual(sim.particles[0].position.toArray(),[10,20,30]);
  sim.seek(50);const p=sim.particles[0];close(p.position.x,10.1);assert.deepEqual(p.scale.toArray(),[2,3,4]);close(p.alpha,.5);
  sim.seek(100);assert.equal(sim.particles[0].phase,1);sim.seek(200);assert.equal(sim.particles.length,0);
  assert.deepEqual(type,original);
});

test('continuous rates are particles per second, decay after its threshold, and repeat with an inter-cycle delay', () => {
  const continuous = new ParticleSimulation(effect([emitter({burst:0,lifetime:10},[phase({duration:5000})])]));
  continuous.seek(1000);assert.equal(continuous.particles.length,10);continuous.seek(2000);assert.equal(continuous.particles.length,20);
  const node=emitter({burst:1,lifetime:10,decay:100,parameter84:100,parameter88:2},[phase({duration:10000})]);node.preview={startDelay:500};
  const repeated=new ParticleSimulation(effect([node]));assert.equal(repeated.particles.length,1,'initial burst is immediate, delay belongs to repeats');
  repeated.seek(200);close(repeated.emitters[0].rate,10);assert.equal(repeated.emitters[0].loops,1);assert.equal(repeated.emitters[0].delay,500);
  const count=repeated.particles.length;repeated.seek(690);assert.equal(repeated.particles.length,count);
  repeated.seek(700);assert.equal(repeated.particles.length,count+1,'repeat burst');
  repeated.seek(1000);assert.equal(repeated.emitters[0].rate,0,'no third cycle');
  const burstOnly=emitter({burst:2,parameter88:3},[phase({duration:5000})]);burstOnly.preview={startDelay:100};const bursts=new ParticleSimulation(effect([burstOnly]));bursts.seek(300);assert.equal(bursts.particles.length,6);bursts.seek(500);assert.equal(bursts.particles.length,6);
  const forever=emitter({burst:0,lifetime:1,decay:100,parameter88:-1});const loop=new ParticleSimulation(effect([forever]));loop.seek(100);assert.equal(loop.emitters[0].rate,1);assert.equal(loop.emitters[0].loops,-1);
});

test('gravity, no-translation and local rotations are evaluated independently of scale/alpha', () => {
  const sim=new ParticleSimulation(effect([emitter({direction:[0,1,0]},[phase({flags:2,gravity:10})])]));sim.seek(1000);
  assert.equal(sim.particles.length,0);
  sim.seek(500);close(sim.particles[0].velocity.y,-3);close(sim.particles[0].position.y,-.225);
  const frozen=new ParticleSimulation(effect([emitter({},[phase({flags:32|16,rotation:[0,0,Math.PI]})])]));frozen.seek(500);
  assert.deepEqual(frozen.particles[0].position.toArray(),[0,0,0]);close(new THREE.Vector3(1,0,0).applyQuaternion(frozen.particles[0].rotation).y,1);
});

test('phase direction turns preserve speed and use the supplied effect direction for zero emitter vectors', () => {
  const sim=new ParticleSimulation(effect([emitter({direction:[0,0,0],speed:3},[phase({direction:[0,0,1]})])]),{direction:[0,2,0]});
  sim.seek(500);close(sim.particles[0].velocity.length(),6);close(sim.particles[0].velocity.y,Math.sqrt(18));close(sim.particles[0].velocity.z,Math.sqrt(18));
});

test('seek/restart and random spreads are deterministic, independent of render frame chunks, and isolate saved values', () => {
  const type=effect([emitter({burst:3,lifetime:20,positionSpread:[1,2,3],directionSpread:[.1,.2,.3],speedSpread:.5,scaleSpread:[.5,.5,.5],alphaSpread:.5},[phase({duration:500,durationSpread:100,scaleSpread:[1,1,1],alphaSpread:.5}),phase()])]);
  const original=structuredClone(type),a=new ParticleSimulation(type),b=new ParticleSimulation(type);a.seek(1234);
  for(let t=0;t<1234;t+=17)b.seek(t);b.seek(1234);assert.deepEqual(snapshot(a),snapshot(b));
  const expected=snapshot(a);a.seek(20);a.seek(1234);assert.deepEqual(snapshot(a),expected);a.reset().seek(1234);assert.deepEqual(snapshot(a),expected);
  assert.deepEqual(type,original);
});

test('preview budget bounds extreme emission without looping through discarded particles or invalid seek times', () => {
  const sim=new ParticleSimulation(effect([emitter({burst:2147483647,lifetime:1e30},[phase({duration:60000})])]),{maxParticles:8});
  assert.equal(sim.particles.length,8);sim.seek(60000);assert.ok(sim.particles.length<=8);assert.equal(sim.dropped,Number.MAX_SAFE_INTEGER);
  for(const ms of [-1,60001,NaN,Infinity])assert.throws(()=>sim.seek(ms),/0–60/);
  assert.throws(()=>new ParticleSimulation(effect(),{maxParticles:0}),/limit/);
  assert.throws(()=>new ParticleSimulation(effect(),{direction:[NaN,0,0]}),/směr/);
  for(const value of [null,NaN,Infinity,[0,NaN,0]])assert.throws(()=>new ParticleSimulation(effect([emitter({speed:value})])),/číselný/);
  const delayed=emitter();delayed.preview={startDelay:null};assert.throws(()=>new ParticleSimulation(effect([delayed])),/prodleva/);
  assert.throws(()=>new ParticleSimulation(effect([{...emitter(),warnings:['unknown']}])) ,/nerozpoznané/);
  assert.throws(()=>new ParticleSimulation(effect([emitter({},[])])),/fáze/);
});

function preview() {
  const view=Object.create(ParticleViewport.prototype);
  Object.assign(view,{scene:new THREE.Scene(),root:new THREE.Group(),frames:new Map(),materials:new Set(),camera:new THREE.PerspectiveCamera(50,1,.02,20000),controls:{target:new THREE.Vector3(),update(){}},gizmo:{detach(){},attach(){throw Error('particle preview must not attach a gizmo');}}});view.root.scale.z=-1;view.scene.add(view.root);
  const lod={positions:[0,0,0,2,0,0,0,1,0],normals:[0,0,1,0,0,1,0,0,1],uv:[0,0,1,0,0,1],faces:[{material:1,indices:[0,1,2]}]};
  const frame=(id,parent,position)=>({id,name:id===1?'Part':'Child',type:1,parent,position,scale:[1,1,1],rotation:[1,0,0,0],culling:0,lods:[lod],renderFlags:0x40});
  view.load({materials:[{diffuse:[1,1,1],opacity:.5,flags:0}],meshes:[frame(1,0,[100,200,300]),frame(2,1,[1000,2000,3000])]});
  const source=view.frames.get('1').children.find(n=>n.isMesh), texture=new THREE.Texture(),mask=new THREE.Texture();source.material[0].map=texture;source.material[0].alphaMap=mask;
  return {view,source,texture,mask,dispose(){view.scene.traverse(n=>n.geometry?.dispose());for(const m of view.materials)m.dispose();texture.dispose();mask.dispose();}};
}

test('particle rendering uses only own geometry at emitter positions, independent materials, masks and bounded cleanup',()=>{
  const p=preview(),{view,source,texture,mask}=p;
  try {
    const type=effect([emitter({mode:2,alpha:.5,position:[1,2,3]},[phase({duration:100,alpha:.5}),phase({flags:8,duration:100})])]);view.prepare(type);
    assert.equal(view.root.visible,false);assert.equal(view.partBox.visible,false);assert.equal(view.instances.size,1);
    const instance=view.instances.get(0),mesh=instance.children[0],material=mesh.material[0];
    assert.equal(instance.children.length,1,'source child frame is not duplicated');assert.equal(mesh.geometry,source.geometry);assert.notEqual(material,source.material[0]);
    assert.equal(material.map,texture);assert.equal(material.alphaMap,mask);assert.equal(material.blending,THREE.AdditiveBlending);assert.equal(material.depthWrite,false);close(material.opacity,.25);
    view.scene.updateMatrixWorld(true);assert.deepEqual(instance.getWorldPosition(new THREE.Vector3()).toArray(),[1,2,-3]);
    const camera=view.captureCamera();view.seek(100);assert.equal(instance.visible,false);assert.deepEqual(view.captureCamera(),camera);
    let disposed=0;material.addEventListener('dispose',()=>disposed++);view.seek(200);assert.equal(view.instances.size,0);assert.equal(disposed,1);assert.equal(view.materials.has(material),false);assert.equal(source.material[0].opacity,.5);
    view.restart();assert.equal(view.instances.size,1);view.emitterId='other';view.sync();assert.equal(view.instances.get(0).visible,false);view.emitterId='';view.sync();assert.equal(view.instances.get(0).visible,true);
    assert.throws(()=>view.prepare(effect([emitter({frame:'missing'})])),/geometrii/);
  }finally{p.dispose();}
});

test('continuous preview frames its emitted geometry once and restart keeps that camera',()=>{
  const p=preview();try{p.view.prepare(effect([emitter({burst:0,lifetime:10})]));assert.equal(p.view.simulation.time,0);assert.equal(p.view.instances.size,0);const camera=p.view.captureCamera();assert.ok(Math.abs(camera.target[0])<10);p.view.seek(100);p.view.restart();assert.deepEqual(p.view.captureCamera(),camera);}finally{p.dispose();}
});

test('texture animation follows each particle age, supports independent new births, backwards seek and restart',()=>{
  const p=preview(),frames=Array.from({length:5},()=>({map:new THREE.Texture(),alphaMap:new THREE.Texture()}));
  try {
    p.view.textureAnimations=new Map([[p.source.material[0],{delay:180,names:frames.map((_,i)=>String(i)),frames}]]);
    p.view.prepare(effect([emitter({lifetime:10},[phase({duration:5000})])]));
    const material=id=>p.view.instances.get(id).children[0].material[0];
    assert.equal(material(0).map,frames[0].map);p.view.seek(180);assert.equal(material(0).map,frames[1].map);assert.equal(material(1).map,frames[0].map);assert.equal(material(0).alphaMap,frames[1].alphaMap);
    p.view.seek(360);assert.equal(material(0).map,frames[2].map);p.view.seek(180);assert.equal(material(0).map,frames[1].map);assert.equal(material(1).map,frames[0].map);
    p.view.seek(900);assert.equal(material(0).map,frames[0].map);p.view.restart();assert.equal(material(0).map,frames[0].map);assert.equal(p.source.material[0].map,p.texture);
  }finally{p.dispose();for(const frame of frames){frame.map.dispose();frame.alphaMap.dispose();}}
});
