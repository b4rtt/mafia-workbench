import { dialogueSoundPath, prepareDialogueWav } from './dialogue-audio.js';

export const lipStep = 40;
const limit = 90000, neutral = [0,117,135,28,255,153];
const fail = message => { throw Error(`Pohyb úst: ${message}`); };
export function dialogueLipPath(id) { return dialogueSoundPath(id).replace(/^sounds\//,'tables/dat/').replace(/\.wav$/,'.dat'); }
export function parseLip(source) {
  if(source.length<24||source.readUInt32LE(4)!==1)fail('nepodporovaná verze tabulky.');
  const count=source.readUInt32LE(0);
  if(count<2||count>limit||source.length!==8+count*8)fail('neplatný počet nebo délka záznamů.');
  return {step:lipStep,duration:count*lipStep,frames:Array.from({length:count},(_,sourceIndex)=>({sourceIndex,values:Array.from(source.subarray(8+sourceIndex*8,14+sourceIndex*8))}))};
}
function validate(frames, original) {
  if(!Array.isArray(frames)||frames.length<2||frames.length>limit)fail('tabulka musí mít 2–90 000 záznamů.');
  for(const frame of frames){
    if(!frame||Object.keys(frame).length!==2||!Object.hasOwn(frame,'sourceIndex')||!Object.hasOwn(frame,'values')||frame.sourceIndex!==null&&(!Number.isInteger(frame.sourceIndex)||frame.sourceIndex<0||frame.sourceIndex>=original)||!Array.isArray(frame.values)||frame.values.length!==6||frame.values.some(v=>!Number.isInteger(v)||v<0||v>255))fail('neplatný záznam; šest parametrů musí být celá čísla 0–255.');
  }
}
export function editLip(source, frames) {
  const original=parseLip(source);validate(frames,original.frames.length);
  const result=Buffer.alloc(8+frames.length*8);source.copy(result,0,0,8);result.writeUInt32LE(frames.length,0);
  frames.forEach((frame,i)=>{const at=8+i*8;if(frame.sourceIndex!==null)source.copy(result,at,8+frame.sourceIndex*8,16+frame.sourceIndex*8);else result.fill(1,at+6,at+8);frame.values.forEach((v,j)=>result[at+j]=v);});
  return result;
}
export function createLip(frames) {
  validate(frames,0);const empty=Buffer.alloc(24);empty.writeUInt32LE(2);empty.writeUInt32LE(1,4);empty.fill(1,14,16);empty.fill(1,22,24);return editLip(empty,frames);
}
// This is an explicit amplitude estimate, not phoneme recognition. Two neutral
// tail records accommodate the engine's count-2 clamp and release sample.
export function lipFromVoice(source) {
  const {bytes,info}=prepareDialogueWav(source),count=Math.ceil(info.duration*1000/lipStep)+2;
  if(count>limit)fail('nahrávka je delší než podporovaná tabulka.');
  const frames=Array.from({length:count},()=>({sourceIndex:null,values:[...neutral]}));
  for(let i=0;i<count-2;i++){
    const start=Math.floor(i*lipStep*info.sampleRate/1000),end=Math.min(info.samples,Math.floor((i+1)*lipStep*info.sampleRate/1000));let power=0;
    for(let j=start;j<end;j++){const sample=bytes.readInt16LE(44+j*2)/32768;power+=sample*sample;}
    const rms=end>start?Math.sqrt(power/(end-start)):0;frames[i].values[0]=rms<.01?0:Math.round(Math.min(1,rms*2.5)*255);
  }
  return {frames,duration:info.duration};
}
