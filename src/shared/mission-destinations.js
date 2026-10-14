const key=value=>value.normalize('NFC').toLowerCase();

// CHANGE_MISSION reserves 64 bytes for the native mission-folder argument.
export function validMissionDestination(name){
  return typeof name==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_ -]{0,62}$/.test(name)&&name===name.trim()&&!/^(?:wbtest|con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(name);
}
export function missionDestinations(assets,currentPath){
  const current=/^missions\/([^/]+)\//i.exec(currentPath)?.[1],paths=new Set(assets.map(asset=>key(asset.path)));
  return assets.flatMap(asset=>{
    const match=/^missions\/([^/]+)\/scene2\.bin$/i.exec(asset.path);if(!match)return [];
    const name=match[1],folder=`missions/${key(name)}/`;
    return validMissionDestination(name)&&key(name)!==key(current??'')&&['scene.4ds','tree.klz'].every(file=>paths.has(folder+file))?[name]:[];
  }).sort((a,b)=>a.localeCompare(b,'cs'));
}
