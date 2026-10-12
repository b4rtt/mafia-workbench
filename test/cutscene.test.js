import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cutsceneResource, replayMissions, sceneReplayReferences, cutsceneAudioEvents, loadCutsceneContext } from '../src/core/cutscene.js';
import { CutsceneViewport, CutsceneAudio, sampleReplayActor, activeCutsceneAudio } from '../src/ui/cutscene.js';

test('cutscene resources use indexed engine aliases and reject traversal and fuzzy matches',()=>{
  const assets=[{path:'models/Tommy.4DS'},{path:'anims/Walk.5DS'},{path:'sounds/00000012.wav'}];
  assert.equal(cutsceneResource(assets,'Tommy.i3d','models','.4ds'),'models/Tommy.4DS');
  assert.equal(cutsceneResource(assets,'ANIMS\\walk.I3D','anims','.5ds'),'anims/Walk.5DS');
  for(const name of ['../Tommy.i3d','/Tommy.i3d','somewhere/Tommy.i3d','TommyX.i3d'])assert.equal(cutsceneResource(assets,name,'models','.4ds'),null);
});
function scriptScene(code){
  const chunk=(type,payload)=>{const h=Buffer.alloc(6);h.writeUInt16LE(type);h.writeUInt32LE(payload.length+6,2);return Buffer.concat([h,payload]);};
  const kind=Buffer.alloc(4);kind.writeUInt32LE(5);const header=Buffer.alloc(14);header[0]=header[1]=header[5]=1;header.writeUInt32LE(Buffer.byteLength(code),10);
  return chunk(0x4c53,chunk(0xae20,chunk(0xae21,Buffer.concat([chunk(0xae23,Buffer.from('Init\0')),chunk(0xae22,kind),chunk(0xae24,Buffer.concat([header,Buffer.from(code)]))]))));
}
test('mission suggestions pair only the selected REP with its adjacent CHG and preserve ambiguity',async()=>{
  const assets=['records/Test.rep','missions/A/scene2.bin','missions/B/scene2.bin','missions/C/scene2.bin','diff/First.chg','diff/Second.chg'].map(path=>({path}));
  const scripts=['loaddifferences "Second.chg"\nrecloadfull "Other.rep"\nloaddifferences "First.chg"\n// selected scene\n\nrecloadfull "TEST.rep"','loaddifferences "First.chg"\nrecload "Test.rep"\nloaddifferences "Second.chg"\nrecloadfull "Test.rep"','// recloadfull "Test.rep"\nrecloadfull "OtherTest.rep"'];
  const project={manifest:{assets},asset:name=>assets.find(a=>a.path===name),read:async name=>scriptScene(scripts[assets.findIndex(a=>a.path===name)-1])};
  assert.deepEqual(await replayMissions(project,'records/Test.rep'),[{path:assets[1].path,differences:['diff/First.chg']},{path:assets[2].path,differences:['diff/First.chg','diff/Second.chg']}]);
});
test('mission prelude preserves literal visibility and rejects control flow or dynamic frame assignments',()=>{
  const script='dim_frm 2\nfindframe 0,"Base"\nfrm_seton 0,1\nloaddifferences "Earlier.chg"\nrecloadfull "Earlier.rep"\nrecwaitforend\ncleardifferences\nfrm_seton 0,0\nfindframe 1,"Prop"\nfrm_seton 1,1\nloaddifferences "Selected.chg"\nrecloadfull "Selected.rep"';
  const scene=code=>({actorScripts:[{name:'Init',code}],entries:[]});
  assert.deepEqual(sceneReplayReferences(scene(script),'selected.rep'),[{difference:'Selected.chg',visibility:[{name:'Base',visible:false},{name:'Prop',visible:true}]}]);
  for(const command of ['goto 10','label 10','if flt[0],1,10','findframe 0,frm[1]','let frm[0] = frm[1]'])assert.equal(sceneReplayReferences(scene(command+'\n'+script),'selected.rep')[0].visibility,null);
  const interrupted=scene('loaddifferences "Selected.chg"\nwait 100\nrecloadfull "Selected.rep"');assert.equal(sceneReplayReferences(interrupted,'selected.rep')[0].difference,null);
  const trigger='dim_frm 1\nfindframe 0,"Base"\nlabel 1\nif flt[0]=1,-1,1\n';
  const block='commandblock 1\nfrm_seton 0,0\nloaddifferences "Selected.chg"\nrecloadfull "SELECTED"';
  assert.deepEqual(sceneReplayReferences(scene(trigger+block),'selected.rep'),[{difference:'Selected.chg',visibility:[{name:'Base',visible:false}]}]);
  for(const command of ['findframe 0,"Other"','findframe flt[0],"Other"','dim_frm 2','let frm[0] = frm[1]'])assert.equal(sceneReplayReferences(scene(trigger+command+'\n'+block),'selected.rep')[0].visibility,null);
  for(const command of ['commandblock 0','goto 10'])assert.equal(sceneReplayReferences(scene(trigger+block.replace('frm_seton 0,0',command+'\nfrm_seton 0,0')),'selected.rep')[0].visibility,null);
});
test('sound state zero enables a named frame and dialogue clips stop at the next line on their channel',()=>{
  const replay={duration:10000,events:{sounds:[{index:0,time:0,name:'Town',state:1},{index:1,time:100,name:'TOWN',state:0},{index:2,time:400,name:'Town',state:1}],dialogues:[{index:0,time:0,character:0,textId:1,command:true},{index:1,time:100,character:0,textId:12},{index:2,time:200,character:1,textId:13},{index:3,time:800,character:0,textId:14}]}};
  const assets=['sounds/town.wav','sounds/00000012.wav','sounds/00000013.wav'].map(path=>({path})),events=cutsceneAudioEvents(replay,[{frameType:4,name:'Town',resource:'town.wav'}],assets,new Map([[12,'Český dialog']]));
  assert.equal(events.length,4);assert.deepEqual(events[0],{id:'sound/1',channel:'sound/town',start:100,end:400,path:'sounds/town.wav',loop:false,kind:'sound'});
  assert.equal(events[1].text,'Český dialog');assert.equal(events[1].end,800);assert.equal(events[3].path,null);
  const durations=new Map(assets.map(a=>[a.path,.5]));assert.equal(activeCutsceneAudio(events,durations,200).length,3);assert.equal(activeCutsceneAudio(events,durations,700).length,0);
});
test('scene context combines CHG overrides, animation IDs and Czech text without modifying project data',async()=>{
  const objects=[{id:'original',name:'Tommy',frameType:9,model:'old.i3d',position:[0,0,0],fields:{}}],geometry={meshes:[]};
  const replay={type:'replay',duration:1000,tracks:[{keys:[{animationFlags:0x400}]}],channels:[{id:'animations',records:[{animationId:0,prefix:'animations/0/'}]}],entries:[{id:'animations/0/name',value:'Walk.i3d'}],events:{sounds:[],dialogues:[{index:0,time:0,character:0,textId:12}]}};
  const difference={type:'difference',objects:[{index:0,name:'TOMMY',frameType:9,resource:'Tommy.i3d',position:[1,2,3]}]};
  const assets=['models/Tommy.4ds','anims/Walk.5ds','sounds/00000012.wav','tables/textdb_cz.def'].map(path=>({path}));
  const before=structuredClone({objects,replay,difference});
  const actorScripts=[{name:'Init',code:'dim_frm 1\nfindframe 0,"Tommy"\nfrm_seton 0,0\nloaddifferences "Test.chg"\nrecloadfull "Test.rep"'}];
  // Engine difference resources normally reside under diff/.
  assets.push({path:'diff/Test.chg'});
  const project={manifest:{assets},inspectMap:async()=>({path:'missions/A/scene2.bin',objects,geometry,actorScripts}),inspect:async name=>name==='Test.rep'?replay:name==='diff/Test.chg'?difference:{entries:[{id:12,text:'Ahoj'}]}};
  const context=await loadCutsceneContext(project,'Test.rep','missions/A/scene2.bin','diff/Test.chg');assert.equal(context.objects.length,1);assert.equal(context.objects[0].modelPath,'models/Tommy.4ds');assert.equal(context.animations[0].path,'anims/Walk.5ds');assert.equal(context.audio[0].text,'Ahoj');assert.deepEqual({objects,replay,difference},before);assert.deepEqual(context.visibility[0],{time:0,index:-1,changes:[{name:'Tommy',visible:false}]});
  await assert.rejects(loadCutsceneContext(project,'Test.rep','../scene2.bin'),/scene2/);
});
test('actor sampling respects hold flags, animation ID changes, frame offsets and loop state',()=>{
  const track={keys:[{index:0,time:0,position:[0,0,0],rotation:[1,0,0,0],animationFlags:0x400},{index:1,time:100,position:[10,0,0],rotation:[0,0,1,0],animationFlags:0x400},{index:2,time:200,position:[20,0,0],rotation:[1,0,0,0],animationFlags:0x2401,animationFrame:2},{index:3,time:300,position:[30,0,0],rotation:[1,0,0,0],animationFlags:0xa401}]},before=structuredClone(track);
  assert.equal(sampleReplayActor(track,50).position[0],5);assert.equal(sampleReplayActor(track,50).animationTime,50);
  const pose=sampleReplayActor(track,250);assert.equal(pose.animationId,1);assert.equal(pose.animationTime,130);assert.equal(pose.loop,true);assert.equal(sampleReplayActor(track,350).position[0],30);assert.deepEqual(track,before);
  track.keys[0].animationFlags|=0x8000;assert.equal(sampleReplayActor(track,50).position[0],0);assert.equal(sampleReplayActor({keys:[]},0),null);
});

function viewport(){const view=Object.create(CutsceneViewport.prototype);Object.assign(view,{root:new THREE.Group(),frames:new Map(),materials:new Set(),skinWarnings:[],camera:new THREE.PerspectiveCamera(),grid:{visible:true},controls:{target:new THREE.Vector3(),update(){},enabled:true},loadTextures:async()=>{}});view.root.scale.z=-1;return view;}
const boneModel={materials:[],meshes:[{id:1,name:'Lhand',type:10,parent:0,position:[0,0,0],rotation:[1,0,0,0],scale:[1,1,1]}]};
test('cutscene binding qualifies duplicated bone names, animates them and applies child poses after skeletons',async()=>{
  const view=viewport(),file={cameras:[{time:0,flags:1,position:[0,1,-2],fov:1,roll:0},{time:400,flags:1,position:[0,1,-4],fov:.5,roll:0}],focus:[{time:0,position:[0,1,0]},{time:400,position:[0,1,0]}],tracks:[{name:'Tommy',keys:[{index:0,time:0,position:[1,0,0],rotation:[1,0,0,0],animationFlags:0x400},{index:1,time:400,position:[5,0,0],rotation:[1,0,0,0],animationFlags:0x400}]},{name:'Tommy.Lhand',keys:[{index:0,time:0,position:[0,3,0],rotation:[1,0,0,0]}]}]};
  view.loadReplay(file);const context={warnings:[],geometry:{materials:[],meshes:[]},objects:[{id:'tom',name:'Tommy',frameType:9,fields:{},modelPath:'models/Tommy.4ds',position:[0,0,0]},{id:'norm',name:'Norman',frameType:9,fields:{},modelPath:'models/Tommy.4ds',position:[10,0,0]}],animations:[{id:0,path:'anims/Walk.5ds'}]};
  const animation={type:'animation',frames:10,nodes:[{id:0,name:'Lhand',tracks:{position:{times:[0,10],values:[[0,0,0],[0,2,0]]}}}]};
  const result=await view.loadContext(context,async name=>name.endsWith('.5ds')?animation:{type:'model',...boneModel},()=>null);assert.equal(result.actors,2);view.seek(200);assert.equal(view.frames.get('scene:tom').position.x,3);assert.equal(view.frames.get('scene:tom/1').position.y,3);assert.equal(view.frames.get('scene:norm/1').position.y,0);
  view.cameraMode(true);assert.equal(view.controls.enabled,false);assert.ok(Math.abs(view.camera.position.z-3)<1e-6);assert.ok(Math.abs(view.camera.fov-THREE.MathUtils.radToDeg(.75))<1e-6);
  view.updateEntry('objects/0/1/position',[9,0,0]);assert.equal(view.frames.get('scene:tom').position.x,5);assert.equal(file.tracks[0].keys[1].position[0],5);view.cameraMode(false);assert.equal(view.controls.enabled,true);
});
test('audio seeking replaces active sources, pauses all channels and releases them on disposal',async()=>{
  const sources=[],context={currentTime:1,destination:{},createGain:()=>({gain:{value:1},connect(){},disconnect(){}}),createBufferSource(){const source={connect(){},disconnect(){},start(...args){this.offset=args[1];},stop(){this.stopped=true;}};sources.push(source);return source;},resume:async()=>{},close:async()=>{context.closed=true;}};
  const audio=new CutsceneAudio(context);audio.events=[{id:'line',path:'voice',start:0,end:5000,loop:false}];audio.buffers.set('voice',{});audio.durations.set('voice',3);
  await audio.unlock();audio.sync(1000,true);assert.equal(sources[0].offset,1);context.currentTime=1.1;audio.sync(1100,true);assert.equal(sources.length,1);audio.sync(2000,true);assert.equal(sources[0].stopped,true);assert.equal(sources[1].offset,2);
  audio.sync(2000,false);assert.equal(audio.sources.size,0);audio.sync(2500,true);audio.mute(true);assert.equal(audio.gain.gain.value,0);audio.sync(3000,true);assert.equal(audio.sources.size,0);audio.dispose();assert.equal(context.closed,true);assert.equal(audio.buffers.size,0);
});
test('plain model actor animations use direct IDs and a frame offset on each key',()=>{
  const track={kind:1,keys:[{index:0,time:100,position:[0,0,0],rotation:[1,0,0,0],modelAnimationFlags:0x3016,modelAnimationId:22,modelAnimationFrame:5},{index:1,time:500,position:[10,0,0],rotation:[1,0,0,0],modelAnimationFlags:0x9016,modelAnimationId:22,modelAnimationFrame:15},{index:2,time:900,position:[20,0,0],rotation:[1,0,0,0],modelAnimationFlags:0}]},before=structuredClone(track);
  assert.equal(sampleReplayActor(track,200).animationId,22);assert.equal(sampleReplayActor(track,200).animationTime,300);assert.equal(sampleReplayActor(track,200).loop,true);
  assert.equal(sampleReplayActor(track,700).animationTime,800);assert.equal(sampleReplayActor(track,700).position[0],10);assert.equal(sampleReplayActor(track,950).animationId,null);assert.deepEqual(track,before);
});
test('visibility preview reads only straight-line literal frame toggles and rejects control flow',async()=>{
  const {cutsceneVisibilityEvents}=await import('../src/core/cutscene.js');
  const replay={events:{scripts:[{index:0,time:0,name:'INIT'},{index:1,time:200,name:'Swap'},{index:2,time:300,name:'Unsafe'}]}};
  const scripts=[{name:'Init',code:'dim_frm 2\ncommandblock 1\nfindframe 0,"Original"\nfindframe 1,"Blood"\nfrm_seton 0,1\nfrm_seton 1,0\ncommandblock 0'},{name:'Swap',code:'findframe 0,"Original"\nfrm_seton 0,0\nfindframe 0,"Blood"\nfrm_seton 0,1'},{name:'Unsafe',code:'findframe 0,"Original"\nfrm_seton 0,0\nif 1\nfrm_seton 0,1'}];
  const result=cutsceneVisibilityEvents(replay,scripts);assert.equal(result.events.length,2);assert.equal(result.events[1].changes[1].name,'Blood');assert.equal(result.warnings.length,1);assert.match(result.warnings[0],/Unsafe/);
});
test('seeking across a character replacement restores visibility in both directions',async()=>{
  const view=viewport();view.loadReplay({cameras:[],focus:[],tracks:[]});
  const context={warnings:[],geometry:{materials:[],meshes:[]},objects:['Original','Blood'].map(name=>({id:name,name,frameType:9,fields:{},modelPath:'model'})),animations:[],visibility:[{time:0,index:0,changes:[{name:'Original',visible:true},{name:'Blood',visible:false}]},{time:200,index:1,changes:[{name:'Original',visible:false},{name:'Blood',visible:true}]}]};
  const result=await view.loadContext(context,async()=>({type:'model',...boneModel}),()=>null);assert.equal(result.warnings.length,0);
  for(const time of [0,199,300,100]){view.seek(time);assert.equal(view.frames.get('scene:Original').visible,time<200);assert.equal(view.frames.get('scene:Blood').visible,time>=200);}
});
