// Authoring format: coefficients only, never camera pixels or audio.
export const faceNeutral = Object.freeze([0,117,135,28,255,153]);
export const faceCaptureLimit = 600000;
const clamp = (n, low=0, high=1) => Math.max(low,Math.min(high,n));
const fail = message => { throw Error(`Mimika: ${message}`); };
export function faceScores(categories) {
  if(!Array.isArray(categories)||categories.length>64)return null;
  const scores={};
  for(const {categoryName,score} of categories){if(!/^[a-zA-Z_][a-zA-Z0-9_]{0,47}$/.test(categoryName)||Object.hasOwn(scores,categoryName)||!Number.isFinite(score)||score<0||score>1)return null;Object.defineProperty(scores,categoryName,{value:score,enumerable:true});}
  return Object.keys(scores).length?scores:null;
}
export function mapFace(scores, calibration={}, gain=1) {
  if(!scores)return [...faceNeutral];
  const get=name=>clamp(((scores[name]??0)-(calibration[name]??0))*gain),pair=name=>(get(name+'Left')+get(name+'Right'))/2;
  // Three engine regions: mouth, eyelids and brows. Shared eyelids/brows cannot
  // reproduce asymmetric blinks, gaze, tongue, cheeks or head motion.
  const open=get('jawOpen'),round=Math.max(get('mouthPucker'),get('mouthFunnel')),smile=pair('mouthSmile'),frown=pair('mouthFrown');
  return [255*open,117+(smile-round)*138,135+(frown-smile)*120,28+227*pair('eyeBlink'),255,153+102*pair('browDown')-153*Math.max(get('browInnerUp'),pair('browOuterUp'))].map(n=>Math.round(clamp(n,0,255)));
}
export function smoothFace(previous,next,elapsed,ms) {
  if(!previous||ms<=0)return [...next];
  const amount=1-Math.exp(-Math.max(0,elapsed)/ms);
  return next.map((n,i)=>Math.round(previous[i]+(n-previous[i])*amount));
}
export function validateFaceCapture(value) {
  if(!value||value.format!=='mafia-workbench-face'||value.version!==1||value.mapping!=='ls3d-three-region-v1')fail('nepodporovaný formát záznamu.');
  if(typeof value.model!=='string'||value.model.length>240||!/^models\/[^\r\n]+\.4ds$/i.test(value.model)||value.model.includes('..')||value.model.includes('\\'))fail('neplatný model.');
  if(!Number.isFinite(value.duration)||value.duration<40||value.duration>faceCaptureLimit)fail('délka musí být 40 ms až 10 minut.');
  const settings=value.settings;
  if(!settings||!Number.isFinite(settings.gain)||settings.gain<.25||settings.gain>3||!Number.isFinite(settings.smoothing)||settings.smoothing<0||settings.smoothing>250)fail('neplatné nastavení převodu.');
  function scoresValid(scores){return scores&&typeof scores==='object'&&!Array.isArray(scores)&&Object.keys(scores).length<=64&&Object.entries(scores).every(([k,n])=>/^[a-zA-Z_][a-zA-Z0-9_]{0,47}$/.test(k)&&Number.isFinite(n)&&n>=0&&n<=1);}
  if(!scoresValid(value.calibration))fail('neplatná kalibrace.');
  if(!Array.isArray(value.samples)||!value.samples.length||value.samples.length>15001)fail('neplatný počet vzorků.');
  let previous=-1;
  for(const sample of value.samples){if(!sample||!Number.isFinite(sample.time)||sample.time<=previous||sample.time<0||sample.time>value.duration||sample.time>0&&sample.time-previous<10||sample.scores!==null&&!scoresValid(sample.scores)||!Array.isArray(sample.values)||sample.values.length!==6||sample.values.some(n=>!Number.isInteger(n)||n<0||n>255))fail('neplatný vzorek.');previous=sample.time;}
  if(value.samples[0].time!==0)fail('chybí počátek záznamu.');
  // Rebuild the allowed shape: imported files cannot retain extra payloads.
  return {format:value.format,version:1,mapping:value.mapping,model:value.model,duration:value.duration,settings:{gain:settings.gain,smoothing:settings.smoothing},calibration:{...value.calibration},samples:value.samples.map(s=>({time:s.time,scores:s.scores===null?null:{...s.scores},values:[...s.values]}))};
}
export function sampleFace(capture,time) {
  const rows=capture.samples;let low=0,high=rows.length;
  while(low<high){const middle=(low+high)>>1;if(rows[middle].time<=time)low=middle+1;else high=middle;}
  const row=rows[low-1];return row&&row.scores!==null&&time-row.time<=200?[...row.values]:[...faceNeutral];
}
export function faceToLip(source,start=0,end=source.duration) {
  const capture=validateFaceCapture(source);
  if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end>capture.duration||end-start<40)fail('vyberte úsek dlouhý alespoň 40 ms.');
  const frames=Array.from({length:Math.ceil((end-start)/40)},(_,i)=>({sourceIndex:null,values:sampleFace(capture,start+i*40)}));
  frames.push(...Array.from({length:2},()=>({sourceIndex:null,values:[...faceNeutral]})));return frames;
}
