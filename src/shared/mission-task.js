import { missionFlow, missionFlowTargets } from './mission-flow.js';
import { validMissionDestination } from './mission-destinations.js';

const key = name => name.normalize('NFC').toLowerCase();
export function missionTaskVehicles(scene) {
  return (scene.actors ?? []).filter(actor => {
    if (actor.kind !== 4 || typeof actor.name !== 'string' || !actor.name.trim()) return false;
    const name = key(actor.name), frames = (scene.objects ?? []).filter(frame => key(frame.name) === name);
    return scene.actors.filter(other => key(other.name) === name).length === 1 && frames.length === 1 && frames[0].frameType === 9 && Boolean(frames[0].model) && !(scene.geometry?.meshes ?? []).some(frame => key(frame.name) === name);
  });
}

// A linear task uses one detector program. Each stage removes only its own
// objective; other mission scripts retain their objectives and state.
export function missionTaskScript({objectiveId, interactionId, nextObjectiveId, completeId, targetName, targetRadius = 3, exitToMenu = false, nextMission = null, checkpointId = null, failure = null, flow = null, vehicle = null} = {}) {
  for (const id of [objectiveId, interactionId, nextObjectiveId, completeId]) if (!Number.isSafeInteger(id) || id < 0 || id > 0xffffffff) throw new Error('Úkol: ID textů musí být celá čísla 0–4294967295.');
  if (typeof targetName !== 'string' || !targetName.trim() || targetName.length > 255 || /["\x00-\x1f]/.test(targetName)) throw new Error('Úkol: neplatný název cílového objektu.');
  if (typeof targetRadius !== 'number' || !Number.isFinite(targetRadius) || targetRadius <= 0 || !Number.isFinite(Math.fround(targetRadius)) || Math.fround(targetRadius) <= 0) throw new Error('Úkol: poloměr cíle musí být kladné konečné číslo.');
  if (typeof exitToMenu !== 'boolean') throw new Error('Úkol: neplatná volba návratu do menu.');
  if(nextMission!==null&&!validMissionDestination(nextMission))throw new Error('Úkol: neplatný název další mise.');
  if(nextMission!==null&&(exitToMenu||flow?.onComplete!=null))throw new Error('Úkol: další misi nelze kombinovat s návratem do menu nebo signálem dokončení.');
  if (checkpointId !== null && (!Number.isSafeInteger(checkpointId) || checkpointId < 5000 || checkpointId > 5599)) throw new Error('Úkol: checkpoint musí mít ID textu 5000–5599.');
  if (vehicle !== null && (typeof vehicle !== 'object' || Array.isArray(vehicle) || typeof vehicle.name !== 'string' || !vehicle.name.trim() || vehicle.name.length > 255 || /["\x00-\x1f]/.test(vehicle.name) || typeof vehicle.driverOnly !== 'boolean' || key(vehicle.name) === key(targetName) || key(vehicle.name) === 'tommy')) throw new Error('Úkol: vyberte auto odlišné od cíle a platnou volbu místa řidiče.');
  let timeout=null,human=null;
  if(failure!==null){
    if(typeof failure!=='object'||Array.isArray(failure))throw new Error('Úkol: neplatné podmínky neúspěchu.');
    timeout=failure.timeoutSeconds??null;human=failure.humanName??null;
    if(timeout!==null&&(typeof timeout!=='number'||!Number.isFinite(timeout)||timeout<0.1||timeout>86400))throw new Error('Úkol: časový limit musí být 0,1–86400 sekund.');
    if(human!==null&&(typeof human!=='string'||!human.trim()||human.length>255||/["\x00-\x1f]/.test(human)))throw new Error('Úkol: neplatný název hlídané postavy.');
    if(timeout===null&&human===null)throw new Error('Úkol: vyberte alespoň jednu podmínku neúspěchu.');
    if(!Number.isSafeInteger(failure.textId)||failure.textId<0||failure.textId>0x7fffffff)throw new Error('Úkol: ID neúspěchu musí být celé číslo 0–2147483647.');
    if(failure.endMission!==undefined&&typeof failure.endMission!=='boolean')throw new Error('Úkol: neplatná volba konce mise při neúspěchu.');
  }
  const player=human===null?0:1,car=player+1,owner=player+2,offset=player+(vehicle===null?0:3);
  const link=missionFlow(flow,{actorOffset:offset,allowFailure:failure!==null,exitOnComplete:exitToMenu,endOnFailure:Boolean(failure?.endMission)}),actors=offset+link.actors;
  const start=(human===null?'':`findactor 0, "${human}"\n`)+(vehicle===null?'':`findactor ${player}, "Tommy"\nfindactor ${car}, "${vehicle.name}"\n`)+(timeout===null?'':'getgametime 8\n');
  const poll=(human===null?'':'human_getproperty 0, 7, Energy\nif flt[7] > 0, -1, 30\n')+(timeout===null?'':`getgametime 9\nlet flt[9] = flt[9] - flt[8]\nif flt[9] > ${timeout*1000}, 30, -1\n`);
  const occupancy=vehicle===null?'':`setnullactor ${owner}\nhuman_getowner ${player}, ${owner}\ncompareactors ${car}, ${owner}, 10\nif flt[10] = 1, -1, 15\n${vehicle.driverOnly?`human_getseatidx ${player}, 11\nif flt[11] = 0, -1, 15\n`:''}`;
  const failed=failure===null?'':`\nlabel 30\nmission_objectivesremove ${nextObjectiveId}\nsubtitle_add ${failure.textId}\nconsole_addtext ${failure.textId}\nwait 4000\n${link.failure}${failure.endMission?`endofmission 0, ${failure.textId}\n`:''}end`;
  const transition=nextMission===null?'':`change_mission "${nextMission}", "", -1\n`;
  return `dim_frm 2\ndim_flt ${vehicle!==null?12:timeout!==null?10:human!==null?8:7}\n${actors?`dim_act ${actors}\n`:''}wait 2000\n${link.gate}${link.start}findframe 0, "${targetName}"\nfindframe 1, "${vehicle?.name??'Tommy'}"\nmission_objectives ${objectiveId}\nsubtitle_add ${objectiveId}\ndetector_waitforuse ${interactionId}\nmission_objectivesremove ${objectiveId}\nmission_objectives ${nextObjectiveId}\nsubtitle_add ${nextObjectiveId}\n${start}${checkpointId === null ? '' : `autosavegamefull ${checkpointId}, 1\n`}label 10\n${poll}${occupancy}frm_getworldpos 0, 0\nfrm_getworldpos 1, 3\nvect_sub_vect 0, 3\nvect_magnitude 0, 6\nif flt[6] < ${targetRadius}, 20, -1\n${vehicle===null?'':'label 15\n'}wait 100\ngoto 10\nlabel 20\nmission_objectivesremove ${nextObjectiveId}\nsubtitle_add ${completeId}\nconsole_addtext ${completeId}\nwait 4000\n${link.complete}${transition}${exitToMenu ? `endofmission 1, ${completeId}\n` : ''}end${failed}`;
}

// Recovery is read-only until the entire source round trips through the wizard.
// Custom commands, changed labels and unknown variants stay in the source editor.
export function inspectMissionTask(code) {
  if(typeof code!=='string'||code.length>1000000)return null;
  const source=code.replaceAll('\r\n','\n'),bindings=new Map([...source.matchAll(/^findactor (\d+), "([^"\x00-\x1f]+)"$/gm)].map(match=>[Number(match[1]),match[2]]));
  const objective=/^mission_objectives (\d+)$/m.exec(source),use=/^detector_waitforuse (\d+)$/m.exec(source),next=/^mission_objectivesremove \d+\nmission_objectives (\d+)$/m.exec(source),complete=/^label 20\nmission_objectivesremove \d+\nsubtitle_add (\d+)$/m.exec(source);
  const target=/^findframe 0, "([^"\x00-\x1f]+)"$/m.exec(source),radius=/^if flt\[6\] < ([\d.e+-]+), 20, -1$/m.exec(source),checkpoint=/^autosavegamefull (\d+), 1$/m.exec(source),transition=/^change_mission "([^"]+)", "", -1$/m.exec(source);
  const guard=/^human_getproperty (\d+), 7, Energy$/m.exec(source),timeout=/^if flt\[9\] > ([\d.e+-]+), 30, -1$/m.exec(source),failureText=/^label 30\nmission_objectivesremove \d+\nsubtitle_add (\d+)$/m.exec(source),parts=source.split('\nlabel 30\n');
  const occupancy=/^compareactors (\d+), \d+, 10$/m.exec(source),signal=part=>{const match=/^detector_setsignal (\d+), 1$/m.exec(part??'');return match?bindings.get(Number(match[1])):null;};
  const flow={waitForSignal:source.includes('label 1\ndetector_issignal -1, 2, -1\n'),onComplete:signal(parts[0]),onFailure:signal(parts[1])};
  const task={objectiveId:Number(objective?.[1]),interactionId:Number(use?.[1]),nextObjectiveId:Number(next?.[1]),completeId:Number(complete?.[1]),targetName:target?.[1],targetRadius:Number(radius?.[1]),checkpointId:checkpoint?Number(checkpoint[1]):null,nextMission:transition?.[1]??null,exitToMenu:/^endofmission 1, \d+$/m.test(parts[0]),
    vehicle:occupancy?{name:bindings.get(Number(occupancy[1])),driverOnly:/^human_getseatidx \d+, 11$/m.test(source)}:null,
    failure:failureText?{timeoutSeconds:timeout?Number(timeout[1])/1000:null,humanName:guard?bindings.get(Number(guard[1])):null,textId:Number(failureText[1]),endMission:/^endofmission 0, \d+$/m.test(parts[1]??'')}:null,flow:flow.waitForSignal||flow.onComplete||flow.onFailure?flow:null};
  try{if(missionTaskScript(task)===source)return task;}catch{/* Do not replace unrecognized source. */}
  return null;
}
export function editableMissionTask(scene,owner) {
  if(typeof owner!=='string'||!owner.trim())return null;
  const actors=(scene.actors??[]).filter(actor=>key(actor.name)===key(owner)),entries=(scene.entries??[]).filter(entry=>entry.actorScript&&entry.actorKind===5&&key(entry.value.name)===key(owner));
  if(actors.length!==1||actors[0].kind!==5||entries.length!==1||!missionFlowTargets(scene).some(actor=>key(actor.name)===key(owner)))return null;
  const masks=scene.entries.filter(entry=>entry.detectorParameter&&entry.id.startsWith(actors[0].id+'/'));
  if(masks.length!==1||masks[0].value!==1)return null;
  const task=inspectMissionTask(entries[0].value.code);
  return task?{entry:entries[0],task}:null;
}
