import * as THREE from 'three';
import {createSoundExtent} from './sound-extent.js';

export function lightPreviewSettings(file, object, drafts=new Map()) {
  if(object?.frameType!==2)return null;
  const types=file.entries.filter(e=>e.id.startsWith(object.id+'/')&&e.label==='Typ světla');
  const unavailable=reason=>({mode:null,reason});
  if(types.length!==1)return unavailable('Světlo nemá jednoznačné nastavení.');
  const prefix=types[0].id.slice(0,types[0].id.lastIndexOf('/')+1);
  function read(label){const entries=file.entries.filter(e=>e.id.startsWith(prefix)&&e.label===label);return entries.length===1?(drafts.has(entries[0].id)?drafts.get(entries[0].id):entries[0].value):undefined;}
  const type=read('Typ světla'),color=read('Barva RGB'),power=read('Síla světla'),range=read('Dosah světla'),cone=read('Světelný kužel');
  const finite=n=>typeof n==='number'&&Number.isFinite(n)&&Number.isFinite(Math.fround(n)),vector=(v,n)=>Array.isArray(v)&&v.length===n&&Array.from(v).every(finite);
  if(![1,2,3,4].includes(type))return unavailable('Náhled mlhy a bodového okolního světla zatím není podporovaný.');
  if(!vector(color,3)||color.some(n=>n<0||n>1)||!finite(power)||power<0)return unavailable('Barva nebo síla světla je neplatná či neúplná.');
  if([1,2].includes(type)&&(!vector(range,2)||range[0]<0||range[1]<=range[0]))return unavailable('Dosah světla je neplatný či neúplný.');
  if(type===2&&(!vector(cone,2)||cone[0]<0||cone[1]<=0||cone[0]>cone[1]||cone[1]>Math.PI+1e-5))return unavailable('Kužel světla je neplatný či neúplný.');
  return {mode:['','sphere','cone','direction','ambient'][type],type,color:[...color],power,range:range?.slice(),cone:cone?.map(n=>Math.min(n,Math.PI)),reason:'Náhled vybraného světla: barva, síla, směr a hranice dosahu/kuželu. Osvětlení je orientační; sektory, režim, stíny a útlum enginu se nesimulují. Modrá hranice: začátek přechodu, oranžová: konec.'};
}

export function createLightPreview(settings) {
  const group=new THREE.Group();group.name='Light preview';
  if(settings.mode==='sphere'||settings.mode==='cone')group.add(createSoundExtent(settings));
  const color=new THREE.Color(...settings.color);let light;
  if(settings.type===1)light=new THREE.PointLight(color,settings.power,settings.range[1],0);
  else if(settings.type===2){
    light=new THREE.SpotLight(color,settings.power,settings.range[1],settings.cone[1]/2,1-settings.cone[0]/settings.cone[1],0);
    const target=new THREE.Object3D();target.position.z=1;group.add(target);light.target=target;
  }else if(settings.type===3){
    light=new THREE.DirectionalLight(color,settings.power);const target=new THREE.Object3D();target.position.z=1;group.add(target);light.target=target;
    group.add(new THREE.ArrowHelper(new THREE.Vector3(0,0,1),new THREE.Vector3(),3,0xffd76a,.4,.2));
  }else light=new THREE.AmbientLight(color,settings.power);
  light.position.set(0,0,0);group.add(light);return group;
}
