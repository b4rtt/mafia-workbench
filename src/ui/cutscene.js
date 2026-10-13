import * as THREE from 'three';
import { ReplayViewport, replayPathSegments, sampleReplayPath } from './replay.js';
import { AnimationPreview } from './animation.js';
import { fromLs3dRotation } from './transforms.js';
import { sampleTrack } from './track.js';

const nameKey = value => value.normalize('NFC').toLowerCase();
export function sampleReplayActor(track, time) {
  const keys = track.keys.filter(k=>k.position&&k.rotation).sort((a,b)=>a.time-b.time||a.index-b.index);
  if (!keys.length || !Number.isFinite(time)) return null;
  let index=0;while(index+1<keys.length&&keys[index+1].time<=time)index++;
  const a=keys[index],b=keys[Math.min(index+1,keys.length-1)];
  const phase=((a.modelAnimationFlags??a.animationFlags)&0x8000)||b.time===a.time?0:Math.max(0,Math.min(1,(time-a.time)/(b.time-a.time)));
  const position=a.position.map((n,i)=>n+(b.position[i]-n)*phase);
  const rotation=fromLs3dRotation(a.rotation).slerp(fromLs3dRotation(b.rotation),phase);
  let animationStart=keys[0].time,animationId=(keys[0].animationFlags??0)&0x7ff;
  for(const key of keys.slice(0,index+1)) {
    const id=(key.animationFlags??0)&0x7ff;
    if(id!==animationId){animationId=id;animationStart=key.time;}
    if(key.animationFrame!==undefined)animationStart=key.time-key.animationFrame*40;
  }
  if(a.modelAnimationFlags!==undefined)return {position,rotation,animationId:a.modelAnimationId??null,animationTime:Math.max(0,time-a.time+(a.modelAnimationFrame??0)*40),loop:Boolean(a.modelAnimationFlags&0x2000)};
  return {position,rotation,animationId:animationId>=0x400?animationId-0x400:null,animationTime:Math.max(0,time-animationStart),loop:Boolean(a.animationFlags&0x2000),motion:[2,3,27].includes(track.kind)&&Boolean(a.animationFlags&0x1000)};
}

// human_track_apply_pose_at_time: rotate local TCK displacement by the REP
// quaternion before adding it to the anchor. A supplied direction replaces the
// facing; absence of that array leaves the REP quaternion intact.
export function replayActorPlacement(pose, track, animation) {
  if(!pose.motion||!track?.duration||!animation)return pose;
  const duration=animation.frames*40,time=pose.loop&&duration>0?pose.animationTime%duration:pose.animationTime;
  const displacement=sampleTrack(track.positions,track.step,time);
  if(!displacement)return pose;
  const position=new THREE.Vector3(...displacement).applyQuaternion(pose.rotation).add(new THREE.Vector3(...pose.position));
  const rotation=pose.rotation.clone(),direction=sampleTrack(track.secondary,track.step,time);
  if(direction&&Math.hypot(...direction)>1e-8){
    const forward=new THREE.Vector3(...direction).applyQuaternion(pose.rotation);
    rotation.setFromRotationMatrix(new THREE.Matrix4().lookAt(forward,new THREE.Vector3(),new THREE.Vector3(0,1,0)));
  }
  return {...pose,position:position.toArray(),rotation};
}

export function activeCutsceneAudio(events, durations, time) {
  return events.filter(event => {
    const duration=durations.get(event.path);
    return duration>0 && time>=event.start && time<event.end && (event.loop || time<event.start+duration*1000);
  });
}

// Independent sources follow the preview clock. Seeking/pausing never leaves an
// old dialogue or sound running, and missing media never delays the timeline.
export class CutsceneAudio {
  constructor(context = new AudioContext()) {
    this.context=context;this.buffers=new Map();this.durations=new Map();this.sources=new Map();this.events=[];this.enabled=true;this.disposed=false;
    this.gain=context.createGain();this.gain.connect(context.destination);this.abort=new AbortController();
  }
  async load(events, resolveUrl) {
    this.events=events;const paths=[...new Set(events.map(e=>e.path).filter(Boolean))];this.errors=[];
    let cursor=0;
    await Promise.all(Array.from({length:Math.min(4,paths.length)},async()=>{
      while(cursor<paths.length&&!this.disposed){const path=paths[cursor++];try{
        const response=await fetch(await resolveUrl(path),{signal:this.abort.signal});if(!response.ok)throw new Error('Médium není dostupné.');
        const buffer=await this.context.decodeAudioData(await response.arrayBuffer());if(this.disposed)return;
        this.buffers.set(path,buffer);this.durations.set(path,buffer.duration);
      }catch(error){if(!this.disposed)this.errors.push(path);}}
    }));
  }
  async unlock() { if(!this.disposed)await this.context.resume(); }
  mute(value) { this.enabled=!value;this.gain.gain.value=value?0:1; }
  sync(time, playing) {
    if(this.disposed)return;
    const events=playing?activeCutsceneAudio(this.events,this.durations,time):[],active=new Set(events.map(e=>e.id));
    for(const[id,state]of this.sources)if(!active.has(id)){state.source.stop();this.sources.delete(id);}
    for(const event of events){
      const duration=this.durations.get(event.path),offset=((time-event.start)/1000)%duration,old=this.sources.get(event.id);
      if(old&&Math.abs(old.offset+this.context.currentTime-old.started-offset)<.25)continue;
      if(old){old.source.stop();this.sources.delete(event.id);}
      const source=this.context.createBufferSource();source.buffer=this.buffers.get(event.path);source.loop=event.loop;source.connect(this.gain);
      const state={source,offset,started:this.context.currentTime};this.sources.set(event.id,state);
      source.onended=()=>{source.disconnect();if(this.sources.get(event.id)===state)this.sources.delete(event.id);};
      source.start(0,offset);source.stop(this.context.currentTime+Math.max(0,(event.end-time)/1000));
    }
  }
  dispose() {
    if(this.disposed)return;this.disposed=true;this.abort.abort();
    for(const {source}of this.sources.values())source.stop();this.sources.clear();this.buffers.clear();this.gain.disconnect();this.context.close().catch(()=>{});
  }
}

export class CutsceneViewport extends ReplayViewport {
  loadReplay(file) { this.file={...file,tracks:structuredClone(file.tracks)};this.actors=[];super.loadReplay(file); }
  async loadContext(context, resolveAsset, resolveTexture) {
    this.context=context;this.world=new THREE.Group();this.root.add(this.world);this.contextWarnings=[...context.warnings];
    const overrides=new Map(context.objects.map(o=>[nameKey(o.name),o]));
    this.addModel(context.geometry,this.world,'world/',overrides);
    const existing=new Set([...this.frames.values()].map(o=>o.userData.frame.sceneObject?.id).filter(Boolean)),models=new Map();
    for(const object of context.objects.filter(o=>o.frameType===9&&!existing.has(o.id))) {
      if(this.disposed)return;
      let model;
      if(object.modelPath){
        if(!models.has(object.modelPath))models.set(object.modelPath,resolveAsset(object.modelPath));
        try{const candidate=await models.get(object.modelPath);if(candidate.type==='model')model=candidate;else this.contextWarnings.push('Nelze načíst model: '+object.modelPath);}catch{this.contextWarnings.push('Nelze načíst model: '+object.modelPath);}
      }
      this.addSceneObject(object,model);
    }
    if(this.disposed)return;
    const names=new Map(),addName=(name,object)=>{const key=nameKey(name);names.set(key,names.has(key)&&names.get(key)!==object?null:object);};
    for(const object of this.frames.values())if(!object.userData.frame.ownerId)addName(object.name,object);
    for(const object of this.frames.values())if(object.userData.frame.ownerId){
      const owner=this.frames.get(object.userData.frame.ownerId);if(owner)addName(owner.name+'.'+object.name,object);
    }
    if(!this.backdrop){this.backdrop=new THREE.Group();this.backdrop.userData.backdrop=true;this.backdrop.visible=false;this.root.add(this.backdrop);}
    const links=new Map();
    for(const object of this.frames.values()) {
      const parent=object.userData.frame.sceneObject?.parent;if(!parent)continue;
      const target=nameKey(parent)==='primary sector'?this.root:nameKey(parent)==='backdrop sector'?this.backdrop:names.get(nameKey(parent));
      if(target)links.set(object,target);else this.contextWarnings.push(object.name+': chybí jednoznačný rodič '+parent);
    }
    for(const [object,parent]of links){const visited=new Set([object]);for(let current=parent;current;current=links.get(current)??current.parent){if(visited.has(current))throw new Error('Cutscéna: cyklická hierarchie.');visited.add(current);}}
    for(const[object,parent]of links)parent.add(object);
    this.visibility=[];this.visibilityRest=new Map();
    for(const event of context.visibility??[])for(const change of event.changes){
      const object=names.get(nameKey(change.name));
      if(!object){this.contextWarnings.push('Viditelnost: chybí jednoznačný objekt '+change.name);continue;}
      this.visibilityRest.set(object,object.visible);this.visibility.push({time:event.time,index:event.index,object,visible:change.visible});
    }
    this.visibility.sort((a,b)=>a.time-b.time||a.index-b.index);
    const animations=new Map(),motions=new Map();
    for(const resource of context.animations.filter(a=>a.path)){
      if(this.disposed)return;try{const file=await resolveAsset(resource.path);if(file.type==='animation')animations.set(resource.id,file);else this.contextWarnings.push('Nelze načíst animaci: '+resource.path);}catch{this.contextWarnings.push('Nelze načíst animaci: '+resource.path);}
      if(resource.motionPath){
        if(this.disposed)return;try{const file=await resolveAsset(resource.motionPath);if(file.type==='track')motions.set(resource.id,file);else this.contextWarnings.push('Nepodporovaná pohybová stopa: '+resource.motionPath);}catch{this.contextWarnings.push('Nelze načíst pohybovou stopu: '+resource.motionPath);}
      }
    }
    if(this.disposed)return;
    for(const track of this.file.tracks){
      const object=names.get(nameKey(track.name));if(!object){this.contextWarnings.push('Nenavázaná stopa: '+track.name);continue;}
      const frames=new Map();object.traverse(child=>{if(child.userData.frame)frames.set(child.userData.frame.id,child);});
      const previews=new Map();
      for(const id of new Set(track.keys.map(k=>k.modelAnimationId??((k.animationFlags??0)&0x7ff)-0x400)))if(animations.has(id))previews.set(id,new AnimationPreview(frames,animations.get(id)));
      const rest=new Map([...frames.values()].map(frame=>[frame,{position:frame.position.clone(),quaternion:frame.quaternion.clone(),scale:frame.scale.clone()}]));
      this.actors.push({object,track,previews,animations,motions,rest});
    }
    this.contextReady=true;await this.loadTextures(resolveTexture);if(this.disposed)return;
    this.contextWarnings.push(...(this.textureWarnings??[]));
    this.seek(this.time);this.fitShot();
    return {actors:this.actors.length,tracks:this.file.tracks.length,animations:animations.size,motions:motions.size,warnings:this.contextWarnings};
  }
  cameraMode(value) {
    this.filmCamera=value;this.controls.enabled=!value;this.grid.visible=!value;
    this.paths.visible=!value;for(const {marker}of this.markers)marker.visible=!value;
    if(!value){this.camera.up.set(0,1,0);this.camera.fov=50;this.camera.updateProjectionMatrix();this.fitShot();}
    this.seek(this.time);
  }
  seek(time) {
    super.seek(time);
    for(const [object,visible]of this.visibilityRest??[])object.visible=visible;
    for(const event of this.visibility??[])if(event.time<=time)event.object.visible=event.visible;else break;
    for(const actor of this.actors??[])for(const[object,rest]of actor.rest){object.position.copy(rest.position);object.quaternion.copy(rest.quaternion);object.scale.copy(rest.scale);}
    for(const actor of this.actors??[]) {
      const pose=sampleReplayActor(actor.track,time);if(!pose)continue;
      const preview=actor.previews.get(pose.animationId),animation=actor.animations.get(pose.animationId);
      if(preview){const frame=pose.animationTime/40;preview.apply(pose.loop&&animation.frames>0?frame%animation.frames:Math.min(frame,animation.frames));}
    }
    // Child tracks (hands, doors, wheels) are applied after the skeleton poses.
    for(const actor of this.actors??[]){const sample=sampleReplayActor(actor.track,time);if(sample){const pose=replayActorPlacement(sample,actor.motions.get(sample.animationId),actor.animations.get(sample.animationId));actor.object.position.fromArray(pose.position);actor.object.quaternion.copy(pose.rotation);}}
    if(this.filmCamera) {
      this.paths.visible=false;for(const {marker}of this.markers)marker.visible=false;
      const position=sampleReplayPath(this.replay.cameras,time),focus=sampleReplayPath(this.replay.focus,time);if(!position||!focus)return;
      const path=replayPathSegments(this.replay.cameras),segment=path.segments.find(s=>time>=s.start&&time<s.end),key=this.replay.cameras[segment?.from??path.last],next=this.replay.cameras[segment?.to??path.last];
      const start=key.curveTime??key.time,end=next.curveTime??next.time,phase=end===start?0:Math.max(0,Math.min(1,(time-start)/(end-start)));
      const fov=key.fov+(next.fov-key.fov)*phase,roll=key.roll+(next.roll-key.roll)*phase;
      if(fov>0&&fov<Math.PI)this.camera.fov=THREE.MathUtils.radToDeg(fov);
      this.camera.position.set(position[0],position[1],-position[2]);this.camera.up.set(0,1,0);this.camera.lookAt(focus[0],focus[1],-focus[2]);
      this.camera.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),-roll));this.camera.near=.02;this.camera.updateProjectionMatrix();
    }
  }
  updateEntry(id,value) {
    super.updateEntry(id,value);
    const pose=/^objects\/(\d+)\/(\d+)\/(position|rotation)$/.exec(id),camera=/^camera\/(\d+)\/(fov|roll)$/.exec(id);
    if(pose){const key=this.file.tracks[Number(pose[1])]?.keys[Number(pose[2])],count=pose[3]==='rotation'?4:3;if(key?.[pose[3]]&&Array.isArray(value)&&value.length===count&&value.every(n=>typeof n==='number'&&Number.isFinite(Math.fround(n)))&&(count!==4||value.some(n=>n!==0)))key[pose[3]]=[...value];}
    if(camera){const key=this.replay.cameras[Number(camera[1])];if(key&&!key.cut&&!key.stop&&typeof value==='number'&&Number.isFinite(Math.fround(value))&&(camera[2]!=='fov'||value>0&&value<Math.PI))key[camera[2]]=value;}
    this.seek(this.time);
  }
  dispose() { this.audio?.dispose();super.dispose(); }
}
