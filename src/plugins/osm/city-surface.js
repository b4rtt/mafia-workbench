import {osmSurfaceModel} from './surface.js';
import {osmTerrainSurface} from './terrain.js';
import {osmSpatialModel,validateOsmSpatial} from './spatial.js';

// Apply spatial cuts only after the shared terrain and all street layers are
// final. Footprints and native driving/pedestrian topology remain unchanged.
export function osmCitySurface(plan,area,options,elevation=null){
  if(options?.partition!==undefined)validateOsmSpatial(options.partition);
  const result=elevation?osmTerrainSurface(plan,area,options,elevation):osmSurfaceModel(plan,area,options);
  if(options.partition===undefined)return result;
  const {model,spatial}=osmSpatialModel(result.model,options.partition),counts=result.counts?{road:0,sidewalk:0,curb:0,ground:0,vertices:spatial.vertices}:null;
  if(counts)for(const mesh of model.meshes)for(const face of mesh.lods[0].faces)counts[['road','sidewalk','curb','ground'][face.material-1]]+=face.indices.length/3;
  return {...result,model,triangles:spatial.triangles,spatial,...(counts?{counts}:{})};
}
