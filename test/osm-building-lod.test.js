import test from 'node:test';
import assert from 'node:assert/strict';
import {Triangle,Vector3} from 'three';
import {osmBuildingSupport} from '../src/plugins/osm/building-terrain.js';
import {osmTerrainSurface} from '../src/plugins/osm/terrain.js';
import {osmSurfaceDefaults} from '../src/plugins/osm/surface.js';
import {osmFacadePanels} from '../src/plugins/osm/building-facades.js';
import {osmFacadeLodPanels} from '../src/plugins/osm/building-lod.js';
import {osmShellModel,osmShellPlan,osmShellStyles} from '../src/plugins/osm/building-shells.js';
import {osmRoofPlan,osmRoofDefaults} from '../src/plugins/osm/building-roofs.js';
import {writeSurfaceModel} from '../src/core/surface-model.js';
import {parseFourDs} from '../src/core/fourds.js';
import {modelCollisionSurface} from '../src/core/model-collision.js';

const facade={version:1},lod={version:1,distance:80},outer=[[-13,-8],[13,-8],[13,8],[-13,8]],hole=[[-5,-3],[5,-3],[5,3],[-5,3]];
const item=(style='brick',height=18,polygon=[outer,hole])=>({style,height,polygon,position:[0,.2,0],rotation:[1,0,0,0],scale:[1,1,1],facade});
const count=l=>l.faces.reduce((n,f)=>n+f.indices.length/3,0);
const sample=(p,x,y)=>[p.uv[0]+(p.uv[2]-p.uv[0])*(x-p.x0)/(p.x1-p.x0),p.uv[3]+(p.uv[1]-p.uv[3])*(y-p.y0)/(p.y1-p.y0)];
test('distant panels preserve every sampled material and UV phase across all facade styles and narrow walls',()=>{
  let savings=0;
  for(const style of osmShellStyles)for(const length of [.02,1,5.31,13.7,37,300])for(const trim of [2.75,5.23,11.75,26.1,119.75]){
    const near=osmFacadePanels(length,Math.min(trim,style.groundHeight),trim,style),before=structuredClone(near),far=osmFacadeLodPanels(near);
    assert.deepEqual(near,before);assert(far.length<=near.length);savings+=near.length-far.length;
    for(const p of near)for(const [u,v]of [[.17,.31],[.5,.5],[.89,.93]]){
      const x=p.x0+(p.x1-p.x0)*u,y=p.y0+(p.y1-p.y0)*v,matches=far.filter(q=>x>q.x0&&x<q.x1&&y>q.y0&&y<q.y1);
      assert.equal(matches.length,1);assert.equal(matches[0].material,p.material);
      const a=sample(p,x,y),b=sample(matches[0],x,y);for(let k=0;k<2;k++)assert(Math.abs(a[k]-b[k]-Math.round(a[k]-b[k]))<1e-7,`${style.id}: changed UV phase`);
    }
    const area=panels=>panels.reduce((n,p)=>n+(p.x1-p.x0)*(p.y1-p.y0),0);assert(Math.abs(area(near)-area(far))<1e-7);
  }
  assert(savings>1000);
});
test('LOD merging refuses changes in material, window scale, phase, width or wall continuity',()=>{
  const lower={x0:0,x1:5,y0:0,y1:2,material:2,uv:[0,.5,1,1]},upper={...lower,y0:2,y1:4,uv:[0,0,1,.5]};
  assert.equal(osmFacadeLodPanels([lower,upper]).length,1);
  for(const changed of [{material:5},{x1:4},{y0:2.1},{uv:[0,.1,1,.5]},{uv:[0,.1,1,.6]},{uv:[.1,0,1.1,.5]}])assert.equal(osmFacadeLodPanels([lower,{...upper,...changed}]).length,2);
});
test('native house LOD keeps all editable close geometry, roof, courtyard and LOD0 collision exactly intact',()=>{
  let reduced=0;
  for(const style of osmShellStyles)for(const shape of ['flat','gabled','skillion']){
    const polygon=shape==='gabled'?[outer]:[outer,hole],p=item(style.id,18,polygon);
    Object.assign(p,osmRoofPlan({'roof:shape':shape},polygon,{height:p.height,estimated:false},osmRoofDefaults));
    const before=structuredClone(p),original=osmShellModel(p),model=osmShellModel({...p,lod}),near=model.meshes[0].lods[0],far=model.meshes[0].lods.at(-1);
    assert.deepEqual(p,before);assert.deepEqual({...near,distance:0},original.meshes[0].lods[0]);assert.deepEqual(model.materials,original.materials);
    assert(count(far)<=count(near));if(model.meshes[0].lods.length===2){reduced++;assert.equal(near.distance,6400);assert(count(far)<count(near));}else assert.equal(near.distance,0);
    assert.equal(far.distance,0);
    const roof=l=>l.faces.filter(f=>[3,4].includes(f.material)).flatMap(f=>f.indices.map(i=>[...l.positions.slice(i*3,i*3+3),...l.uv.slice(i*2,i*2+2)]));assert.deepEqual(roof(far),roof(near));
    for(let k=0;k<3;k++){const axis=l=>l.positions.filter((_,i)=>i%3===k);assert.equal(Math.min(...axis(near)),Math.min(...axis(far)));assert.equal(Math.max(...axis(near)),Math.max(...axis(far)));}
    const bytes=writeSurfaceModel(model),parsed=parseFourDs(bytes,'all');assert.equal(parsed.meshes[0].lods.length,model.meshes[0].lods.length);assert.deepEqual(bytes,writeSurfaceModel(osmShellModel(JSON.parse(JSON.stringify({...p,lod})))));
    const object={...p,id:1,name:'HOUSE',frameType:9,model:'house.4ds'},collision=m=>modelCollisionSurface(parseFourDs(writeSurfaceModel(m),true),object,{objects:[object]},{meshes:[]});assert.deepEqual(collision(model),collision(original));
  }
  assert(reduced>100);
});
test('planner persists explicit distance and measured savings; legacy and unhelpful LOD stay single level',()=>{
  const source={area:{size:100},ways:[],buildings:[{id:1,tags:{building:'yes'},polygons:[[outer,hole]]}]},surface={model:{meshes:[]},footprints:{road:[],sidewalk:[]}},options={version:1,mode:'footprint',selected:[1],styles:[{id:'brick'}],ground:.2,fallbackHeight:18,facade};
  const legacy=osmShellPlan(source,{},surface,options),modern=osmShellPlan(source,{},surface,{...options,lod}),p=modern.placements[0];
  assert.equal(legacy.placements[0].lod,undefined);assert.equal(legacy.placements[0].lodPlan,undefined);assert.deepEqual(p.lod,lod);assert.equal(p.triangles,legacy.placements[0].triangles);assert.equal(p.lodPlan.nearTriangles,p.triangles);assert(p.lodPlan.farTriangles<p.triangles);assert.equal(p.lodPlan.levels,2);assert.deepEqual(modern,osmShellPlan(source,{},surface,JSON.parse(JSON.stringify({...options,lod}))));
  const small={...item('brick',3,[outer]),lod};assert.equal(osmShellModel(small).meshes[0].lods.length,1);
  for(const bad of [null,false,{},1,{version:2,distance:80},{version:1,distance:NaN},{version:1,distance:24.9},{version:1,distance:251},{version:1,distance:'80'},{...lod,other:true}]){
    assert.throws(()=>osmShellModel({...item(),lod:bad}),/vzdálené domy/);assert.throws(()=>osmShellPlan(null,null,null,{...options,lod:bad}),/vzdálené domy/);
  }
  assert.throws(()=>osmShellModel({...item(),facade:undefined,lod}),/celá okna/);
});

test('serialized far geometry preserves sampled texture coordinates and normals across repeated atlas wraps',()=>{
  for(const style of osmShellStyles){
    const model=parseFourDs(writeSurfaceModel(osmShellModel({...item(style.id,60),lod})),'all'),[near,far]=model.meshes[0].lods;assert(far);
    const triangles=l=>l.faces.flatMap(f=>Array.from({length:f.indices.length/3},(_,i)=>{const ids=f.indices.slice(i*3,i*3+3);return {material:f.material,ids,triangle:new Triangle(...ids.map(id=>new Vector3(...l.positions.slice(id*3,id*3+3))))};})),distant=triangles(far);
    for(const t of triangles(near)){
      const point=t.triangle.a.clone().multiplyScalar(.19).addScaledVector(t.triangle.b,.33).addScaledVector(t.triangle.c,.48),q=distant.find(q=>q.material===t.material&&q.triangle.closestPointToPoint(point,new Vector3()).distanceTo(point)<1e-5);assert(q,style.id+' missing surface');
      const bary=q.triangle.getBarycoord(point,new Vector3()).toArray();
      for(let k=0;k<2;k++){const a=t.ids.reduce((v,id,i)=>v+near.uv[id*2+k]*[.19,.33,.48][i],0),b=q.ids.reduce((v,id,i)=>v+far.uv[id*2+k]*bary[i],0);assert(Math.abs(a-b-Math.round(a-b))<2e-4,style.id+' changed serialized UV phase');}
      assert(t.triangle.getNormal(new Vector3()).distanceTo(q.triangle.getNormal(new Vector3()))<1e-5);
    }
  }
});
test('sloped foundations remain single level and unchanged, including their collision and material references',()=>{
  const area={latitude:50,longitude:14,size:100},roads={flat:true,crossings:[{position:[-50,0,-40]},{position:[50,0,-40]}],roads:[{from:0,to:1,positions:[]}]},surface=osmTerrainSurface(roads,area,osmSurfaceDefaults,{version:1,area,columns:10,rows:10,base:2,samples:Array.from({length:121},(_,i)=>200+(-50+i%11*10)*.03+(-50+Math.floor(i/11)*10)*.02),groundTexture:'maps/ground.bmp',groundTileSize:4}),p=item();
  p.support=osmBuildingSupport(surface,area,p.polygon,.1);p.position[1]=p.support.ground;
  const original=osmShellModel(p),model=osmShellModel({...p,lod});assert.equal(model.meshes[0].lods.length,2);assert.deepEqual(model.meshes[1],original.meshes[1]);assert.equal(model.meshes[1].lods.length,1);assert.deepEqual(model.materials,original.materials);
  const object={...p,id:1,name:'HOUSE',frameType:9,model:'house.4ds'},collision=m=>modelCollisionSurface(parseFourDs(writeSurfaceModel(m),true),object,{objects:[object]},{meshes:[]});assert.deepEqual(collision(model),collision(original));
});
