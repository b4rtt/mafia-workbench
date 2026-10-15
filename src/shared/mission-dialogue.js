import { missionActivation, inspectMissionActivation } from './mission-activation.js';
import { missionFlow, missionFlowTargets } from './mission-flow.js';

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
export function missionDialogueScript({trigger='use',triggerRadius=null,interactionId,camera=false,lines,flow=null}={}){
  const activation=missionActivation(trigger,triggerRadius,'Rozhovor');
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
  const link=missionFlow(flow,{actorOffset:participants.length});
  const code=[`dim_act ${participants.length+link.actors}`,...(trigger==='area'?['dim_flt 1']:[]),'wait 2000',...(link.gate+link.start).trimEnd().split('\n').filter(Boolean),...participants.map((name,i)=>`findactor ${i}, "${name}"`)];
  if(activation)code.push(activation.trimEnd());
  if(trigger==='use')code.push(`detector_waitforuse ${interactionId}`);
  if(camera)code.push(`dialog_begin 0, ${participants.length}`);
  for(const line of lines){if(camera)code.push(`dialog_camswitch ${index(line.listener)}, ${index(line.speaker)}`);code.push(`human_talk ${index(line.speaker)}, ${line.textId}`);}
  if(camera)code.push('dialog_end');
  if(link.complete)code.push(link.complete.trimEnd());
  return [...code,'end'].join('\n');
}

// Only a full round trip through our generator authorizes a wizard edit.
// Original templates need no extra metadata; custom source stays untouched.
export function inspectMissionDialogue(code){
  if(typeof code!=='string'||code.length>1000000)return null;
  const source=code.replaceAll('\r\n','\n'),bindings=new Map([...source.matchAll(/^findactor (\d+), "([^"\x00-\x1f]+)"$/gm)].map(match=>[Number(match[1]),match[2]])),camera=/^dialog_begin \d+, \d+$/m.test(source);
  const lines=camera?[...source.matchAll(/^dialog_camswitch (\d+), (\d+)\nhuman_talk (\d+), (\d+)$/gm)].map(match=>({speaker:bindings.get(Number(match[3])),listener:bindings.get(Number(match[1])),textId:Number(match[4])})):[...source.matchAll(/^human_talk (\d+), (\d+)$/gm)].map(match=>({speaker:bindings.get(Number(match[1])),textId:Number(match[2])}));
  const use=/^detector_waitforuse (\d+)$/m.exec(source),signal=/^detector_setsignal (\d+), 1$/m.exec(source),waitForSignal=source.includes('label 1\ndetector_issignal -1, 2, -1\n'),onComplete=signal?bindings.get(Number(signal[1])):null;
  const dialogue={...inspectMissionActivation(source),...(use?{interactionId:Number(use[1])}:{}),camera,lines,flow:waitForSignal||onComplete?{waitForSignal,onComplete,onFailure:null}:null};
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
