import test from 'node:test';
import assert from 'node:assert/strict';
import {Vector3} from 'three';
import {osmTerrainSurface} from '../src/plugins/osm/terrain.js';
import {osmSurfaceDefaults} from '../src/plugins/osm/surface.js';
import {osmPropDefaults,osmPropPlan} from '../src/plugins/osm/props.js';
import {osmAmbientDefaults,osmAmbientPlan} from '../src/plugins/osm/ambient.js';
import {frameMatrix} from '../src/shared/scene-world.js';
import {changeSceneObject,inspectScene,editSceneSectorBindings} from '../src/core/scene.js';
import {sceneWorld} from '../src/shared/scene-world.js';

const area={latitude:50,longitude:14,size:100},hash='a'.repeat(64),roads={flat:true,crossings:[{position:[-50,0,0]},{position:[50,0,0]}],roads:[{from:0,to:1,way:10,positions:[]}]};
function surface(fn=(x,z)=>200+x*.02+z*.01,columns=10){return osmTerrainSurface(roads,area,osmSurfaceDefaults,{version:1,area,columns,rows:columns,base:2,samples:Array.from({length:(columns+1)**2},(_,i)=>fn(-50+i%(columns+1)*100/columns,-50+Math.floor(i/(columns+1))*100/columns)),groundTexture:'maps/ground.bmp',groundTileSize:4});}
const ring=(x,z,w,h)=>[[x,z],[x+w,z],[x+w,z+h],[x,z+h],[x,z]];
const catalog=['tree','bench','bin','lamp'].map(kind=>({kind,path:`models/${kind}.4ds`,sha256:hash,min:[-.3,-.4,-.3],max:[.3,kind==='tree'?9.6:kind==='lamp'?5.6:.6,.3],footMin:[-.2,-.4,-.2],footMax:[.2,.2,.2],anchor:[0,-.4,0],vertices:8,...(kind==='tree'?{leaf:'broadleaved'}:{})}));
const source=props=>({area,ways:[],buildings:[],props:props.map(([kind,x,z],i)=>({id:i+1,kind,point:[x,0,z],tags:{direction:'NE'}}))});
const plan=(s,sf,g=null,c=catalog,extra={})=>osmPropPlan(s,sf,c,{...osmPropDefaults,selected:s.props.map(p=>p.id),models:c.map(({path,sha256})=>({path,sha256})),lights:true,...extra},g);
const green=sf=>({elevation:sf.elevation,placements:[{id:20,elevated:true,height:.03,grass:[[ring(-40,10,70,25)]],paths:[]}]});
const sound={...osmAmbientDefaults,spacing:30,sound:{path:'sounds/town.wav',sha256:hash}};

test('rigid props use local full-base support on terrain, sidewalks and parks, with native upright anchors and lamp heights',()=>{
  const sf=surface(),g=green(sf),s=source([['bench',-30,4],['lamp',0,4],['tree',20,20],['bin',-20,-20]]),before=structuredClone(s),r=plan(s,sf,g);assert.equal(r.placements.length,4);assert.deepEqual(s,before);
  for(const p of r.placements){
    const m=catalog.find(m=>m.path===p.model),anchor=new Vector3(...m.anchor).applyMatrix4(frameMatrix(p)),level=p.kind==='tree'?.03:p.kind==='bin'?0:sf.levels.sidewalk;
    assert(Math.abs(anchor.y-p.ground)<1e-6);assert(Math.abs(p.ground-sf.elevation.heightAt(anchor.x,anchor.z)-level)<2e-6);assert.equal(p.support.level,level);assert(p.support.relief>0);assert(new Vector3(0,1,0).transformDirection(frameMatrix(p)).distanceTo(new Vector3(0,1,0))<1e-6);
    for(const [x,z]of p.footprint)assert(Math.abs(sf.elevation.heightAt(x,z)+level-p.ground)<(p.kind==='tree'?.10001:.03001));
    if(p.light){assert(Math.abs(p.light.position[1]-p.ground-p.height+.25*p.scale[1])<2e-6);assert.equal(p.light.parameters.type,1);}
  }
  const benches=plan(source([['bench',-30,4],['bench',30,4]]),sf).placements;assert.equal(benches.length,2);assert(benches[1].ground-benches[0].ground>1);assert.deepEqual(plan(s,sf,g),r);
});

test('base extrema include interior ridges, slopes are explicit and raised layer edges cannot be straddled',()=>{
  const sf=surface((x,z)=>200+(x===0&&z===0?.3:0),2),wide=[{...catalog[1],min:[-30,-.4,-30],max:[30,.6,30],footMin:[-30,-.4,-30],footMax:[30,.2,30]}];
  // Put the road outside this test base; corner heights alone are all flat.
  const noStreets={...sf,footprints:{road:[],sidewalk:[]}},r=plan(source([['bench',0,0]]),noStreets,null,wide);assert.equal(r.placements.length,0);assert.match(r.skipped[0].reason,/6 cm/);
  const steep=plan(source([['lamp',20,20]]),surface((x,z)=>200+x*.3+z*.2));assert.equal(steep.placements.length,0);assert.match(steep.skipped[0].reason,/usazení/);
  const regular=surface();assert.match(plan(source([['bench',20,4.9]]),regular).skipped[0].reason,/hranu/);assert.match(plan(source([['bin',-39.9,20]]),regular,green(regular)).skipped[0].reason,/hranu zeleně/);
});

test('terrain sound emitters sit 1.5m above their own street/park surface and survive native scene serialization',()=>{
  const sf=surface(),g=green(sf),s=source([]),r=osmAmbientPlan(s,roads,sf,g,{version:1,streets:sound,green:sound});assert(r.placements.some(p=>p.kind==='streets'));assert(r.placements.some(p=>p.kind==='green'));
  const heights=new Set();for(const p of r.placements){const level=p.kind==='streets'?sf.levels.road:.03;assert(Math.abs(p.position[1]-sf.elevation.heightAt(p.position[0],p.position[2])-level-1.5)<2e-6);heights.add(p.position[1]);}assert(heights.size>2);
  const chunk=(type,p)=>{const h=Buffer.alloc(6);h.writeUInt16LE(type);h.writeUInt32LE(p.length+6,2);return Buffer.concat([h,p]);};let bytes=chunk(0x4c53,chunk(0x4000,Buffer.alloc(0)));
  const lamp=plan(source([['lamp',0,4]]),sf).placements[0];bytes=changeSceneObject(bytes,{kind:'add-model',name:lamp.name,model:'lamp.i3d',position:lamp.position,rotation:lamp.rotation,scale:lamp.scale},[],[]);bytes=changeSceneObject(bytes,{kind:'add-light',name:lamp.light.name,position:lamp.light.position,rotation:[1,0,0,0],parameters:lamp.light.parameters},[],[]);
  let scene=inspectScene(bytes),light=scene.objects.find(o=>o.name===lamp.light.name),position=new Vector3(...lamp.light.position).applyMatrix4(frameMatrix(lamp).invert()).toArray();bytes=editSceneSectorBindings(bytes,light.id,{parent:lamp.name,transform:{position,rotation:[lamp.rotation[0],0,-lamp.rotation[2],0],scale:lamp.scale.map(n=>1/n)}});
  for(const p of r.placements)bytes=changeSceneObject(bytes,{kind:'add-sound',name:p.name,position:p.position,rotation:[1,0,0,0],parameters:p.parameters},[],[]);scene=inspectScene(bytes);
  for(const p of r.placements)assert.deepEqual(scene.objects.find(o=>o.name===p.name).position,p.position);
  const world=sceneWorld(scene,{meshes:[]});light=scene.objects.find(o=>o.name===lamp.light.name);assert(new Vector3().setFromMatrixPosition(world(light.name)).distanceTo(new Vector3(...lamp.light.position))<2e-6);
});

test('mixed height fields, wrong areas and planar offsets are rejected before props or sounds are placed',()=>{
  const sf=surface(),s=source([['lamp',20,20]]),g=green(sf),alien=surface();
  for(const bad of [{...g,elevation:alien.elevation},{...g,elevation:undefined},{...g,placements:g.placements.map(p=>({...p,elevated:false}))}]){assert.throws(()=>plan(s,sf,bad),/stejný výškový/);assert.throws(()=>osmAmbientPlan(s,roads,sf,bad,{version:1,green:sound}),/stejný výškový/);}
  const wrong={...s,area:{...area,size:200}};assert.throws(()=>plan(wrong,sf),/jiné oblasti/);assert.throws(()=>osmAmbientPlan(wrong,roads,sf,null,{version:1,streets:sound}),/jiné oblasti/);assert.throws(()=>plan(s,sf,null,catalog,{ground:1}),/0 m/);
  const planar={...sf,elevation:undefined};assert.throws(()=>plan(s,planar,g),/stejný výškový/);assert.throws(()=>osmAmbientPlan(s,roads,planar,g,{version:1,green:sound}),/stejný výškový/);
});
