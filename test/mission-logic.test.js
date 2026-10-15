import test from 'node:test';
import assert from 'node:assert/strict';
import { missionLogic, layoutMissionLogic } from '../src/shared/mission-logic.js';
import { missionTaskScript } from '../src/shared/mission-task.js';
import { missionDialogueScript } from '../src/shared/mission-dialogue.js';
import { missionCombatScript } from '../src/shared/mission-combat.js';
import { missionChoicePrograms } from '../src/shared/mission-choice.js';
import { changeSceneObject, inspectScene, editScene } from '../src/core/scene.js';
import { humanBehaviorScript } from '../src/shared/human-behavior.js';

const base = { objectiveId:10, interactionId:20, nextObjectiveId:30, completeId:40, targetName:'Destination', targetRadius:3 };
const chunk = (type, data) => { const header=Buffer.alloc(6);header.writeUInt16LE(type);header.writeUInt32LE(data.length+6,2);return Buffer.concat([header,data]); };
function fixture() {
  let bytes=chunk(0x4c53,chunk(0x4000,Buffer.alloc(0)));
  const choice=missionChoicePrograms({name:'CHOICE',controller:'NPC',waitForSignal:true,answers:[{textId:50,target:'Combat'},{textId:60,target:'Menu'}]});
  bytes=changeSceneObject(bytes,{kind:'add-human',name:'NPC',model:'human.i3d',position:[0,0,0],rotation:[1,0,0,0],scale:[1,1,1],parameters:{},code:choice.controller.code});
  const programs=[
    ['Destination','end'],['Raw','dim_act 1\nfindactor 0, "Quest"\ndetector_setsignal 0, 1\nend'],
    ['Quest',missionTaskScript({...base,inventory:{itemId:23,atTarget:true,consume:true},failure:{timeoutSeconds:20,textId:70},flow:{waitForSignal:true,onComplete:'Dialogue',onFailure:'Combat'}})],
    ['Dialogue',missionDialogueScript({trigger:'load',lines:[{speaker:'NPC',textId:80}],flow:{onComplete:'CHOICE'}})],
    ['Combat',missionCombatScript({trigger:'load',targets:['NPC'],objectiveId:10,completeId:40,failure:{timeoutSeconds:10,textId:70,endMission:true},flow:{waitForSignal:true,onComplete:'Quest'}})],
    ['Menu',missionTaskScript({...base,nextMission:'Next'})],
    ['Waiting',missionDialogueScript({trigger:'load',lines:[{speaker:'NPC',textId:80}],flow:{waitForSignal:true}})],
    ...choice.nodes.map(node=>[node.name,node.code])
  ];
  for(const [name,code]of programs)bytes=changeSceneObject(bytes,{kind:'add-detector',name,position:[0,0,0],mask:name.startsWith('CHOICE')?0:1,code});
  return {...inspectScene(bytes),geometry:{meshes:[]},bytes};
}
const named=(graph,name)=>graph.nodes.find(node=>node.name===name);
test('area and automatic recipes retain their activation and existing flow in the mission graph',()=>{
  const scene=fixture(),original=missionLogic(scene);
  for(const name of ['Quest','Dialogue','Combat']){
    const node=named(original,name),entry=scene.entries.find(e=>e.actorScript&&e.value.name===name);
    const generate={Quest:missionTaskScript,Dialogue:missionDialogueScript,Combat:missionCombatScript}[name];
    for(const trigger of ['area','load']){
      const recipe={...node.recipe,trigger,...(trigger==='area'?{triggerRadius:2.5}:{}),...(name==='Quest'?{objectiveId:null,interactionId:null}:{})};
      const graph=missionLogic({...inspectScene(editScene(scene.bytes,entry.id,{...entry.value,code:generate(recipe)})),geometry:scene.geometry}),changed=named(graph,name);
      assert.equal(changed.kind,node.kind);assert.equal(changed.trigger,trigger);assert.equal(changed.waiting,node.waiting);
      if(trigger==='area')assert.equal(changed.recipe.triggerRadius,2.5);
      assert.deepEqual(graph.edges.filter(e=>e.from===changed.id),original.edges.filter(e=>e.from===node.id));
    }
  }
});
test('logic shows exact task/dialogue/combat/choice flow, exits, activation and collapses only owned helpers',()=>{
  const scene=fixture(),before=JSON.stringify(scene),graph=missionLogic(scene);
  assert.deepEqual(['Quest','Dialogue','Combat','CHOICE'].map(name=>named(graph,name).kind),['task','dialogue','combat','choice']);
  assert.equal(named(graph,'Quest').recipe.inventory.itemId,23);
  assert.equal(named(graph,'Dialogue').trigger,'load');assert.equal(named(graph,'Quest').trigger,'use');assert.equal(named(graph,'CHOICE').waiting,true);
  assert.deepEqual(graph.edges.filter(edge=>edge.from===named(graph,'Quest').id).map(edge=>[edge.kind,edge.targetName]),[['success','Dialogue'],['failure','Combat']]);
  assert.deepEqual(graph.edges.filter(edge=>edge.from===named(graph,'CHOICE').id).map(edge=>[edge.kind,edge.targetName,edge.label]),[['answer','Combat','Odpověď 1 · text 50'],['answer','Menu','Odpověď 2 · text 60']]);
  assert.equal(named(graph,'NPC'),undefined);assert.equal(named(graph,'CHOICE_ANSWER1'),undefined);assert.deepEqual(named(graph,'CHOICE').members,['CHOICE','CHOICE_CLAIM','CHOICE_ANSWER1','CHOICE_ANSWER2']);
  assert.equal(named(graph,'Next').kind,'mission');assert.equal(named(graph,'Neúspěšné ukončení').kind,'ending');
  assert(named(graph,'Waiting').warnings.some(warning=>warning.includes('Může jej spouštět vlastní skript')));
  assert(named(graph,'Quest').warnings.some(warning=>warning.startsWith('Cyklus')));assert(!named(graph,'CHOICE').warnings.some(warning=>warning.includes('odesílatele')));
  assert.equal(named(graph,'Raw').kind,'custom');assert(!graph.edges.some(edge=>edge.from===named(graph,'Raw').id));assert.equal(JSON.stringify(scene),before);
});
test('CRLF is recognized, but altered programs, masks and choice controllers stay custom without guessed edges',()=>{
  const scene=fixture(),quest=scene.entries.find(entry=>entry.actorScript&&entry.value.name==='Quest');
  let bytes=editScene(scene.bytes,quest.id,{...quest.value,code:quest.value.code.replaceAll('\n','\r\n')});assert.equal(named(missionLogic({...inspectScene(bytes),geometry:scene.geometry}),'Quest').kind,'task');
  bytes=editScene(scene.bytes,quest.id,{...quest.value,code:quest.value.code+'\n// custom'});let graph=missionLogic({...inspectScene(bytes),geometry:scene.geometry});assert.equal(named(graph,'Quest').kind,'custom');assert(!graph.edges.some(edge=>edge.from===named(graph,'Quest').id));
  const actor=scene.actors.find(actor=>actor.name==='Quest'),mask=scene.entries.find(entry=>entry.detectorParameter&&entry.id.startsWith(actor.id+'/'));
  graph=missionLogic({...inspectScene(editScene(scene.bytes,mask.id,0)),geometry:scene.geometry});assert.equal(named(graph,'Quest').kind,'custom');
  const controller=scene.entries.find(entry=>entry.actorScript&&entry.value.name==='NPC');graph=missionLogic({...inspectScene(editScene(scene.bytes,controller.id,{...controller.value,code:controller.value.code+'\nwait 10'})),geometry:scene.geometry});
  assert.equal(named(graph,'CHOICE').kind,'custom');assert.equal(named(graph,'CHOICE_ANSWER1').kind,'custom');assert.equal(named(graph,'NPC').kind,'custom');
});
test('references resolve case-insensitively; missing, ambiguous and unbound targets are explicit placeholders',()=>{
  const scene=fixture(),entry=scene.entries.find(entry=>entry.actorScript&&entry.value.name==='Dialogue');
  const code=missionDialogueScript({trigger:'load',lines:[{speaker:'NPC',textId:80}],flow:{onComplete:'raw'}});
  const current={...inspectScene(editScene(scene.bytes,entry.id,{...entry.value,code})),geometry:scene.geometry};let graph=missionLogic(current);
  assert.equal(graph.edges.find(edge=>edge.from===named(graph,'Dialogue').id).to,named(graph,'Raw').id);
  graph=missionLogic({...current,actors:[...current.actors,{...current.actors.find(actor=>actor.name==='Raw'),name:'RAW'}]});assert.equal(named(graph,'raw').kind,'unresolved');assert(named(graph,'raw').warnings[0].includes('jednoznačný'));
  graph=missionLogic({...current,actors:current.actors.filter(actor=>actor.name!=='Raw')});assert.equal(named(graph,'raw').kind,'unresolved');assert(named(graph,'raw').warnings[0].includes('chybí'));
  graph=missionLogic({...current,objects:current.objects.filter(object=>object.name!=='Raw')});assert.equal(named(graph,'raw').kind,'unresolved');
});
test('direct references to choice helpers preserve their exact target and do not imply activation of the owner',()=>{
  const scene=fixture(),entry=scene.entries.find(entry=>entry.actorScript&&entry.value.name==='Dialogue'),code=missionDialogueScript({trigger:'load',lines:[{speaker:'NPC',textId:80}],flow:{onComplete:'CHOICE_ANSWER1'}});
  const graph=missionLogic({...inspectScene(editScene(scene.bytes,entry.id,{...entry.value,code})),geometry:scene.geometry}),edge=graph.edges.find(edge=>edge.from===named(graph,'Dialogue').id);
  assert.equal(edge.targetName,'CHOICE_ANSWER1');assert.equal(edge.to,named(graph,'CHOICE').id);assert.equal(edge.helper,true);assert(named(graph,'Dialogue').warnings.some(warning=>warning.includes('pomocný bod')));assert(named(graph,'CHOICE').warnings.some(warning=>warning.includes('odesílatele')));
});
test('standalone scripts remain inspectable custom source and cannot become detector targets merely by name',()=>{
  const scene=fixture(),extra={id:'standalone',kind:'script',value:{name:'Quest',code:'detector_setsignal -1, 1'}};
  const graph=missionLogic({...scene,entries:[...scene.entries,extra]});assert.equal(graph.nodes.find(node=>node.id==='script:standalone').kind,'custom');assert(!graph.nodes.find(node=>node.id==='script:standalone').actor);assert.equal(graph.edges.find(edge=>edge.from===named(graph,'Combat').id).to,named(graph,'Quest').id);
});
test('two choices on the same controller remain distinct; modifying one group leaves its source visible',()=>{
  const scene=fixture(),controller=scene.entries.find(entry=>entry.actorScript&&entry.value.name==='NPC'),plan=missionChoicePrograms({name:'SECOND_CHOICE',controller:'NPC',answers:[{textId:90,target:'Menu'},{textId:100,target:'Combat'}]},[{owner:'CHOICE',names:['CHOICE_ANSWER1','CHOICE_ANSWER2']}]);
  let bytes=editScene(scene.bytes,controller.id,{...controller.value,code:plan.controller.code});
  for(const node of plan.nodes)bytes=changeSceneObject(bytes,{kind:'add-detector',name:node.name,position:[0,0,0],mask:0,code:node.code});
  let current={...inspectScene(bytes),geometry:scene.geometry},graph=missionLogic(current);
  assert.equal(graph.nodes.filter(node=>node.kind==='choice').length,2);assert.equal(named(graph,'NPC'),undefined);assert.equal(named(graph,'SECOND_CHOICE').members.length,4);
  const answer=current.entries.find(entry=>entry.actorScript&&entry.value.name==='SECOND_CHOICE_ANSWER1');bytes=editScene(bytes,answer.id,{...answer.value,code:answer.value.code+'\n// custom'});graph=missionLogic({...inspectScene(bytes),geometry:scene.geometry});
  assert.equal(named(graph,'CHOICE').kind,'choice');assert.equal(named(graph,'SECOND_CHOICE').kind,'custom');assert.equal(named(graph,'SECOND_CHOICE_ANSWER1').kind,'custom');assert.equal(named(graph,'NPC').kind,'custom');
});
test('layout is stable for disconnected points, branching and cycles; long chains do not recurse',()=>{
  const nodes=Array.from({length:12000},(_,index)=>({id:String(index)})),edges=nodes.slice(1).map((node,index)=>({from:String(index),to:node.id}));
  const result=layoutMissionLogic({nodes,edges});assert.equal(result.positions.size,12000);assert.equal(result.cycles.length,0);assert(result.positions.get('11999').x>result.positions.get('0').x);
  const graph={nodes:[{id:'a'},{id:'b'},{id:'c'},{id:'d'},{id:'isolated'}],edges:[{from:'a',to:'b'},{from:'b',to:'c'},{from:'c',to:'b'},{from:'c',to:'d'},{from:'isolated',to:'isolated'}]};
  const first=layoutMissionLogic(graph);assert.deepEqual(first,layoutMissionLogic(graph));assert.equal(first.positions.get('b').x,first.positions.get('c').x);assert(first.positions.get('d').x>first.positions.get('c').x);assert.equal(first.cycles.length,2);
});

const patrol = { mode:'patrol',waypoints:[{id:77,pauseSeconds:4}],pace:'walk',loop:false,delaySeconds:1,startSignal:'Dialogue',onComplete:'Waiting' };
function journeyScene(options = patrol) {
  const scene=fixture();
  const bytes=changeSceneObject(scene.bytes,{kind:'add-human',name:'Walker',model:'human.i3d',position:[0,0,0],rotation:[1,0,0,0],scale:[1,1,1],parameters:{},code:humanBehaviorScript('Walker',options)});
  return {...inspectScene(bytes),geometry:scene.geometry,bytes};
}
test('NPC journey cards distinguish reading a gate signal from sending completion, without changing scene data',()=>{
  const scene=journeyScene(),before=JSON.stringify(scene),graph=missionLogic(scene),walker=named(graph,'Walker'),gate=named(graph,'Dialogue'),done=named(graph,'Waiting');
  assert.equal(walker.kind,'patrol');assert.deepEqual(walker.recipe,patrol);assert.equal(walker.actor,true);assert.equal(walker.waiting,true);
  assert.deepEqual(graph.edges.filter(e=>e.to===walker.id).map(e=>[e.from,e.kind,e.targetName]),[[gate.id,'signal','Dialogue']]);
  assert.deepEqual(graph.edges.filter(e=>e.from===walker.id).map(e=>[e.to,e.kind,e.targetName]),[[done.id,'success','Waiting']]);
  assert(!walker.warnings.some(w=>w.includes('neposílá')));assert(!done.warnings.some(w=>w.includes('odesílatele')));assert.equal(JSON.stringify(scene),before);
  const changed=journeyScene({...patrol,startSignal:'Waiting',onComplete:null}),other=missionLogic(changed);
  assert(named(other,'Walker').warnings.some(w=>w.includes('neposílá')));
  assert(named(other,'Waiting').warnings.some(w=>w.includes('odesílatele'))); // A read does not send a signal.
});
test('journey gates preserve exact helper names and expose missing, wrong-kind and ambiguous signal bindings',()=>{
  for(const options of [{...patrol,startSignal:'Absent'},{...patrol,startSignal:'NPC'},{...patrol,onComplete:'Absent'}]){
    const graph=missionLogic(journeyScene(options)),missing=graph.nodes.find(n=>n.kind==='unresolved');assert(missing);assert(missing.warnings.length);
    assert(graph.edges.some(e=>e.from===missing.id||e.to===missing.id));
  }
  const scene=journeyScene({...patrol,startSignal:'dialogue',onComplete:'CHOICE_ANSWER1'}),graph=missionLogic(scene),walker=named(graph,'Walker');
  assert.equal(graph.edges.find(e=>e.to===walker.id).from,named(graph,'Dialogue').id);
  const helper=graph.edges.find(e=>e.from===walker.id);assert.equal(helper.to,named(graph,'CHOICE').id);assert.equal(helper.targetName,'CHOICE_ANSWER1');assert(helper.helper);
  assert(walker.warnings.some(w=>w.includes('pomocný bod')));
  const duplicate=missionLogic({...scene,actors:[...scene.actors,{...scene.actors.find(a=>a.name==='Dialogue'),name:'DIALOGUE'}]});assert(duplicate.nodes.some(n=>n.kind==='unresolved'&&n.name.toLowerCase()==='dialogue'));
});
test('only exact bound Human patrols and following programs become journey nodes; other NPC code remains custom',()=>{
  const follow={mode:'follow',startSignal:'Dialogue',destinationName:'Destination',destinationRadius:3,onComplete:'Waiting',delaySeconds:0};
  const scene=journeyScene(follow),graph=missionLogic(scene),entry=scene.entries.find(e=>e.actorScript&&e.value.name==='Walker');
  assert.equal(named(graph,'Walker').kind,'follow');assert.deepEqual(named(graph,'Walker').recipe,follow);
  for(const changed of [
    {...scene,entries:scene.entries.map(e=>e===entry?{...e,value:{...e.value,code:e.value.code+'// own'}}:e)},
    {...scene,actors:[...scene.actors,{name:'WALKER',kind:27}]},
    {...scene,objects:scene.objects.filter(o=>o.name!=='Walker')},
    {...scene,entries:[...scene.entries,{...entry,id:'duplicate-program'}]},
    {...scene,entries:scene.entries.map(e=>e===entry?{...e,actorKind:2}:e)}
  ])assert.equal(named(missionLogic(changed),'Walker').kind,'custom');
  for(const options of [{...patrol,startSignal:null,onComplete:null},{...patrol,startSignal:null,onComplete:null,loop:true,waypoints:[...patrol.waypoints,{id:66,pauseSeconds:0}]},{mode:'follow'}]){
    const current=missionLogic(journeyScene(options)),node=named(current,'Walker');assert(['patrol','follow'].includes(node.kind));assert.equal(node.waiting,false);assert(!current.edges.some(e=>e.from===node.id||e.to===node.id));
  }
});

test('car journeys expose read and completion edges, legacy automatic starts and custom-source boundaries',()=>{
  const options={mode:'drive',carName:'Car',boarding:'walk',stops:[{name:'Destination',pauseSeconds:2}],loop:false,delaySeconds:0,startSignal:'Dialogue',onComplete:'Waiting'},scene=journeyScene(options),before=JSON.stringify(scene),graph=missionLogic(scene),driver=named(graph,'Walker');
  assert.equal(driver.kind,'drive');assert.deepEqual(driver.recipe,options);assert(driver.waiting);
  assert(graph.edges.some(e=>e.from===named(graph,'Dialogue').id&&e.to===driver.id&&e.kind==='signal'));
  assert(graph.edges.some(e=>e.from===driver.id&&e.to===named(graph,'Waiting').id&&e.kind==='success'));
  assert(!named(graph,'Waiting').warnings.some(w=>w.includes('odesílatele')));assert.equal(JSON.stringify(scene),before);
  const legacy={...options};delete legacy.startSignal;delete legacy.onComplete;const automatic=missionLogic(journeyScene(legacy));assert.equal(named(automatic,'Walker').kind,'drive');assert.equal(named(automatic,'Walker').waiting,false);assert.deepEqual(automatic.edges.filter(e=>e.from===driver.id||e.to===driver.id),[]);
  for(const extra of [{startSignal:'Absent'},{onComplete:'NPC'}])assert(missionLogic(journeyScene({...options,...extra})).nodes.some(n=>n.kind==='unresolved'));
  const edited={...scene,entries:scene.entries.map(e=>e.actorScript&&e.value.name==='Walker'?{...e,value:{...e.value,code:e.value.code+'// own'}}:e)};assert.equal(named(missionLogic(edited),'Walker').kind,'custom');
});
