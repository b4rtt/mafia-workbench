import test from 'node:test';
import assert from 'node:assert/strict';
import { missionDialogueScript, inspectMissionDialogue } from '../src/shared/mission-dialogue.js';

const recipe={trigger:'load',serialize:true,lockPlayer:true,camera:true,interruptOnDeath:true,lines:[{speaker:'NPC',listener:'Tommy',textId:1},{speaker:'Tommy',listener:'NPC',textId:2}]};

test('queued dialogue recipes round trip, reject altered synchronization and preserve legacy programs',()=>{
  for(const trigger of ['load','area','use'])for(const camera of [false,true])for(const lockPlayer of [false,true])for(const interruptOnDeath of [false,true])for(const inventory of [null,{itemId:23,consume:true},{itemId:23,consume:false}]){
    if(inventory&&trigger!=='use')continue;
    const options={...recipe,trigger,...(trigger==='area'?{triggerRadius:3}:{}),interactionId:7,camera,lockPlayer,interruptOnDeath,inventory,flow:{waitForSignal:true,onComplete:'NEXT',...(interruptOnDeath?{onFailure:'FAIL'}:{})}};
    const code=missionDialogueScript(options),parsed=inspectMissionDialogue(code);
    assert(parsed);assert.equal(parsed.serialize,true);assert.equal(missionDialogueScript(parsed),code);assert.equal(missionDialogueScript(inspectMissionDialogue(code.replaceAll('\n','\r\n'))),code);
    for(const changed of [code.replace('commandblock 1','commandblock 0'),code.replace('label 22','label 24'),code.replace(/compareactors (\d+), (\d+), 0/,'compareactors $2, $2, 0')])assert.equal(inspectMissionDialogue(changed),null);
    assert.equal(missionDialogueScript({...options,serialize:false}),missionDialogueScript({...options,serialize:undefined}));
  }
  assert.throws(()=>missionDialogueScript({...recipe,serialize:1}),/řazení/);
  for(const field of ['onComplete','onFailure'])assert.throws(()=>missionDialogueScript({...recipe,flow:{[field]:'wb_dialogue_queue'}}),/pomocný bod/);
  const legacy=missionDialogueScript({...recipe,serialize:false,flow:{onComplete:'WB_DIALOGUE_QUEUE'}});
  assert.equal(missionDialogueScript(inspectMissionDialogue(legacy)),legacy);
});

// Execute independently scheduled programs instruction by instruction. A command
// block is atomic; speech and wait yield. This deliberately interleaves the
// read/claim sites which race without the block. It is not an engine emulator.
function run(seed,{killWaiting=false,killOwner=false,inventory=false,missingQueue=false}={}){
  let random=seed+1,time=0,mutex=null,lock=null,camera=null,changed=false,restored=false,freeSince=null;
  const signals=[],events=[],health=new Map([['A',100],['B',100],['Tommy',100]]),items=new Map([[23,true],[24,true]]);
  const programs=['A','B'].map(name=>{
    const options={...recipe,trigger:inventory?'use':'load',interactionId:9,lines:[{speaker:name,listener:'Tommy',textId:1},{speaker:name,listener:'Tommy',textId:2}],...(inventory?{inventory:{itemId:name==='A'?23:24,consume:true}}:{}),flow:{onComplete:name+'_NEXT',onFailure:name+'_FAIL'}};
    const code=missionDialogueScript(options).split('\n');
    return {name,code,labels:new Map(code.flatMap((line,i)=>line.startsWith('label ')?[[Number(line.slice(6)),i]]:[])),actors:[],pc:0,float:0,block:false,wake:0,done:false,consumed:0,talks:0,retriedInventory:false};
  });
  function step(p){
    const line=p.code[p.pc++];assert(line,'bounded script');let m;
    const jump=label=>{if(label!=='-1')p.pc=p.labels.get(Number(label));};
    if((m=/^findactor (\d+), "(.+)"$/.exec(line)))p.actors[Number(m[1])]=missingQueue&&m[2]==='WB_DIALOGUE_QUEUE'?null:m[2];
    else if((m=/^setnullactor (\d+)$/.exec(line)))p.actors[Number(m[1])]=null;
    else if((m=/^compareactors (\d+), (\d+), 0$/.exec(line)))p.float=Number(p.actors[Number(m[1])]===p.actors[Number(m[2])]);
    else if(line==='let flt[0] = 0')p.float=0;
    else if((m=/^human_getproperty (\d+), 0, Energy$/.exec(line)))p.float=health.get(p.actors[Number(m[1])])??p.float;
    else if((m=/^human_isweapon \d+, 0, (\d+)$/.exec(line)))p.float=Number(items.get(Number(m[1]))===true);
    else if((m=/^human_delweapon \d+, (\d+)$/.exec(line))){assert(items.get(Number(m[1])));items.set(Number(m[1]),false);p.consumed++;assert.equal(mutex,p.name);}
    else if((m=/^if flt\[0\] ([=>]) (\d+), (-?\d+), (-?\d+)$/.exec(line)))jump((m[1]==='='?p.float===Number(m[2]):p.float>Number(m[2]))?m[3]:m[4]);
    else if((m=/^detector_issignal (\d+), (-?\d+), (-?\d+)$/.exec(line))){assert.equal(p.actors[Number(m[1])],'WB_DIALOGUE_QUEUE');jump(mutex?m[2]:m[3]);}
    else if((m=/^detector_setsignal (\d+), ([01])$/.exec(line))){
      if(p.actors[Number(m[1])]==='WB_DIALOGUE_QUEUE'){
        if(m[2]==='1'){assert(p.block);assert.equal(mutex,null,'two conversations acquired the camera');mutex=p.name;events.push([p.name,'claim']);}
        else{assert.equal(mutex,p.name,'only the owner may release');assert.equal(lock,null);assert.equal(camera,null);mutex=null;events.push([p.name,'release']);}
      }else signals.push(p.actors[Number(m[1])]);
    }
    else if((m=/^commandblock ([01])$/.exec(line)))p.block=m[1]==='1';
    else if((m=/^wait (\d+)$/.exec(line))){assert(!p.block);p.wake=time+Number(m[1]);}
    else if(line.startsWith('detector_waitforuse '))assert(!p.block); // explicit test action
    else if(line==='player_lockcontrols 1'){assert.equal(mutex,p.name);assert.equal(lock,null);lock=p.name;}
    else if(line==='player_lockcontrols 0'){assert.equal(lock,p.name);lock=null;}
    else if(line.startsWith('dialog_begin')){assert.equal(mutex,p.name);assert.equal(camera,null);camera=p.name;}
    else if(line==='dialog_end'){assert.equal(camera,p.name);camera=null;}
    else if(line.startsWith('human_talk')){
      assert(!p.block);assert.equal(mutex,p.name);assert.equal(lock,p.name);assert.equal(camera,p.name);p.talks++;p.wake=time+300;
      if(!changed&&(killWaiting||killOwner||inventory)){
        changed=true;const waiting=programs.find(other=>other!==p);
        if(killWaiting)health.set(waiting.name,0);
        if(killOwner)health.set(p.name,0);
        if(inventory)items.set(waiting.name==='A'?23:24,false);
      }
    }
    else if((m=/^goto (\d+)$/.exec(line)))jump(m[1]);
    else if(line==='label 23')p.retriedInventory=true;
    else if(line==='end'){assert(!p.block);p.done=true;}
    else assert(/^(dim_|label |dialog_camswitch )/.test(line),'unsupported '+line);
  }
  for(time=0;time<15000;time+=10){
    random=(Math.imul(random,1664525)+1013904223)>>>0;
    for(const p of (random>>>20)&1?programs:[...programs].reverse()){
      if(p.done||p.wake>time)continue;
      let count=0;do{step(p);assert(++count<200,'block must yield');}while(p.block&&!p.done);
    }
    if(inventory&&changed&&!mutex&&!restored){
      freeSince??=time;const waiting=programs.find(p=>p.consumed===0);assert(waiting);assert.equal(waiting.talks,0);assert(!signals.includes(waiting.name+'_NEXT'));
      if(time-freeSince>=700){assert(waiting.retriedInventory,'lost item must be checked after waiting for the lease');items.set(waiting.name==='A'?23:24,true);restored=true;}
    }
    if(programs.every(p=>p.done)){assert.equal(mutex,null);assert.equal(lock,null);assert.equal(camera,null);return {programs,signals,events,restored};}
  }
  assert.fail('conversations never finished');
}
test('competing dialogues serialize speech and release only their own camera and controls',()=>{
  for(let seed=0;seed<80;seed++){
    const result=run(seed);assert.deepEqual([...result.signals].sort(),['A_NEXT','B_NEXT']);assert(result.programs.every(p=>p.talks===2));assert.deepEqual(result.events.map(event=>event[1]),['claim','release','claim','release']);
    for(const option of ['killWaiting','killOwner']){
      const state=run(seed,{[option]:true});assert.equal(state.signals.filter(signal=>signal.endsWith('_FAIL')).length,1);assert.equal(state.signals.filter(signal=>signal.endsWith('_NEXT')).length,1);assert.equal(state.events.length,option==='killWaiting'?2:4);
    }
    const handover=run(seed,{inventory:true});assert(handover.restored);assert(handover.programs.every(p=>p.consumed===1));assert.equal(handover.signals.length,2);
    const missing=run(seed,{missingQueue:true});assert.deepEqual(missing.events,[]);assert.deepEqual([...missing.signals].sort(),['A_FAIL','B_FAIL']);
  }
});
