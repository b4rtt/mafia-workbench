import test from 'node:test';
import assert from 'node:assert/strict';
import { FaceCamera } from '../src/ui/face-camera.js';
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function setup(options={}){
  const events=[],sent=[],tracks=[{stopped:0,stop(){this.stopped++;}}],stream={getTracks:()=>tracks},video={readyState:2,currentTime:1,srcObject:null,play:async()=>{},pause(){}},worker={postMessage(data){sent.push(data);},terminate(){this.terminated=true;}},requests=new Map();let next=0,time=100;
  const c=new FaceCamera({video,permission:async value=>events.push(['permission',value]),onResult:data=>events.push(['result',data]),onState:(state,error)=>events.push([state,error]),makeWorker:()=>worker,getMedia:async constraints=>{assert.equal(constraints.audio,false);return stream;},bitmap:async()=>({close(){this.closed=true;}}),requestFrame:fn=>{requests.set(++next,fn);return next;},cancelFrame:id=>requests.delete(id),now:()=>time,...options});
  async function ready(){const p=c.start();worker.onmessage({data:{type:'ready'}});await p;}
  async function tick(){const [id,fn]=requests.entries().next().value;requests.delete(id);time+=40;video.currentTime+=.04;await fn();}
  return{c,events,sent,tracks,stream,video,worker,requests,ready,tick};
}
test('camera initialization precedes media access and limits inference to one transferred bitmap',async()=>{
  const x=setup();await x.ready();assert.equal(x.video.srcObject,x.stream);assert.deepEqual(x.events.slice(0,4).map(e=>e[0]),['loading','permission','permission','live']);
  await x.tick();await x.tick();assert.equal(x.sent.filter(e=>e.type==='frame').length,1);x.worker.onmessage({data:{type:'result',categories:null,time:140}});await x.tick();assert.equal(x.sent.filter(e=>e.type==='frame').length,2);
  x.c.stop();assert.equal(x.video.srcObject,null);assert.equal(x.tracks[0].stopped,1);assert(x.worker.terminated);assert.equal(x.requests.size,0);assert.equal(x.events.at(-2)[0],'permission');
});
test('closing while OS permission is pending stops the late stream and cannot resurrect capture',async()=>{
  let grant;const x=setup({getMedia:()=>new Promise(resolve=>{grant=resolve;})}),p=x.c.start();x.worker.onmessage({data:{type:'ready'}});await flush();x.c.stop();grant(x.stream);await p;assert.equal(x.tracks[0].stopped,1);assert.equal(x.video.srcObject,null);assert(!x.c.running);assert(!x.events.some(e=>e[0]==='live'));
});
test('closing during worker initialization settles the promise without requesting the camera',async()=>{
  let media=0;const x=setup({getMedia:()=>{media++;}}),p=x.c.start();x.c.stop();await p;assert.equal(media,0);assert(x.worker.terminated);assert(!x.c.running);
});
test('stop while the permission grant is being revoked cannot restore the live state',async()=>{
  let revoke;const x=setup({permission:value=>value?Promise.resolve():new Promise(resolve=>{revoke=resolve;})}),p=x.c.start();x.worker.onmessage({data:{type:'ready'}});await flush();const pending=revoke;x.c.stop();pending();await p;revoke();assert(!x.events.some(e=>e[0]==='live'));assert.equal(x.tracks[0].stopped,1);assert.equal(x.video.srcObject,null);assert(!x.c.running);
});
test('denied camera and failed detector revoke grants, terminate workers and report an actionable state',async()=>{
  const denied=setup({getMedia:async()=>{throw Error('Permission denied');}});await denied.ready();assert(!denied.c.running);assert(denied.worker.terminated);assert.equal(denied.events.at(-1)[0],'error');assert.match(denied.events.at(-1)[1],/Permission denied/);
  const x=setup(),p=x.c.start();x.worker.onmessage({data:{type:'error',message:'Missing model'}});await p;assert(!x.c.running);assert(x.worker.terminated);assert.match(x.events.at(-1)[1],/Missing model/);
});
test('camera disconnect stops every owned track and no pending bitmap is sent after close',async()=>{
  let complete;const x=setup({bitmap:()=>new Promise(resolve=>{complete=resolve;})});await x.ready();const pending=x.tick();x.tracks[0].onended();const bitmap={closed:false,close(){this.closed=true;}};complete(bitmap);await pending;assert(bitmap.closed);assert.equal(x.sent.filter(e=>e.type==='frame').length,0);assert.equal(x.tracks[0].stopped,1);assert(!x.c.running);
});
