import { validMissionDestination } from '../shared/mission-destinations.js';
import { dialogueSpeakers } from '../shared/mission-dialogue.js';
import { inspectScene } from './scene.js';
import { parseFourDs } from './fourds.js';
import { parseCollision } from './collision.js';
import { hash } from './files.js';

export async function inspectMissionDestination(project,name){
  if(!validMissionDestination(name))throw new Error('Další mise: neplatný název složky.');
  const files=[];
  for(const filename of ['scene2.bin','scene.4ds','tree.klz']){
    const asset=project.asset(`missions/${name}/${filename}`),data=await project.read(asset.path);
    files.push({path:asset.path,data,expectedHash:hash(data)});
  }
  const scene=inspectScene(files[0].data),geometry=parseFourDs(files[1].data,true);parseCollision(files[2].data);
  const players=dialogueSpeakers({...scene,geometry}).filter(actor=>actor.kind===2&&actor.name.normalize('NFC').toLowerCase()==='tommy');
  if(players.length!==1)throw new Error('Další mise: potřebuje jednoznačného hráče Tommy a jeho frame.');
  const canonical=/^missions\/([^/]+)\//i.exec(files[0].path)[1];
  return {name:canonical,hashes:Object.fromEntries(files.map(file=>[file.path,file.expectedHash])),files};
}
