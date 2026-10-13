// A linear task uses one detector program. Each stage removes only its own
// objective; other mission scripts retain their objectives and state.
export function missionTaskScript({objectiveId, interactionId, nextObjectiveId, completeId, targetName, targetRadius = 3, exitToMenu = false, checkpointId = null} = {}) {
  for (const id of [objectiveId, interactionId, nextObjectiveId, completeId]) if (!Number.isSafeInteger(id) || id < 0 || id > 0xffffffff) throw new Error('Úkol: ID textů musí být celá čísla 0–4294967295.');
  if (typeof targetName !== 'string' || !targetName.trim() || targetName.length > 255 || /["\x00-\x1f]/.test(targetName)) throw new Error('Úkol: neplatný název cílového objektu.');
  if (typeof targetRadius !== 'number' || !Number.isFinite(targetRadius) || targetRadius <= 0 || !Number.isFinite(Math.fround(targetRadius)) || Math.fround(targetRadius) <= 0) throw new Error('Úkol: poloměr cíle musí být kladné konečné číslo.');
  if (typeof exitToMenu !== 'boolean') throw new Error('Úkol: neplatná volba návratu do menu.');
  if (checkpointId !== null && (!Number.isSafeInteger(checkpointId) || checkpointId < 5000 || checkpointId > 5599)) throw new Error('Úkol: checkpoint musí mít ID textu 5000–5599.');
  return `dim_frm 2\ndim_flt 7\nwait 2000\nfindframe 0, "${targetName}"\nfindframe 1, "Tommy"\nmission_objectives ${objectiveId}\nsubtitle_add ${objectiveId}\ndetector_waitforuse ${interactionId}\nmission_objectivesremove ${objectiveId}\nmission_objectives ${nextObjectiveId}\nsubtitle_add ${nextObjectiveId}\n${checkpointId === null ? '' : `autosavegamefull ${checkpointId}, 1\n`}label 10\nfrm_getworldpos 0, 0\nfrm_getworldpos 1, 3\nvect_sub_vect 0, 3\nvect_magnitude 0, 6\nif flt[6] < ${targetRadius}, 20, -1\nwait 100\ngoto 10\nlabel 20\nmission_objectivesremove ${nextObjectiveId}\nsubtitle_add ${completeId}\nconsole_addtext ${completeId}\nwait 4000\n${exitToMenu ? `endofmission 1, ${completeId}\n` : ''}end`;
}
