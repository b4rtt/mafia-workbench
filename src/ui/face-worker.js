import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
let detector;
self.onmessage=async({data})=>{
  try{
    if(data.type==='init'){
      const vision=await FilesetResolver.forVisionTasks(new URL('./face-runtime',self.location.href).href);
      detector=await FaceLandmarker.createFromOptions(vision,{baseOptions:{modelAssetPath:new URL('./face-runtime/face_landmarker.task',self.location.href).href,delegate:'CPU'},runningMode:'VIDEO',numFaces:1,outputFaceBlendshapes:true});
      self.postMessage({type:'ready'});
    }else if(data.type==='frame'){
      try{const result=detector.detectForVideo(data.bitmap,data.time);self.postMessage({type:'result',time:data.time,categories:result.faceBlendshapes[0]?.categories??null});}finally{data.bitmap.close();}
    }
  }catch(error){self.postMessage({type:'error',message:error.message??String(error)});}
};
