import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
export const faceModelHash='64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff';
const target=new URL('../local/face-runtime/face_landmarker.task',import.meta.url);
export async function prepareFace(download=false){
  let bytes=await fs.readFile(target).catch(()=>null);
  if(bytes&&createHash('sha256').update(bytes).digest('hex')!==faceModelHash){if(download)bytes=null;else throw Error('Model mimiky: nesouhlasí SHA-256. Spusťte npm run setup:face pro opětovnou přípravu.');}
  if(!bytes&&download){const response=await fetch('https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',{signal:AbortSignal.timeout(60000)});if(!response.ok)throw Error(`Model mimiky: HTTP ${response.status}`);bytes=Buffer.from(await response.arrayBuffer());}
  if(!bytes)return false;
  if(createHash('sha256').update(bytes).digest('hex')!==faceModelHash)throw Error('Model mimiky: nesouhlasí SHA-256. Spusťte npm run setup:face pro opětovnou přípravu.');
  await fs.mkdir(new URL('../out/face-runtime/',import.meta.url),{recursive:true});
  if(download){await fs.mkdir(new URL('../local/face-runtime/',import.meta.url),{recursive:true});await fs.writeFile(target,bytes);}
  await fs.writeFile(new URL('../out/face-runtime/face_landmarker.task',import.meta.url),bytes);
  for(const name of ['vision_wasm_internal.js','vision_wasm_internal.wasm','vision_wasm_nosimd_internal.js','vision_wasm_nosimd_internal.wasm'])await fs.copyFile(new URL('../node_modules/@mediapipe/tasks-vision/wasm/'+name,import.meta.url),new URL('../out/face-runtime/'+name,import.meta.url));
  return true;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){await prepareFace(true);console.log('Mimika: lokální model a WASM připraveny.');}
