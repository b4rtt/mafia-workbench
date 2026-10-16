import {hash} from '../../core/files.js';

// Keep the source bytes intact. Only ordinary mono PCM8/16 is accepted for
// native point emitters; compressed/stereo clips need explicit preparation.
export function inspectOsmAmbientWav(b){
  const fail=()=>{throw Error('OpenStreetMap · zvuky: vyberte úplný mono WAV PCM 8/16 bit, 8–48 kHz, nejvýše 16 MiB.');};
  if(b.length<44||b.length>16*1024*1024||b.toString('ascii',0,4)!=='RIFF'||b.toString('ascii',8,12)!=='WAVE'||b.readUInt32LE(4)+8!==b.length)fail();let fmt,data;
  for(let at=12;at<b.length;){if(at+8>b.length)fail();const n=b.readUInt32LE(at+4),end=at+8+n,next=end+n%2;if(next>b.length)fail();const id=b.toString('ascii',at,at+4);if(id==='fmt '){if(fmt)fail();fmt=b.subarray(at+8,end);}if(id==='data'){if(data)fail();data=b.subarray(at+8,end);}at=next;}
  if(!fmt||fmt.length<16||!data?.length)fail();const rate=fmt.readUInt32LE(4),bits=fmt.readUInt16LE(14),align=bits/8;
  if(fmt.readUInt16LE(0)!==1||fmt.readUInt16LE(2)!==1||![8,16].includes(bits)||rate<8000||rate>48000||fmt.readUInt16LE(12)!==align||fmt.readUInt32LE(8)!==rate*align||data.length%align||fmt.length!==16&&(fmt.length<18||fmt.length<18+fmt.readUInt16LE(16)))fail();
  return {duration:data.length/(rate*align),sampleRate:rate,bits};
}
export async function loadOsmAmbientSounds(project,sounds){
  if(!Array.isArray(sounds)||!sounds.length||sounds.length>2)throw Error('OpenStreetMap · zvuky: vyberte 1–2 nahrávky.');
  const result=[];for(const item of sounds){const path=typeof item==='string'?item:item?.path;if(typeof path!=='string'||!/^sounds\/.+\.wav$/i.test(path))throw Error('OpenStreetMap · zvuky: vyberte WAV ze složky sounds.');const asset=project.asset(path),bytes=await project.read(asset.path),info=inspectOsmAmbientWav(bytes),sha256=hash(bytes);if(typeof item!=='string'&&item.sha256!==sha256)throw Error('OpenStreetMap · zvuky: nahrávka se změnila; ověřte ji znovu.');result.push({path:asset.path,sha256,...info});}return result;
}
