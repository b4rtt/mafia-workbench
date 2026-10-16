import {ShapeUtils,Vector2} from 'three';

const fail=m=>{throw Error('OpenStreetMap · zvuky: '+m);};
export const osmAmbientDefaults=Object.freeze({spacing:60,radius:50,volume:.25});
export function validateOsmAmbient(o){
  if(!o||o.version!==1||!o.streets&&!o.green)fail('zapněte alespoň zvuky ulic nebo zeleně.');
  for(const key of ['streets','green'])if(o[key]!==undefined&&o[key]!==null){
    const p=o[key];
    if(!p||typeof p!=='object'||!/^sounds\/(?:[^/]+\/)*[^/]+\.wav$/i.test(p.sound?.path??'')||/[\x00-\x1f\x7f\\:*?"<>|]/.test(p.sound.path)||p.sound.path.split('/').some(s=>!s||s==='.'||s==='..'||/[. ]$/.test(s))||p.sound.path.slice(7).length>255||!/^[a-f0-9]{64}$/.test(p.sound?.sha256??''))fail('vyberte a ověřte projektový WAV pro každou zapnutou vrstvu.');
    for(const[k,min,max]of [['spacing',20,150],['radius',10,150],['volume',.01,1]])if(typeof p[k]!=='number'||!Number.isFinite(p[k])||p[k]<min||p[k]>max)fail('rozestup je 20–150 m, dosah 10–150 m a hlasitost 0,01–1.');
  }
}
const inside=(ring,p)=>{let hit=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])hit=!hit;}return hit;};
const contains=(polygons,p)=>polygons.some(poly=>inside(poly[0],p)&&!poly.slice(1).some(r=>inside(r,p)));
function interior(polygon){
  const rings=polygon.map(r=>r.slice(0,-1).map(p=>new Vector2(...p))),vertices=rings.flat();let best=null,size=0;
  for(const t of ShapeUtils.triangulateShape(rings[0],rings.slice(1))){const[a,b,c]=t.map(i=>vertices[i]),area=Math.abs((b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x));if(area>size){size=area;best=[(a.x+b.x+c.x)/3,(a.y+b.y+c.y)/3];}}
  return best;
}
// Sound choice and acoustic dimensions are explicit creative settings, not OSM
// facts. Emitters stay separate native frames on the actual generated surfaces.
export function osmAmbientPlan(source,roads,surface,green,options){
  validateOsmAmbient(options);if(!surface)fail('nejdřív zapněte povrchy ulic.');
  if(options.green&&!green?.placements.length)fail('pro zvuky zeleně zapněte generování zelených ploch.');
  const placements=[],skipped=[],half=source.area.size/2,buildings=(source.buildings??[]).filter(b=>!b.suppressed&&!b.reason).flatMap(b=>b.polygons??[]);
  const add=(kind,id,p,height,polygons)=>{
    const o=options[kind],xz=p.map(Math.fround);
    if(xz.some(v=>Math.abs(v)>=half)||!contains(polygons,xz)||contains(buildings,xz)){skipped.push({kind,id,reason:'Bod mimo vytvořený povrch nebo uvnitř budovy.'});return;}
    if(placements.some(v=>v.kind===kind&&Math.hypot(v.position[0]-xz[0],v.position[2]-xz[1])<o.spacing*.7)){skipped.push({kind,id,reason:'Blízko jiného zvuku stejné vrstvy.'});return;}
    if(placements.length>=64)fail('plán přesahuje 64 zvuků; zvětšete rozestup nebo zmenšete oblast.');
    placements.push({name:`OSM_SOUND_${kind==='streets'?'STREET':'GREEN'}_${placements.filter(p=>p.kind===kind).length+1}`,kind,source:id,sound:{...o.sound},position:[xz[0],Math.fround(height+1.5),xz[1]],parameters:{file:o.sound.path.slice(7).replaceAll('/','\\'),type:1,volume:o.volume,outVolume:0,cone:[360,360],range:[o.radius*.2,o.radius,1,0],loop:true,sectors:['Primary sector']}});
  };
  if(options.streets){
    const height=surface.model.meshes.reduce((h,m)=>m.lods[0].faces.filter(f=>f.material===1).reduce((h,f)=>f.indices.reduce((h,i)=>Math.max(h,m.lods[0].positions[i*3+1]),h),h),-Infinity);
    for(const road of roads.roads){const chain=[roads.crossings[road.from].position,...road.positions,roads.crossings[road.to].position],lengths=chain.slice(1).map((p,i)=>Math.hypot(p[0]-chain[i][0],p[2]-chain[i][2])),length=lengths.reduce((s,n)=>s+n,0),count=Math.max(1,Math.ceil(length/options.streets.spacing));let segment=0,start=0;
      for(let i=0;i<count;i++){const distance=(i+.5)*length/count;while(segment<lengths.length-1&&start+lengths[segment]<distance)start+=lengths[segment++];const t=(distance-start)/lengths[segment],a=chain[segment],b=chain[segment+1];add('streets',road.way,[a[0]+(b[0]-a[0])*t,a[2]+(b[2]-a[2])*t],height,surface.footprints.road);}
    }
  }
  if(options.green)for(const item of green.placements){
    const polygons=[...item.grass,...item.paths],before=placements.filter(p=>p.kind==='green').length,step=options.green.spacing;
    for(const polygon of polygons){const xs=polygon[0].map(p=>p[0]),zs=polygon[0].map(p=>p[1]);for(let x=Math.ceil(Math.min(...xs)/step)*step;x<Math.max(...xs);x+=step)for(let z=Math.ceil(Math.min(...zs)/step)*step;z<Math.max(...zs);z+=step)if(contains([polygon],[x,z]))add('green',item.id,[x,z],item.height,polygons);}
    if(placements.filter(p=>p.kind==='green').length===before)for(const polygon of polygons){const p=interior(polygon);if(p){add('green',item.id,p,item.height,polygons);if(placements.filter(p=>p.kind==='green').length>before)break;}}
  }
  if(!placements.length)fail('ve zvolených plochách nevznikl žádný zvukový bod.');
  return {placements,skipped};
}
