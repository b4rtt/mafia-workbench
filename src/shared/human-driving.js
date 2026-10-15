import { missionTaskVehicles } from './mission-task.js';
import { roadConnections } from './roads.js';
import { missionFlowTargets } from './mission-flow.js';

const key=name=>name.normalize('NFC').toLowerCase();
const validName=name=>typeof name==='string'&&name.trim()&&name.length<=255&&!/["\x00-\x1f]/.test(name);
export function humanDrivingTargets(scene,owner,car){
  const frames=[...(scene.objects??[]),...(scene.geometry?.meshes??[])],moving=new Set((scene.actors??[]).filter(actor=>[2,4,27].includes(actor.kind)).map(actor=>key(actor.name))),counts=new Map();
  for(const frame of frames)counts.set(key(frame.name),(counts.get(key(frame.name))??0)+1);
  return frames.filter(frame=>validName(frame.name)&&key(frame.name)!==key(owner??'')&&key(frame.name)!==key(car??'')&&!moving.has(key(frame.name))&&(frame.frameType===6||frame.frameType===9&&frame.model||frame.type===1)&&counts.get(key(frame.name))===1);
}
export function humanDrivingScript(owner,options){
  if(!validName(owner)||!validName(options?.carName)||key(owner)===key(options.carName))throw new Error('Jízda: vyberte auto odlišné od řidiče.');
  if(!['walk','seated'].includes(options.boarding)||typeof options.loop!=='boolean'||!Number.isFinite(options.delaySeconds)||options.delaySeconds<0||options.delaySeconds>86400)throw new Error('Jízda: zvolte nástup, opakování a prodlevu 0–86400 sekund.');
  if(!Array.isArray(options.stops)||options.stops.length<1||options.stops.length>32||options.stops.some(stop=>!validName(stop?.name)||key(stop.name)===key(owner)||key(stop.name)===key(options.carName)||!Number.isFinite(stop.pauseSeconds)||stop.pauseSeconds<0||stop.pauseSeconds>86400))throw new Error('Jízda: vyberte 1–32 cílových bodů s čekáním 0–86400 sekund.');
  if(options.loop&&new Set(options.stops.map(stop=>key(stop.name))).size<2)throw new Error('Jízda: opakovaná trasa potřebuje alespoň dva různé cíle.');
  const {startSignal=null,onComplete=null,exitAfterArrival=false}=options;
  if(typeof exitAfterArrival!=='boolean'||options.loop&&exitAfterArrival)throw new Error('Jízda: vystoupení po příjezdu potřebuje jednorázovou trasu.');
  for(const name of [startSignal,onComplete])if(name!==null&&(!validName(name)||key(name)===key(owner)))throw new Error('Jízda: vyberte platný skriptový bod odlišný od řidiče.');
  if(options.loop&&onComplete!==null)throw new Error('Jízda: signál dokončení potřebuje jednorázovou trasu.');
  if(startSignal!==null||onComplete!==null||exitAfterArrival){
    const names=[...new Map([startSignal,onComplete].filter(name=>name!==null).map(name=>[key(name),name])).values()],slot=name=>2+names.findIndex(other=>key(other)===key(name));
    // Read the gate without clearing it: a signal sent during initialization is retained.
    // Keep the actor alive after arrival, as end disables the NPC and its colliders.
    const exitSlot=2+names.length;
    return [`// Mafia Workbench human driving v${exitAfterArrival?3:2}`,`dim_act ${exitSlot+(exitAfterArrival?1:0)}`,'dim_frm 1',...(exitAfterArrival?['dim_flt 1']:[]),'wait 2000',`findactor 0, "${owner}"`,`findactor 1, "${options.carName}"`,...names.map((name,index)=>`findactor ${index+2}, "${name}"`),
      ...(startSignal===null?[]:['label 100',`detector_issignal ${slot(startSignal)}, 200, -1`,'wait 100','goto 100','label 200']),`wait ${Math.round(options.delaySeconds*1000)}`,
      ...(options.boarding==='walk'?['enemy_move_to_car 1, 0, walk','enemy_usecar 1, 0']:['human_force_settocar 0, 1, 0','wait 2000']),'label 1',
      ...options.stops.flatMap(stop=>[`findframe 0, "${stop.name}"`,'enemy_car_moveto 1, 0, stop',`wait ${Math.round(stop.pauseSeconds*1000)}`]),
      // USECAR without arguments exits the current vehicle. Wait for the actual
      // owner link to clear before announcing completion; never teleport the NPC.
      ...(exitAfterArrival?['enemy_usecar','label 300',`setnullactor ${exitSlot}`,`human_getowner 0, ${exitSlot}`,`compareactors 1, ${exitSlot}, 0`,'if flt[0] = 1, 310, 320','label 310','wait 100','goto 300','label 320']:[]),
      ...(options.loop?['wait 100','goto 1']:[...(onComplete===null?[]:[`detector_setsignal ${slot(onComplete)}, 1`]),'label 2','wait 1000','goto 2']),''].join('\r\n');
  }
  return ['// Mafia Workbench human driving v1','dim_act 2','dim_frm 1','wait 2000',`wait ${Math.round(options.delaySeconds*1000)}`,`findactor 0, "${owner}"`,`findactor 1, "${options.carName}"`,...(options.boarding==='walk'?['enemy_move_to_car 1, 0, walk','enemy_usecar 1, 0'] : ['human_force_settocar 0, 1, 0','wait 2000']),'label 1',...options.stops.flatMap(stop=>[`findframe 0, "${stop.name}"`,'enemy_car_moveto 1, 0, stop',`wait ${Math.round(stop.pauseSeconds*1000)}`]),...(options.loop?['wait 100','goto 1']:['label 2','wait 1000','goto 2']),''].join('\r\n');
}
export function inspectHumanDriving(owner,code){
  const normalized=code.replaceAll('\r\n','\n'),lines=normalized.split('\n'),version=/^\/\/ Mafia Workbench human driving v([123])$/.exec(lines[0])?.[1];if(!version)return null;
  const legacy=version==='1';
  const route=lines.indexOf('label 1'),delay=/^wait (\d+)$/.exec(lines[legacy?4:route-3]??''),car=/^findactor 1, "([^"\x00-\x1f]+)"$/m.exec(normalized),stops=[];let at=route+1;
  while(/^findframe /.test(lines[at]??'')){
    const frame=/^findframe 0, "([^"\x00-\x1f]+)"$/.exec(lines[at]),pause=/^wait (\d+)$/.exec(lines[at+2]??'');if(!frame||!pause)break;
    stops.push({name:frame[1],pauseSeconds:Number(pause[1])/1000});at+=3;
  }
  const options={mode:'drive',carName:car?.[1],boarding:lines[route-2]==='enemy_move_to_car 1, 0, walk'?'walk':'seated',stops,loop:lines[at]==='wait 100',delaySeconds:Number(delay?.[1])/1000};
  if(!legacy){
    const actors=new Map([...normalized.matchAll(/^findactor (\d+), "([^"\x00-\x1f]+)"$/gm)].map(match=>[Number(match[1]),match[2]])),gate=/^detector_issignal (\d+), 200, -1$/m.exec(normalized),complete=/^detector_setsignal (\d+), 1$/m.exec(normalized);
    options.startSignal=gate?actors.get(Number(gate[1])):null;options.onComplete=complete?actors.get(Number(complete[1])):null;
  }
  if(version==='3')options.exitAfterArrival=true;
  try{if(humanDrivingScript(owner,options).replaceAll('\r\n','\n')===normalized)return options;}catch{/* Edited programs remain custom. */}return null;
}
export function resolveHumanDriving(scene,owner,options,roads){
  humanDrivingScript(owner,options);
  const car=missionTaskVehicles(scene).find(actor=>key(actor.name)===key(options.carName));if(!car)throw new Error('Jízda: vyberte jednoznačné auto s aktérem typu Vozidlo této mise.');
  const targets=humanDrivingTargets(scene,owner,car.name),stops=options.stops.map(stop=>{const frame=targets.find(frame=>key(frame.name)===key(stop.name));if(!frame)throw new Error('Jízda: cíle musí být jednoznačné nepohyblivé objekty nebo skriptové body této mise.');return {...stop,name:frame.name};});
  if(!roads?.crossings?.some((_,index)=>roadConnections(roads,index).length))throw new Error('Jízda: nejdřív vytvořte propojenou silniční síť v road.bin této mise.');
  const result={...options,carName:car.name,stops},points=new Map(missionFlowTargets(scene).map(actor=>[key(actor.name),actor.name]));
  for(const field of ['startSignal','onComplete'])if(result[field]!=null){const name=points.get(key(result[field]));if(!name)throw new Error('Jízda: vyberte jednoznačný skriptový bod této mise.');result[field]=name;}
  return result;
}
