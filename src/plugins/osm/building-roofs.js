import clipping from 'polygon-clipping';
import {ShapeUtils,Vector2} from 'three';

export const osmRoofDefaults=Object.freeze({useOsmTags:true,shape:'gabled',height:3,orientation:'along'});
export const osmRoofLabels=Object.freeze({flat:'plochá',gabled:'sedlová',skillion:'pultová'});
const fail=message=>{throw Error(`OpenStreetMap · střechy: ${message}`);};
const dot=(p,axis)=>p[0]*axis[0]+p[1]*axis[1];
const length=value=>{const m=/^(\d+(?:\.\d+)?)(?: (m|ft))?$/.exec(value??'');return m?Number(m[1])*(m[2]==='ft'?.3048:1):null;};

export function validateOsmRoofOptions(options){
  if(options===undefined)return;
  if(!options||typeof options.useOsmTags!=='boolean'||!Object.hasOwn(osmRoofLabels,options.shape)||!Number.isFinite(options.height)||options.height<.5||options.height>15||!['along','across'].includes(options.orientation))fail('neplatný tvar, výška nebo orientace.');
}
// The smallest edge-aligned envelope gives a stable direction for reversed,
// shifted or subdivided rings. It is an estimate, not a roof-part reconstruction.
function envelopeAxis(ring){
  let best=null;
  for(let i=0;i<ring.length;i++){
    const a=ring[i],b=ring[(i+1)%ring.length],dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz);if(len<.001)continue;
    const axis=[dx/len,dz/len],cross=[-axis[1],axis[0]],ranges=[axis,cross].map(v=>{const values=ring.map(p=>dot(p,v));return Math.max(...values)-Math.min(...values);});
    let ridge=ranges[0]>=ranges[1]?axis:cross;if(ridge[0]<-1e-9||Math.abs(ridge[0])<1e-9&&ridge[1]<0)ridge=ridge.map(n=>-n);
    const candidate={area:ranges[0]*ranges[1],ridge,angle:Math.atan2(ridge[1],ridge[0])};
    if(!best||candidate.area<best.area-1e-6||Math.abs(candidate.area-best.area)<=1e-6&&candidate.angle<best.angle-1e-9)best=candidate;
  }
  if(!best)fail('půdorys nemá použitelný směr.');return [-best.ridge[1],best.ridge[0]];
}
function compass(value){
  if(value===undefined)return null;
  const names=['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  const index=names.indexOf(value),degrees=index>=0?index*22.5:/^(?:\d+(?:\.\d+)?)$/.test(value)?Number(value):NaN;
  if(!Number.isFinite(degrees)||degrees>360)return null;const angle=degrees*Math.PI/180;return [Math.sin(angle),Math.cos(angle)];
}
export function osmRoofPlan(tags,polygon,target,options){
  validateOsmRoofOptions(options);if(options===undefined)return null;
  const notes=[],use=options.useOsmTags;
  let shape=options.shape,shapeSource='ruční náhradní tvar';
  if(use&&tags['roof:shape']){
    if(Object.hasOwn(osmRoofLabels,tags['roof:shape'])){shape=tags['roof:shape'];shapeSource='OSM roof:shape';}
    else notes.push(`Nepodporované roof:shape=${tags['roof:shape']}; použit náhradní tvar ${osmRoofLabels[shape]}.`);
  }
  let axis=envelopeAxis(polygon[0]),directionSource='odhad: delší strana půdorysu';
  const direction=use?compass(tags['roof:direction']):null,orientation=use&&['along','across'].includes(tags['roof:orientation'])?tags['roof:orientation']:options.orientation;
  if(direction){axis=direction;directionSource='OSM roof:direction (směr spádu)';}
  else{
    if(orientation==='across')axis=[-axis[1],axis[0]];
    if(use&&tags['roof:direction'])notes.push('Neplatný roof:direction; směr střechy je odhad.');
    if(use&&tags['roof:orientation']&&!['along','across'].includes(tags['roof:orientation']))notes.push('Neplatný roof:orientation; použita náhradní orientace.');
    directionSource+=` · ${orientation==='along'?'podél':'napříč'}`;
  }
  const values=polygon[0].map(p=>dot(p,axis)),span=Math.max(...values)-Math.min(...values);if(span<.001)fail('příliš úzký půdorys.');
  let height=options.height,heightSource='ruční náhradní výška střechy';
  const metres=use?length(tags['roof:height']):null,angle=use&&/^\d+(?:\.\d+)?$/.test(tags['roof:angle']??'')?Number(tags['roof:angle']):null,levels=use&&/^[1-9]\d?$/.test(tags['roof:levels']??'')?Number(tags['roof:levels']):null;
  if(shape==='flat'){height=0;heightSource='plochá střecha';}
  else if(metres!==null&&metres>0&&metres<=60){height=metres;heightSource='OSM roof:height';}
  else if(angle!==null&&angle>0&&angle<=75){height=(shape==='gabled'?span/2:span)*Math.tan(angle*Math.PI/180);heightSource='odhad: OSM roof:angle a šířka půdorysu';}
  else if(levels){height=levels*3;heightSource='odhad: OSM roof:levels × 3 m';}
  for(const [key,valid]of [['roof:height',metres!==null&&metres>0&&metres<=60],['roof:angle',angle!==null&&angle>0&&angle<=75],['roof:levels',levels!==null]])if(shape!=='flat'&&use&&tags[key]&&!valid)notes.push(`Neplatné ${key}; použit další dostupný odhad.`);
  const fromLevels=target.heightSource!=='OSM height'&&/^[1-9]\d?$/.test(tags['building:levels']??'');
  const limited=Math.min(height,30,fromLevels?Infinity:Math.max(0,target.height-3));if(limited!==height){height=limited;notes.push('Výška střechy omezena: nejvýše 30 m a alespoň 3 m fasády.');}
  if(height<.05){shape='flat';height=0;}
  const total=fromLevels?{height:Number(tags['building:levels'])*3+height,heightSource:'odhad: OSM building:levels × 3 m + výška střechy',estimated:true}:{...target};
  if(shape!=='flat')notes.push('Jeden směr střechy pro celý půdorys; členité střechy, vikýře a přesahy se nerekonstruují.');
  return {...total,roof:shape,roofPlan:{shape,height,axis,shapeSource,heightSource,directionSource},notes};
}

// Roof triangles are split at the ridge before triangulation. Thus no triangle
// can bridge two slopes, fill a courtyard, or disagree with the native KLZ.
export function osmRaisedRoof(rings,plan,top,style,triangle){
  if(!plan||!['gabled','skillion'].includes(plan.shape)||!Number.isFinite(plan.height)||plan.height<=0||plan.height>30||top-plan.height<3-1e-5||!Array.isArray(plan.axis)||plan.axis.length!==2||plan.axis.some(n=>!Number.isFinite(n))||Math.abs(Math.hypot(...plan.axis)-1)>1e-6)fail('neplatná geometrie střechy.');
  const axis=plan.axis,ridge=[axis[1],-axis[0]],values=rings[0].map(p=>dot(p,axis)),min=Math.min(...values),max=Math.max(...values),mid=(min+max)/2,span=max-min,eaves=Math.fround(top-plan.height),h=top-eaves;
  if(span<.001)fail('příliš úzká střecha.');
  const at=p=>Math.fround(eaves+h*(plan.shape==='gabled'?1-Math.abs((dot(p,axis)-mid)/(span/2)):(max-dot(p,axis))/span));
  const point=(u,v)=>[ridge[0]*u+axis[0]*v,ridge[1]*u+axis[1]*v];
  const parts=plan.shape==='gabled'?[...clipping.intersection(rings,[[point(-2000,min-1),point(2000,min-1),point(2000,mid),point(-2000,mid)]]),...clipping.intersection(rings,[[point(-2000,mid),point(2000,mid),point(2000,max+1),point(-2000,max+1)]])]:[rings];
  for(const polygon of parts){
    const vectors=polygon.map(r=>r.map(p=>new Vector2(...p)));
    // Clipping returns closed rings, ShapeUtils removes their closing point.
    for(const r of vectors)if(r[0].equals(r.at(-1)))r.pop();
    const flat=vectors.flat(),faces=ShapeUtils.triangulateShape(vectors[0],vectors.slice(1));
    for(const ids of faces){let p=ids.map(i=>[flat[i].x,flat[i].y]);if((p[1][0]-p[0][0])*(p[2][1]-p[0][1])-(p[1][1]-p[0][1])*(p[2][0]-p[0][0])>0)p=[p[0],p[2],p[1]];
      const slope=h/(span/(plan.shape==='gabled'?2:1)),scale=Math.hypot(1,slope);
      triangle(p.map(p=>[p[0],at(p),p[1]]),p.map(p=>[dot(p,ridge)/4,(dot(p,axis)-min)*scale/4]),3);
    }
  }
  for(const ring of rings)for(let i=0;i<ring.length;i++){
    const a=ring[i],b=ring[(i+1)%ring.length],va=dot(a,axis)-mid,vb=dot(b,axis)-mid,cut=plan.shape==='gabled'&&va*vb<-1e-10?-va/(vb-va):null;
    const points=cut===null?[a,b]:[a,a.map((n,k)=>n+(b[k]-n)*cut),b];let distance=0;
    for(let j=1;j<points.length;j++){
      const p=points[j-1],q=points[j],pa=at(p),pb=at(q),end=distance+Math.hypot(q[0]-p[0],q[1]-p[1]);
      const xyz=[[p[0],eaves,p[1]],[p[0],pa,p[1]],[q[0],eaves,q[1]],[q[0],pb,q[1]]],uv=[[distance/style.width,0],[distance/style.width,-(pa-eaves)/style.upperHeight],[end/style.width,0],[end/style.width,-(pb-eaves)/style.upperHeight]];
      if(pa-eaves>1e-5)triangle([xyz[0],xyz[1],xyz[2]],[uv[0],uv[1],uv[2]],2);
      if(pb-eaves>1e-5)triangle([xyz[2],xyz[1],xyz[3]],[uv[2],uv[1],uv[3]],2);
      distance=end;
    }
  }
}
