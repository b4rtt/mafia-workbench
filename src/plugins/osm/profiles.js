// Side names follow the original OSM way direction, including oneway=-1.
export const osmProfileDefaults=Object.freeze({useOsmTags:false,estimateLanes:false,laneWidth:3,sidewalks:'both'});
function metres(value){
  if(typeof value!=='string')return null;
  let match=/^(\d+(?:\.\d+)?)(?: (m|cm|km|ft|in))?$/.exec(value);
  if(match)return Number(match[1])*({m:1,cm:.01,km:1000,ft:.3048,in:.0254}[match[2]??'m']);
  match=/^(\d+)'(?:(\d+(?:\.\d+)?)")?$/.exec(value);
  return match&&Number(match[2]??0)<12?Number(match[1])*.3048+Number(match[2]??0)*.0254:null;
}
export function osmRoadProfile(tags={},options){
  const settings={...osmProfileDefaults,...options};
  if(typeof settings.useOsmTags!=='boolean'||typeof settings.estimateLanes!=='boolean'||!['both','left','right','none'].includes(settings.sidewalks)||[['laneWidth',2,4.5],['width',2,20],['sidewalkWidth',.5,5]].some(([key,min,max])=>typeof settings[key]!=='number'||!Number.isFinite(settings[key])||settings[key]<min||settings[key]>max))throw Error('OpenStreetMap · povrchy: neplatné nastavení profilu.');
  const notes=[],profile={width:settings.width,widthSource:'ruční náhradní rozměr',estimated:false,left:['both','left'].includes(settings.sidewalks)?settings.sidewalkWidth:0,right:['both','right'].includes(settings.sidewalks)?settings.sidewalkWidth:0,leftSource:'ruční náhradní profil',rightSource:'ruční náhradní profil',notes};
  if(!settings.useOsmTags)return profile;
  function dimension(keys,min,max){
    for(const key of keys)if(tags[key]!==undefined){const value=metres(tags[key]);if(value!==null&&value>=min&&value<=max)return {value,key};notes.push(`${key}=${tags[key]} nelze použít (${min}–${max} m).`);}
    return null;
  }
  const width=dimension(['width','width:carriageway','est_width'],2,20);
  if(width){profile.width=width.value;profile.widthSource=`OSM ${width.key}`;profile.estimated=width.key==='est_width';}
  else if(settings.estimateLanes&&tags.lanes!==undefined){
    const lanes=/^[1-8]$/.test(tags.lanes)?Number(tags.lanes):null,value=lanes*settings.laneWidth;
    if(lanes&&value>=2&&value<=20){profile.width=value;profile.widthSource=`odhad: ${lanes} pruhů × ${settings.laneWidth} m`;profile.estimated=true;notes.push('Odhad z pruhů nezahrnuje parkovací a cyklistické pásy.');}
    else notes.push(`lanes=${tags.lanes} nelze použít k odhadu šířky.`);
  }
  function presence(key,sides){
    const value=tags[key];if(value===undefined)return;
    if(['yes','no','none'].includes(value)&&!(key==='sidewalk'&&value==='yes'))for(const side of sides){profile[side]=value==='yes'?settings.sidewalkWidth:0;profile[side+'Source']=`OSM ${key}=${value}${profile[side]?'; šířka ručně':''}`;}
    else if(key==='sidewalk'&&['both','left','right'].includes(value))for(const side of sides){profile[side]=value==='both'||side===value?settings.sidewalkWidth:0;profile[side+'Source']=`OSM ${key}=${value}${profile[side]?'; šířka ručně':''}`;}
    else if(value==='separate'){for(const side of sides){profile[side]=settings.sidewalks==='both'||settings.sidewalks===side?settings.sidewalkWidth:0;profile[side+'Source']=`ruční náhradní profil (${key}=separate)`;}notes.push(`${key}=separate: samostatná pěší geometrie není importovaná; použit náhradní profil.`);}
    else notes.push(`${key}=${value}: strany chodníku nelze určit; použit předchozí nebo náhradní profil.`);
  }
  presence('sidewalk',['left','right']);presence('sidewalk:both',['left','right']);presence('sidewalk:left',['left']);presence('sidewalk:right',['right']);
  for(const side of ['left','right'])if(profile[side]){const width=dimension([`sidewalk:${side}:width`,'sidewalk:both:width'],.5,5);if(width){profile[side]=width.value;profile[side+'Source']=profile[side+'Source'].replace('; šířka ručně','')+`; OSM ${width.key}`;}}
  return profile;
}
