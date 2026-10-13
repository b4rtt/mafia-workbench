import { missionFlow } from './mission-flow.js';

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
export function missionDialogueScript({trigger='use',interactionId,camera=false,lines,flow=null}={}){
  if(!['use','load'].includes(trigger)||typeof camera!=='boolean')throw new Error('Rozhovor: neplatný způsob spuštění nebo kamera.');
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
  const code=[`dim_act ${participants.length+link.actors}`,'wait 2000',...(link.gate+link.start).trimEnd().split('\n').filter(Boolean),...participants.map((name,i)=>`findactor ${i}, "${name}"`)];
  if(trigger==='use')code.push(`detector_waitforuse ${interactionId}`);
  if(camera)code.push(`dialog_begin 0, ${participants.length}`);
  for(const line of lines){if(camera)code.push(`dialog_camswitch ${index(line.listener)}, ${index(line.speaker)}`);code.push(`human_talk ${index(line.speaker)}, ${line.textId}`);}
  if(camera)code.push('dialog_end');
  if(link.complete)code.push(link.complete.trimEnd());
  return [...code,'end'].join('\n');
}
