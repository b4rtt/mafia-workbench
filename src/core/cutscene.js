import path from 'node:path';
import { inspectScene } from './scene.js';

const canonical = value => value.replaceAll('\\','/').normalize('NFC').toLowerCase();
// Resolve engine resource aliases within the indexed project, never by fuzzy basename.
export function cutsceneResource(assets, resource, folder, extension) {
  if (typeof resource !== 'string' || /[\x00-\x1f]/.test(resource)) return null;
  let name = canonical(resource);
  if (name.split('/').some(part => part === '..' || part === '.') || name.startsWith('/')) return null;
  if (extension) name = name.replace(/\.(?:i3d|4ds|5ds)$/i, extension);
  const candidates = name.startsWith(folder+'/') ? [name] : [folder+'/'+name];
  return assets.find(asset => candidates.includes(canonical(asset.path)))?.path ?? null;
}

export async function replayMissions(project, name) {
  const replay = project.asset(name); if (!/\.rep$/i.test(replay.path)) throw new Error('Neplatný soubor REP.');
  const basename = path.posix.basename(canonical(replay.path)), matches = [];
  for (const asset of project.manifest.assets.filter(a => /^missions\/[^/]+\/scene2\.bin$/i.test(a.path))) {
    const source=await project.read(asset.path);
    let scene;try { scene=inspectScene(source); } catch { continue; }
    const refs = sceneReplayReferences(scene,basename);
    if (!refs.length) continue;
    const differences = [...new Set(refs.map(ref => cutsceneResource(project.manifest.assets,ref.difference,'diff')).filter(Boolean))];
    matches.push({ path:asset.path, differences });
  }
  // Literal references are suggestions, not evaluation of mission scripts.
  return matches;
}

const scriptLines = code => code.split(/\r?\n/).map(line=>line.replace(/\/\/.*$/,'').trim()).filter(Boolean);
const loadReference = line => /^recload(?:full)?\s+"([^"\r\n]+)"$/i.exec(line);
const differenceReference = line => /^loaddifferences\s+"([^"\r\n]+)"$/i.exec(line);
const replayBasename = value => { const name=path.posix.basename(canonical(value));return path.posix.extname(name)?name:name+'.rep'; };
// Only adjacent literal load commands are paired. Another cutscene's CHG in
// the same mission must not prevent selecting the selected REP's own CHG.
export function sceneReplayReferences(scene, basename) {
  const scripts=[...(scene.actorScripts??[]),...(scene.entries??[]).filter(e=>e.kind==='script'&&!e.actorScript).map(e=>e.value)],refs=[];
  for(const script of scripts){
    const lines=scriptLines(script.code);
    for(let i=0;i<lines.length;i++){
      const load=loadReference(lines[i]);if(!load||replayBasename(load[1])!==basename)continue;
      refs.push({difference:i?differenceReference(lines[i-1])?.[1]??null:null,visibility:preludeVisibility(lines.slice(0,i))});
    }
  }
  return refs;
}
function preludeVisibility(lines) {
  const frames=new Map(),states=new Map();let stopped=-1;
  const apply=line=>{
    let match;
    if((match=/^findframe\s+(\d+)\s*,\s*"([^"\r\n]+)"$/i.exec(line))){frames.set(Number(match[1]),match[2]);return true;}
    if((match=/^frm_seton\s+(\d+)\s*,\s*([01])$/i.exec(line))&&frames.has(Number(match[1]))){const name=frames.get(Number(match[1]));states.set(canonical(name),{name,visible:match[2]==='1'});return true;}
    // These commands do not assign frame variables. No control flow, dynamic
    // frame lookup or frame-expression assignment is interpreted.
    return /^(?:dim_(?:frm|act|flt)|findactor|commandblock|player_lockcontrols|mission_objectives(?:clear)?|zatmyse|act_setstate|setcitytrafficvisible|setcompass|enemy_block|setevent|wait|recwaitforend|recunload|cleardifferences|change_mission)\b/i.test(line)||/^door_lock\s+\d+\s*,\s*[01]$/i.test(line)||Boolean(loadReference(line)||differenceReference(line));
  };
  for(let i=0;i<lines.length;i++)if(!apply(lines[i])){stopped=i;break;}
  if(stopped<0)return [...states.values()];
  // A conditional trigger can precede the cutscene. Infer only the final
  // straight-line commandblock that contains its load, using bindings declared
  // before that trigger. Any possible intervening reassignment invalidates them.
  const start=lines.findLastIndex(line=>/^commandblock\s+1$/i.test(line));
  if(start<=stopped)return null;
  for(const line of lines.slice(stopped,start)){
    const lookup=/^findframe\s+(\d+)\b/i.exec(line);
    if(lookup)frames.delete(Number(lookup[1]));
    else if(/^(?:findframe|dim_frm)\b/i.test(line)||/\bfrm\s*\[/i.test(line))frames.clear();
  }
  states.clear();
  for(const line of lines.slice(start+1))if(/^commandblock\s+0$/i.test(line)||!apply(line))return null;
  return [...states.values()];
}

export function cutsceneAudioEvents(replay, objects, assets, texts = new Map()) {
  const names = new Map();
  for (const object of objects.filter(o => o.frameType === 4)) {
    const key = canonical(object.name); names.set(key,names.has(key)?null:object);
  }
  const events = [];
  for (const event of replay.events.sounds) {
    if (event.state !== 0) continue; // recorder_tick_tracks: 0 enables, 1 disables.
    const object = names.get(canonical(event.name)), resource = object?.resource ?? object?.model;
    const next = replay.events.sounds.find(e => e.index > event.index && canonical(e.name) === canonical(event.name));
    events.push({ id:'sound/'+event.index,channel:'sound/'+canonical(event.name),start:event.time,end:next?.time ?? replay.duration,path:cutsceneResource(assets,resource,'sounds'),loop:false,kind:'sound' });
  }
  const lines = replay.events.dialogues.filter(event => !event.command);
  for (const event of lines) {
    const next = lines.find(e => e.index > event.index && e.character === event.character);
    events.push({ id:'dialogue/'+event.index,channel:'dialogue/'+event.character,start:event.time,end:next?.time ?? replay.duration,path:cutsceneResource(assets,String(event.textId).padStart(8,'0')+'.wav','sounds'),loop:false,kind:'dialogue',textId:event.textId,text:texts.get(event.textId) ?? '' });
  }
  return events;
}

// REP command 1 binds the named actor to a speech channel. Regular IDs use
// that binding; their name field is not an alternative speaker lookup.
export function cutsceneLipEvents(replay, assets) {
  const bindings=new Map(),events=[],records=replay.events.dialogues;
  for(const event of records){
    if(event.textId===1){bindings.set(event.character,event.name||null);continue;}
    if(event.command||!bindings.get(event.character))continue;
    const next=records.find(e=>e.index>event.index&&e.character===event.character&&(e.textId===1||!e.command));
    events.push({start:event.time,end:next?.time??replay.duration,speaker:bindings.get(event.character),path:cutsceneResource(assets,String(event.textId).padStart(8,'0')+'.dat','tables/dat'),textId:event.textId});
  }
  return events;
}

// Interpret only straight-line frame visibility commands, never execute script
// code. Reject the entire fragment if control flow or another command appears.
export function cutsceneVisibilityEvents(replay, scripts) {
  const names=new Map(),events=[],warnings=[];
  for(const script of scripts){const key=canonical(script.name);names.set(key,names.has(key)?null:script.code);}
  for(const event of replay.events.scripts??[]){
    const code=names.get(canonical(event.name));if(typeof code!=='string'||! /\bfrm_seton\b/i.test(code))continue;
    const frames=new Map(),changes=[];let supported=true;
    for(const source of code.split(/\r?\n/)){
      const line=source.replace(/\/\/.*$/,'').trim();if(!line)continue;
      let match;
      if(/^(?:dim_frm\s+\d+|commandblock\s+[01])$/i.test(line))continue;
      if((match=/^findframe\s+(\d+)\s*,\s*"([^"\r\n]+)"$/i.exec(line))){frames.set(Number(match[1]),match[2]);continue;}
      if((match=/^frm_seton\s+(\d+)\s*,\s*([01])$/i.exec(line))&&frames.has(Number(match[1]))){changes.push({name:frames.get(Number(match[1])),visible:match[2]==='1'});continue;}
      supported=false;break;
    }
    if(supported)events.push({time:event.time,index:event.index,changes});else warnings.push('Náhled nepodporuje skript viditelnosti: '+event.name);
  }
  return {events,warnings};
}

export async function loadCutsceneContext(project, replayName, sceneName, differenceName = null) {
  if (!/^missions\/[^/]+\/scene2\.bin$/i.test(sceneName)) throw new Error('Vyberte scene2.bin konkrétní mise.');
  const replay = await project.inspect(replayName); if (replay.type !== 'replay') throw new Error('REP není podporovaný.');
  const scene = await project.inspectMap(sceneName), warnings = [], objects = scene.objects.map(o => ({...o})), scripts=[];
  const refs=sceneReplayReferences(scene,path.posix.basename(canonical(replayName))).filter(ref=>differenceName?canonical(cutsceneResource(project.manifest.assets,ref.difference,'diff')??'')===canonical(differenceName):ref.difference===null);
  const initial=refs.length===1?refs[0].visibility:null;
  if(refs.length&&initial===null)warnings.push('Inicializační viditelnost mise není jednoznačná nebo obsahuje nepodporované příkazy.');
  if (differenceName) {
    const difference = await project.inspect(differenceName); if (difference.type !== 'difference') throw new Error('CHG není podporované.');
    scripts.push(...(difference.entries??[]).filter(e=>e.kind==='script').map(e=>e.value));
    for (const source of difference.objects) {
      const object = { ...source,id:'difference/'+source.index,fields:{},model:source.frameType===9?source.resource:undefined };
      const index = objects.findIndex(o => canonical(o.name) === canonical(object.name));
      if (index < 0) objects.push(object); else objects[index] = {...objects[index],...object};
    }
  }
  const assets = project.manifest.assets;
  for (const object of objects) if (object.frameType === 9 && object.model) {
    object.modelPath = cutsceneResource(assets,object.model,'models','.4ds');
    if (!object.modelPath) warnings.push('Chybí model: '+object.model);
  }
  const usedIds = new Set(replay.tracks.flatMap(t => t.keys.flatMap(k => k.modelAnimationId!==undefined ? [k.modelAnimationId] : (k.animationFlags & 0x7ff) >= 0x400 ? [(k.animationFlags & 0x7ff)-0x400] : [])));
  // Human playback adds TCK placement only when bit 0x1000 is set. The same
  // bit on a plain model actor enables its 5DS, without adding a motion track.
  const motionIds = new Set(replay.tracks.filter(t=>[2,3,27].includes(t.kind)).flatMap(t=>t.keys.filter(k=>(k.animationFlags&0x1000)&&(k.animationFlags&0x7ff)>=0x400).map(k=>(k.animationFlags&0x7ff)-0x400)));
  const animations = replay.channels.find(c => c.id==='animations').records.filter(r => usedIds.has(r.animationId)).map(record => {
    const name = replay.entries.find(e => e.id===record.prefix+'name').value;
    const resource = cutsceneResource(assets,name,'anims','.5ds');
    if (!resource) warnings.push('Chybí animace: '+name);
    const animation={ id:record.animationId,name,path:resource };
    if(motionIds.has(record.animationId)){
      animation.motionPath=cutsceneResource(assets,name,'anims','.tck');
      if(!animation.motionPath)warnings.push('Chybí pohybová stopa TCK: '+name);
    }
    return animation;
  });
  const textAsset = assets.find(a=>/textdb_cz\.def$/i.test(a.path)) ?? assets.find(a=>/textdb_en\.def$/i.test(a.path));
  const texts = textAsset ? new Map((await project.inspect(textAsset.path)).entries.map(e=>[e.id,e.text])) : new Map();
  const audio = cutsceneAudioEvents(replay,objects,assets,texts);
  const missingAudio = audio.filter(e=>!e.path).length;
  if (missingAudio) warnings.push(`${missingAudio} zvukových událostí nemá dostupný zdroj.`);
  const visibility=cutsceneVisibilityEvents(replay,scripts);warnings.push(...visibility.warnings);
  const lips=cutsceneLipEvents(replay,assets);
  return { scenePath:scene.path,differencePath:differenceName,geometry:scene.geometry,objects,animations,audio,lips,visibility:[...(initial?.length?[{time:0,index:-1,changes:initial}]:[]),...visibility.events],warnings };
}
