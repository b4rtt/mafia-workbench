const key=name=>name.normalize('NFC').toLowerCase();
const validName=name=>typeof name==='string'&&name.trim()&&name.length<=255&&!/["\x00-\x1f]/.test(name);

// Signals belong to detector actors (kind 5), not arbitrary actor scripts.
export function missionFlowTargets(scene){
  const actors=scene.actors??[],objects=scene.objects??[],meshes=scene.geometry?.meshes??[];
  return actors.filter(actor=>actor.kind===5&&validName(actor.name)&&
    actors.filter(other=>key(other.name)===key(actor.name)).length===1&&
    objects.filter(other=>key(other.name)===key(actor.name)).length<=1&&
    meshes.filter(other=>key(other.name)===key(actor.name)).length<=1&&
    [...objects,...meshes].some(other=>key(other.name)===key(actor.name)));
}
export function missionFlow(flow=null,{actorOffset=0,allowFailure=false,exitOnComplete=false,endOnFailure=false}={}){
  if(flow===null)return {actors:0,start:'',gate:'',complete:'',failure:''};
  if(typeof flow!=='object'||Array.isArray(flow))throw new Error('Návaznost: neplatná konfigurace.');
  const {waitForSignal=false,onComplete=null,onFailure=null}=flow;
  if(typeof waitForSignal!=='boolean')throw new Error('Návaznost: neplatná volba čekání na signál.');
  for(const name of [onComplete,onFailure])if(name!==null&&!validName(name))throw new Error('Návaznost: neplatný název skriptového bodu.');
  if(onFailure!==null&&!allowFailure)throw new Error('Návaznost: větev neúspěchu potřebuje podmínku neúspěchu úkolu.');
  if(onComplete!==null&&exitOnComplete)throw new Error('Návaznost: další bod nelze spustit současně s návratem do menu.');
  if(onFailure!==null&&endOnFailure)throw new Error('Návaznost: další bod nelze spustit současně s koncem hry.');
  const names=[...new Map([onComplete,onFailure].filter(name=>name!==null).map(name=>[key(name),name])).values()];
  const signal=name=>name===null?'':`detector_setsignal ${actorOffset+names.findIndex(other=>key(other)===key(name))}, 1\n`;
  return {actors:names.length,start:names.map((name,i)=>`findactor ${actorOffset+i}, "${name}"\n`).join(''),
    gate:waitForSignal?'label 1\ndetector_issignal -1, 2, -1\nwait 100\ngoto 1\nlabel 2\n':'',complete:signal(onComplete),failure:signal(onFailure)};
}
export function resolveMissionFlow(scene,flow,owner){
  if(flow==null)return null;
  const targets=new Map(missionFlowTargets(scene).map(actor=>[key(actor.name),actor.name])),result={...flow};
  for(const field of ['onComplete','onFailure'])if(result[field]!=null){const target=targets.get(key(result[field]));if(!target||key(target)===key(owner))throw new Error('Návaznost: vyberte jiný jednoznačný skriptový bod této mise.');result[field]=target;}
  return result;
}
