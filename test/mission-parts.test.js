import test from 'node:test';
import assert from 'node:assert/strict';
import { missionParts } from '../src/shared/mission-parts.js';
import { MissionViews } from '../src/ui/mission-views.js';

const assets = ['MISSIONS/TUTORIAL/SCENE2.BIN','missions/tutorial/scene.4ds','Missions/Tutorial/CHECK.bin','missions/TUTORIAL/road.bin','missions/tutorial/effects.bin','missions/tutorial/tree.klz','missions/OTHER/check.bin','models/scene.4ds'].map(path=>({path}));
test('logic keeps selection, scroll and panels separately from the 3D camera and other projects',()=>{
  const saved=new MissionViews(),value={selectedId:'script:0/1',search:'Quest',all:false,left:300,top:25,outlineHidden:true,inspectorHidden:false};
  saved.remember({projectRoot:'/project',logicPath:'missions/tutorial/scene2.bin',captureLogic:()=>({...value})});
  assert.deepEqual(saved.get('/project',{path:'MISSIONS/TUTORIAL/SCENE2.BIN',type:'logic'}),value);
  assert.equal(saved.get('/project',{path:'missions/tutorial/scene2.bin',type:'map'}),null);
  assert.equal(saved.get('/another',{path:'missions/tutorial/scene2.bin',type:'logic'}),null);
});
test('mission links resolve the exact mixed-case manifest paths and exclude other missions and unavailable parts',()=>{
  const parts=missionParts(assets,'missions\\tutorial\\SCENE2.bin');
  assert.deepEqual(parts.map(part=>part.type),['map','logic','scene','model','navigation','roads','effects','collision']);
  assert.equal(parts.find(part=>part.type==='navigation').path,'Missions/Tutorial/CHECK.bin');
  assert.equal(parts.find(part=>part.type==='map').path,parts.find(part=>part.type==='scene').path);
  assert.equal(parts.some(part=>/other|models\//i.test(part.path)),false);
  assert.deepEqual(missionParts(assets,'models/scene.4ds'),[]);
  assert.deepEqual(missionParts(assets,'missions/tutorial/nested/scene2.bin'),[]);
});
test('returning from another mission/editor retains camera, selection, display settings and project isolation',()=>{
  const saved=new MissionViews(),camera={position:[1.2,3.4,-5.6],target:[7,8,9],near:.001,far:20000};
  const map={projectRoot:'/project',mapPath:assets[0].path,selectedName:'Tommy',gizmo:{mode:'rotate'},backdrop:{visible:false},collisionOverlay:{visible:true},soundExtentVisible:false,lightPreviewVisible:true,missionAreasVisible:false,captureCamera:()=>structuredClone(camera)};
  saved.remember(map);
  saved.remember({projectRoot:'/project',navigationPath:'missions/tutorial/check.bin',selectedPoint:28,navigationGeometryWanted:true,captureCamera:()=>({ ...camera,position:[100,2,3] })});
  saved.remember({...map,mapPath:'missions/OTHER/scene2.bin',selectedName:'Other',captureCamera:()=>({...camera,position:[99,4,3]})});
  const value=saved.get('/project',{path:'missions/tutorial/scene2.bin',type:'map'});
  assert.equal(value.areas,false);
  assert.deepEqual(value.camera,camera);assert.equal(value.selectedName,'Tommy');assert.equal(value.mode,'rotate');assert.equal(value.collisions,true);assert.equal(value.sounds,false);
  assert.equal(saved.get('/project',{path:'MISSIONS/TUTORIAL/CHECK.BIN',type:'navigation'}).selectedPoint,28);
  assert.equal(saved.get('/project',{path:map.mapPath,type:'scene'}),null);
  assert.equal(saved.get('/different-project',{path:map.mapPath,type:'map'}),null);
  saved.remember({...map,disposed:true,selectedName:'Should not overwrite'});
  assert.equal(saved.get('/project',{path:map.mapPath,type:'map'}).selectedName,'Tommy');
  saved.clear();assert.equal(saved.get('/project',{path:map.mapPath,type:'map'}),null);
});
test('mission view memory does not retain unrelated models and tracks, and preserves point zero',()=>{
  const saved=new MissionViews(),camera={position:[1,2,3],target:[0,0,0],near:.02,far:20000};
  saved.remember({projectRoot:'/project',modelPath:'models/car.4ds',gizmo:{mode:'translate'},captureCamera:()=>camera});
  saved.remember({projectRoot:'/project',roadPath:'missions/tutorial/road.bin',selectedPoint:0,roadGeometryWanted:false,roadLanesVisible:false,captureCamera:()=>camera});
  assert.equal(saved.get('/project',{path:'models/car.4ds',type:'model'}),null);
  assert.equal(saved.get('/project',{path:'missions/tutorial/road.bin',type:'roads'}).selectedPoint,0);
  assert.equal(saved.get('/project',{path:'missions/tutorial/road.bin',type:'roads'}).lanes,false);
});

test('collision view keeps its filtered selection, camera and geometry scoped to the project',()=>{
  const saved=new MissionViews(),camera={position:[1,2,3],target:[0,0,0],near:.02,far:20000};
  saved.remember({projectRoot:'/project',collisionPath:'missions/tutorial/tree.klz',selectedId:'aabbs/0',collisionSearch:'crate',collisionType:'aabbs',collisionGeometryWanted:true,gizmo:{mode:'scale'},captureCamera:()=>camera});
  const value=saved.get('/project',{path:'MISSIONS/TUTORIAL/TREE.KLZ',type:'collision'});
  assert.deepEqual(value,{selectedId:'aabbs/0',search:'crate',type:'aabbs',mode:'scale',geometry:true,camera});
  assert.equal(saved.get('/other',{path:'missions/tutorial/tree.klz',type:'collision'}),null);
});

test('segment editor is a mission part and retains its selection and camera across editors',()=>{
  const path='MISSIONS/TUTORIAL/CLUSTERS.SEG',camera={position:[1,2,3],target:[0,0,0]},saved=new MissionViews();
  assert.equal(missionParts([...assets,{path}],'missions/tutorial/check.bin').find(p=>p.type==='segments').path,path);
  saved.remember({projectRoot:'/project',segmentsPath:path,segmentIndex:0,captureCamera:()=>camera});
  assert.deepEqual(saved.get('/project',{path:path.toLowerCase(),type:'segments'}),{index:0,special:undefined,selectedPoint:undefined,geometry:undefined,camera});
  assert.equal(saved.get('/another',{path,type:'segments'}),null);
});
