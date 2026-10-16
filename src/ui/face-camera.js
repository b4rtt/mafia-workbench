// One in-flight bitmap. Late grants are stopped even after the dialog closes.
export class FaceCamera {
  constructor({video,permission,onResult,onState,makeWorker=()=>new Worker(new URL('./face-worker.js',location.href)),getMedia=constraints=>navigator.mediaDevices.getUserMedia(constraints),bitmap=source=>createImageBitmap(source),requestFrame=callback=>requestAnimationFrame(callback),cancelFrame=id=>cancelAnimationFrame(id),now=()=>performance.now()}) {
    Object.assign(this,{video,permission,onResult,onState,makeWorker,getMedia,bitmap,requestFrame,cancelFrame,now});this.generation=0;this.running=false;
  }
  async start(){
    if(this.running)return;
    const token=++this.generation;this.running=true;this.onState('loading');
    try{
      const worker=this.makeWorker();this.worker=worker;
      await new Promise((resolve,reject)=>{
        this.rejectInit=reject;this.timer=setTimeout(()=>reject(Error('Příprava detektoru překročila časový limit.')),30000);
        worker.onerror=()=>reject(Error('Detektor nelze načíst. Spusťte npm run setup:face a znovu sestavte editor.'));
        worker.onmessage=({data})=>{if(data.type==='ready')resolve();else if(data.type==='error')reject(Error(data.message));};worker.postMessage({type:'init'});
      });
      clearTimeout(this.timer);this.rejectInit=null;if(token!==this.generation)return;
      await this.permission(true);if(token!==this.generation)return;
      const stream=await this.getMedia({audio:false,video:{width:{ideal:640},height:{ideal:480},frameRate:{ideal:25,max:30},facingMode:'user'}});
      if(token!==this.generation){stream.getTracks().forEach(track=>track.stop());return;}
      this.stream=stream;this.video.srcObject=stream;await this.video.play();if(token!==this.generation)return;
      await this.permission(false);if(token!==this.generation)return;this.lastSent=-Infinity;this.waiting=false;this.lastVideo=-1;
      worker.onmessage=({data})=>{if(token!==this.generation)return;this.waiting=false;clearTimeout(this.watchdog);if(data.type==='error'){this.fail(Error(data.message));return;}if(data.type==='result')this.onResult(data);};
      worker.onerror=()=>this.fail(Error('Detektor mimiky skončil chybou.'));
      for(const track of stream.getTracks())track.onended=()=>this.fail(Error('Kamera byla odpojena.'));
      this.onState('live');
      const tick=async()=>{
        if(token!==this.generation)return;
        this.frame=this.requestFrame(tick);
        const time=this.now();if(this.waiting||time-this.lastSent<40||this.video.readyState<2||this.lastVideo===this.video.currentTime)return;
        this.waiting=true;this.lastSent=time;this.lastVideo=this.video.currentTime;
        let bitmap;
        try{bitmap=await this.bitmap(this.video);if(token!==this.generation){bitmap.close();return;}this.watchdog=setTimeout(()=>this.fail(Error('Detektor přestal odpovídat.')),10000);worker.postMessage({type:'frame',bitmap,time},[bitmap]);bitmap=null;}catch(error){bitmap?.close();if(token===this.generation)this.fail(error);}
      };this.frame=this.requestFrame(tick);
    }catch(error){if(token===this.generation)this.fail(error);}
  }
  fail(error){this.stop();this.onState('error',error.message);}
  stop(){
    this.generation++;this.running=false;clearTimeout(this.timer);clearTimeout(this.watchdog);this.rejectInit?.(Error('Zastaveno.'));this.rejectInit=null;
    if(this.frame!==undefined)this.cancelFrame(this.frame);this.worker?.terminate();this.worker=null;
    this.stream?.getTracks().forEach(track=>{track.onended=null;track.stop();});this.stream=null;this.video.pause();this.video.srcObject=null;
    Promise.resolve(this.permission(false)).catch(()=>{});this.onState('off');
  }
}
