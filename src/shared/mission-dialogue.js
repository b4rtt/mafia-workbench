import { missionActivation, inspectMissionActivation } from './mission-activation.js';
import { missionFlow, missionFlowTargets } from './mission-flow.js';
import { attachedInteraction } from './mission-interaction.js';

const key=name=>name.normalize('NFC').toLowerCase();
const validName=name=>typeof name==='string'&&name.trim()&&name.length<=255&&!/["\x00-\x1f]/.test(name);
const validId=id=>Number.isSafeInteger(id)&&id>=0&&id<=0x7fffffff;

// Actor lookup requires a living human/player at runtime. The file can prove
// type and unique binding, but cannot prove that another script keeps it alive.
export function dialogueSpeakers(scene){
  const actors=scene.actors??[],objects=scene.objects??[],meshes=scene.geometry?.meshes??[];
  return actors.filter(actor=>[2,27].includes(actor.kind)&&validName(actor.name)&&
    actors.filter(other=>key(other.name)===key(actor.name)).length===1&&
    objects.filter(other=>key(other.name)===key(actor.name)).length<=1&&
    meshes.filter(other=>key(other.name)===key(actor.name)).length<=1&&
    [...objects,...meshes].some(other=>key(other.name)===key(actor.name)));
}
export function dialogueInteractionHumans(scene){
  const frames=[...(scene.objects??[]),...(scene.geometry?.meshes??[])];
  return dialogueSpeakers(scene).filter(actor=>actor.kind===27&&frames.filter(frame=>key(frame.name)===key(actor.name)).length===1);
}
export function missionDialogueScript({trigger='use',triggerRadius=null,interactionId,camera=false,lines,flow=null,lockPlayer=false,interactionHuman=null,inventory=null,interruptOnDeath=false}={}){
  const activation=missionActivation(trigger,triggerRadius,'Rozhovor');
  if(typeof lockPlayer!=='boolean')throw new Error('Rozhovor: neplatný zámek ovládání hráče.');
  if(typeof interruptOnDeath!=='boolean')throw new Error('Rozhovor: neplatná kontrola života účastníků.');
  if(interactionHuman!==null&&(trigger!=='use'||!validName(interactionHuman)))throw new Error('Rozhovor: akce u postavy potřebuje NPC a spuštění tlačítkem akce.');
  if(inventory!==null&&(trigger!=='use'||typeof inventory!=='object'||Array.isArray(inventory)||!Number.isSafeInteger(inventory.itemId)||inventory.itemId<2||inventory.itemId>65535||typeof inventory.consume!=='boolean'))throw new Error('Rozhovor: předání potřebuje akci hráče a platný předmět.');
  if(typeof camera!=='boolean')throw new Error('Rozhovor: neplatný způsob spuštění nebo kamera.');
  if(trigger==='use'&&!validId(interactionId))throw new Error('Rozhovor: ID akce musí být celé číslo 0–2147483647.');
  if(!Array.isArray(lines)||!lines.length||lines.length>32)throw new Error('Rozhovor: zadejte 1–32 replik.');
  const participants=[],indices=new Map();
  const index=name=>{const canonical=key(name);if(!indices.has(canonical)){indices.set(canonical,participants.length);participants.push(name);}return indices.get(canonical);};
  for(const line of lines){
    if(!line||!validName(line.speaker)||!validId(line.textId))throw new Error('Rozhovor: každá replika potřebuje platného mluvčího a ID textu.');
    index(line.speaker);
    if(camera){if(!validName(line.listener)||key(line.listener)===key(line.speaker))throw new Error('Rozhovor: kamera potřebuje jiného posluchače než mluvčího.');index(line.listener);}
  }
  if(inventory||interruptOnDeath)index('Tommy');
  if(interruptOnDeath&&interactionHuman)index(interactionHuman);
  const link=missionFlow(flow,{actorOffset:participants.length,allowFailure:interruptOnDeath});
  // Energy is zero for a dead/missing human. Slots are initialized to zero so
  // an invalid runtime binding cannot reuse the previous participant's health.
  // HUMAN_TALK blocks: a listener's death is handled when that line finishes.
  const alive=label=>participants.flatMap((_,i)=>['let flt[0] = 0',`human_getproperty ${i}, 0, Energy`,`if flt[0] > 0, -1, ${label}`]);
  const release=[...(camera?['dialog_end']:[]),...(lockPlayer?['player_lockcontrols 0']:[])];
  const code=[`dim_act ${participants.length+link.actors}`,...(interactionHuman?['dim_frm 2']:[]),...((inventory||interactionHuman)?['dim_flt 3']:trigger==='area'||interruptOnDeath?['dim_flt 1']:[]),'wait 2000',...(link.gate+link.start).trimEnd().split('\n').filter(Boolean),...participants.map((name,i)=>`findactor ${i}, "${name}"`)];
  if(activation)code.push(activation.trimEnd());
  if(interactionHuman)code.push(attachedInteraction(interactionHuman).trimEnd());
  if(inventory)code.push('label 10',`human_isweapon ${index('Tommy')}, 0, ${inventory.itemId}`,'if flt[0] = 1, 11, -1','wait 100','goto 10','label 11');
  if(trigger==='use')code.push(`detector_waitforuse ${interactionId}`);
  // Recheck at the action itself: dropping an item after the menu appeared
  // must never deliver it. The next offer waits until it is held again.
  if(inventory)code.push(`human_isweapon ${index('Tommy')}, 0, ${inventory.itemId}`,'if flt[0] = 1, 12, 10','label 12');
  if(interruptOnDeath)code.push(...alive(91));
  if(inventory?.consume)code.push(`human_delweapon ${index('Tommy')}, ${inventory.itemId}`);
  if(lockPlayer)code.push('player_lockcontrols 1');
  if(camera)code.push(`dialog_begin 0, ${participants.length}`);
  for(const line of lines){if(camera)code.push(`dialog_camswitch ${index(line.listener)}, ${index(line.speaker)}`);code.push(`human_talk ${index(line.speaker)}, ${line.textId}`);if(interruptOnDeath)code.push(...alive(90));}
  code.push(...release);
  if(link.complete)code.push(link.complete.trimEnd());
  code.push('end');
  // Never tear down a camera or controls that this conversation did not acquire.
  if(interruptOnDeath)code.push('label 90',...release,'label 91',...(link.failure?[link.failure.trimEnd()]:[]),'end');
  return code.join('\n');
}

// Only a full round trip through our generator authorizes a wizard edit.
// Original templates need no extra metadata; custom source stays untouched.
export function inspectMissionDialogue(code){
  if(typeof code!=='string'||code.length>1000000)return null;
  const source=code.replaceAll('\r\n','\n'),bindings=new Map([...source.matchAll(/^findactor (\d+), "([^"\x00-\x1f]+)"$/gm)].map(match=>[Number(match[1]),match[2]])),camera=/^dialog_begin \d+, \d+$/m.test(source);
  const lines=camera?[...source.matchAll(/^dialog_camswitch (\d+), (\d+)\nhuman_talk (\d+), (\d+)$/gm)].map(match=>({speaker:bindings.get(Number(match[3])),listener:bindings.get(Number(match[1])),textId:Number(match[4])})):[...source.matchAll(/^human_talk (\d+), (\d+)$/gm)].map(match=>({speaker:bindings.get(Number(match[1])),textId:Number(match[2])}));
  const interruptOnDeath=/^label 91$/m.test(source),use=/^detector_waitforuse (\d+)$/m.exec(source),signal=/^detector_setsignal (\d+), 1$/m.exec(source.split('\nend')[0]),failed=interruptOnDeath?/^label 91\n(?:detector_setsignal (\d+), 1\n)?end$/m.exec(source):null,waitForSignal=source.includes('label 1\ndetector_issignal -1, 2, -1\n'),onComplete=signal?bindings.get(Number(signal[1])):null,onFailure=failed?.[1]?bindings.get(Number(failed[1])):null;
  const attached=/^findframe 0, "([^"\x00-\x1f]+)"\nfindframe 1, ""\nfrm_linkto 1, 0$/m.exec(source),item=/^human_isweapon \d+, 0, (\d+)$/m.exec(source);
  const dialogue={...(interruptOnDeath?{interruptOnDeath:true}:{}),...(attached?{interactionHuman:attached[1]}:{}),...(item?{inventory:{itemId:Number(item[1]),consume:/^human_delweapon \d+, \d+$/m.test(source)}}:{}),...(source.includes('player_lockcontrols 1')?{lockPlayer:true}:{}),...inspectMissionActivation(source),...(use?{interactionId:Number(use[1])}:{}),camera,lines,flow:waitForSignal||onComplete||onFailure?{waitForSignal,onComplete,onFailure}:null};
  try{if(missionDialogueScript(dialogue)===source)return dialogue;}catch{/* Unknown or modified programs are not wizard recipes. */}
  return null;
}
export function editableMissionDialogue(scene,owner){
  if(!validName(owner))return null;
  const actors=(scene.actors??[]).filter(actor=>key(actor.name)===key(owner)),entries=(scene.entries??[]).filter(entry=>entry.actorScript&&entry.actorKind===5&&key(entry.value.name)===key(owner));
  if(actors.length!==1||actors[0].kind!==5||entries.length!==1||!missionFlowTargets(scene).some(actor=>key(actor.name)===key(owner)))return null;
  const masks=scene.entries.filter(entry=>entry.detectorParameter&&entry.id.startsWith(actors[0].id+'/'));
  if(masks.length!==1||masks[0].value!==1)return null;
  const dialogue=inspectMissionDialogue(entries[0].value.code);
  return dialogue?{entry:entries[0],dialogue}:null;
}
