import { missionFlow } from './mission-flow.js';

// A linear task uses one detector program. Each stage removes only its own
// objective; other mission scripts retain their objectives and state.
export function missionTaskScript({objectiveId, interactionId, nextObjectiveId, completeId, targetName, targetRadius = 3, exitToMenu = false, checkpointId = null, failure = null, flow = null} = {}) {
  for (const id of [objectiveId, interactionId, nextObjectiveId, completeId]) if (!Number.isSafeInteger(id) || id < 0 || id > 0xffffffff) throw new Error('Úkol: ID textů musí být celá čísla 0–4294967295.');
  if (typeof targetName !== 'string' || !targetName.trim() || targetName.length > 255 || /["\x00-\x1f]/.test(targetName)) throw new Error('Úkol: neplatný název cílového objektu.');
  if (typeof targetRadius !== 'number' || !Number.isFinite(targetRadius) || targetRadius <= 0 || !Number.isFinite(Math.fround(targetRadius)) || Math.fround(targetRadius) <= 0) throw new Error('Úkol: poloměr cíle musí být kladné konečné číslo.');
  if (typeof exitToMenu !== 'boolean') throw new Error('Úkol: neplatná volba návratu do menu.');
  if (checkpointId !== null && (!Number.isSafeInteger(checkpointId) || checkpointId < 5000 || checkpointId > 5599)) throw new Error('Úkol: checkpoint musí mít ID textu 5000–5599.');
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
  const link=missionFlow(flow,{actorOffset:human===null?0:1,allowFailure:failure!==null,exitOnComplete:exitToMenu,endOnFailure:Boolean(failure?.endMission)}),actors=(human===null?0:1)+link.actors;
  const start=(human===null?'':`findactor 0, "${human}"\n`)+(timeout===null?'':'getgametime 8\n');
  const poll=(human===null?'':'human_getproperty 0, 7, Energy\nif flt[7] > 0, -1, 30\n')+(timeout===null?'':`getgametime 9\nlet flt[9] = flt[9] - flt[8]\nif flt[9] > ${timeout*1000}, 30, -1\n`);
  const failed=failure===null?'':`\nlabel 30\nmission_objectivesremove ${nextObjectiveId}\nsubtitle_add ${failure.textId}\nconsole_addtext ${failure.textId}\nwait 4000\n${link.failure}${failure.endMission?`endofmission 0, ${failure.textId}\n`:''}end`;
  return `dim_frm 2\ndim_flt ${timeout!==null?10:human!==null?8:7}\n${actors?`dim_act ${actors}\n`:''}wait 2000\n${link.gate}${link.start}findframe 0, "${targetName}"\nfindframe 1, "Tommy"\nmission_objectives ${objectiveId}\nsubtitle_add ${objectiveId}\ndetector_waitforuse ${interactionId}\nmission_objectivesremove ${objectiveId}\nmission_objectives ${nextObjectiveId}\nsubtitle_add ${nextObjectiveId}\n${start}${checkpointId === null ? '' : `autosavegamefull ${checkpointId}, 1\n`}label 10\n${poll}frm_getworldpos 0, 0\nfrm_getworldpos 1, 3\nvect_sub_vect 0, 3\nvect_magnitude 0, 6\nif flt[6] < ${targetRadius}, 20, -1\nwait 100\ngoto 10\nlabel 20\nmission_objectivesremove ${nextObjectiveId}\nsubtitle_add ${completeId}\nconsole_addtext ${completeId}\nwait 4000\n${link.complete}${exitToMenu ? `endofmission 1, ${completeId}\n` : ''}end${failed}`;
}
