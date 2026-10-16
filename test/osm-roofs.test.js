import test from 'node:test';
import assert from 'node:assert/strict';
import {Ray,Vector3} from 'three';
import {osmRoofPlan,osmRoofDefaults} from '../src/plugins/osm/building-roofs.js';
import {osmShellModel,osmShellPlan} from '../src/plugins/osm/building-shells.js';
import {osmSource} from '../src/plugins/osm/area.js';
import {writeSurfaceModel} from '../src/core/surface-model.js';
import {parseFourDs} from '../src/core/fourds.js';
import {modelCollisionSurface} from '../src/core/model-collision.js';
const rect=[[-20,-10],[20,-10],[20,10],[-20,10]],hole=[[-6,-4],[6,-4],[6,4],[-6,4]],target={height:15,heightSource:'OSM height',estimated:false};
const roof=(tags={},polygon=[rect],opts={})=>osmRoofPlan(tags,polygon,target,{...osmRoofDefaults,...opts});
const item=(tags={},polygon=[rect],opts={})=>({polygon,style:'brick',position:[0,.2,0],...roof(tags,polygon,opts)});
const triangles=m=>m.meshes.flatMap(mesh=>mesh.lods[0].faces.flatMap(face=>Array.from({length:face.indices.length/3},(_,i)=>({material:face.material,points:face.indices.slice(i*3,i*3+3).map(v=>mesh.lods[0].positions.slice(v*3,v*3+3)),uv:face.indices.slice(i*3,i*3+3).map(v=>mesh.lods[0].uv.slice(v*2,v*2+2))}))));
const hits=(m,p,d)=>{const ray=new Ray(new Vector3(...p),new Vector3(...d).normalize());return triangles(m).flatMap(t=>{const h=ray.intersectTriangle(...t.points.map(p=>new Vector3(...p)),true,new Vector3());return h?[h.toArray()]:[];});};
const native=i=>parseFourDs(writeSurfaceModel(osmShellModel(i)),'all');
const near=(a,b)=>assert(Math.abs(a-b)<.0001,`${a} != ${b}`);
test('gable has two planar slopes, outward end walls, unchanged total height and metric slope UV',()=>{
  const p=item({'roof:shape':'gabled','roof:height':'4','roof:direction':'N'}),m=native(p);near(p.height,15);near(p.roofPlan.height,4);
  for(const [x,z,y]of [[.2,0,15],[.2,5,13],[.2,-5,13],[.2,9.9,11.04]]){const h=hits(m,[x,30,z],[0,-1,0]);assert(h.length);near(h[0][1],y);}
  assert(hits(m,[30,14,.1],[-1,0,0]).some(p=>Math.abs(p[0]-20)<1e-5));
  for(const t of triangles(m).filter(t=>t.material===3)){
    assert(t.points.every(p=>p[2]>=-1e-5)||t.points.every(p=>p[2]<=1e-5),'triangle crossed ridge');
    const [a,b,c]=t.points;assert((b[2]-a[2])*(c[0]-a[0])-(b[0]-a[0])*(c[2]-a[2])>0);
    for(let j=0;j<3;j++){const k=(j+1)%3;near(Math.hypot(...t.points[j].map((v,i)=>v-t.points[k][i])),Math.hypot(...t.uv[j].map((v,i)=>(v-t.uv[k][i])*4)));}
  }
});
test('skillion direction is downhill and OSM compass, degrees and across orientation agree',()=>{
  const a=item({'roof:shape':'skillion','roof:direction':'E','roof:height':'4'}),b=item({'roof:shape':'skillion','roof:direction':'90','roof:height':'4'});assert.deepEqual(native(a),native(b));
  const m=native(a);near(hits(m,[10,30,.2],[0,-1,0])[0][1],12);near(hits(m,[-10,30,.2],[0,-1,0])[0][1],14);
  const along=roof(),across=roof({},[rect],{orientation:'across'});near(Math.abs(along.roofPlan.axis[1]),1);near(Math.abs(across.roofPlan.axis[0]),1);
  const reversed=roof({},[rect.toReversed()]);assert.deepEqual(along.roofPlan,reversed.roofPlan);
  const subdivided=[rect[0],[0,-10],...rect.slice(1)];assert.deepEqual(roof({},[subdivided]).roofPlan,along.roofPlan);
});
test('concave and courtyard roofs remain open with correct inward walls after rotation and native collision conversion',()=>{
  const concave=[[-20,-10],[20,-10],[20,10],[4,10],[4,-2],[-4,-2],[-4,10],[-20,10]];
  for(const shape of ['gabled','skillion'])for(const polygon of [[rect,hole],[concave]]){
    const p=item({'roof:shape':shape,'roof:direction':'NE'},polygon),m=native(p),ts=triangles(m).filter(t=>t.material===3),area=ts.reduce((s,{points:[a,b,c]})=>s+((b[2]-a[2])*(c[0]-a[0])-(b[0]-a[0])*(c[2]-a[2]))/2,0);near(area,704);
    assert.equal(hits(m,[.1,30,3.1],[0,-1,0]).length,0);assert(hits(m,[15.1,30,3.1],[0,-1,0]).length);
    if(polygon.length===2)assert(hits(m,[0,5,.1],[1,0,0]).some(p=>Math.abs(p[0]-6)<1e-5));
    const object={...p,id:1,name:'ROOF',frameType:9,model:'house.4ds',rotation:[1,0,0,0],scale:[1,1,1]},surface=modelCollisionSurface(m,object,{objects:[object]},{meshes:[]});assert.equal(surface.indices.length/3,triangles(m).length);
    assert(surface.positions.every(Number.isFinite));near(Math.max(...surface.positions.filter((_,i)=>i%3===1)),15.2);
  }
});
test('height, roof levels and angles use explicit estimates and preserve height including roof; unsupported tags are reported',()=>{
  near(roof({'roof:height':'10 ft'}).roofPlan.height,3.048);near(roof({'roof:angle':'30'}).roofPlan.height,10*Math.tan(Math.PI/6));near(roof({'roof:levels':'2'}).roofPlan.height,6);
  const p=osmRoofPlan({'building:levels':'3','roof:height':'2'},[rect],{height:12,heightSource:'odhad',estimated:true},osmRoofDefaults);near(p.height,11);assert.equal(p.estimated,true);
  near(roof({'building:levels':'3','roof:height':'2'}).height,15);
  const flat=roof({'roof:shape':'flat','roof:height':'3'});near(flat.roofPlan.height,0);assert.equal(flat.roof,'flat');
  const unsupported=roof({'roof:shape':'hipped','roof:direction':'oops','roof:height':'oops','roof:orientation':'oops'});assert.equal(unsupported.roof,'gabled');assert.match(unsupported.notes.join(' '),/hipped/);assert.match(unsupported.notes.join(' '),/direction/);assert.match(unsupported.notes.join(' '),/height/);
  const disabled=roof({'roof:shape':'skillion','roof:height':'10'},[rect],{useOsmTags:false});assert.equal(disabled.roof,'gabled');near(disabled.roofPlan.height,3);
  const limited=roof({'roof:height':'60'});near(limited.roofPlan.height,12);assert.match(limited.notes.join(' '),/omezena/);
  const cappedLevels=osmRoofPlan({'building:levels':'5','roof:height':'60'},[rect],{height:18,heightSource:'odhad',estimated:true},osmRoofDefaults);near(cappedLevels.roofPlan.height,30);near(cappedLevels.height,45);
  for(const opts of [{height:NaN},{height:0},{shape:'hipped'},{orientation:'oops'},{useOsmTags:1}])assert.throws(()=>roof({},[rect],opts),/střechy/);
  const bad=item();bad.roofPlan.axis=[0,0];assert.throws(()=>native(bad),/střechy/);
});
test('normalization retains bounded roof tags for ways and relations; planner and legacy flat import are deterministic',()=>{
  const tags={'roof:shape':'gabled','roof:height':'3','roof:levels':'1','roof:angle':'30','roof:direction':'NW','roof:orientation':'across'},data={elements:[...rect.map(([x,z],i)=>({type:'node',id:i+1,lat:z/111195,lon:x/111195})),{type:'way',id:1,nodes:[1,2,3,4,1],tags:{building:'yes',...tags}}]},area={latitude:0,longitude:0,size:200},source=osmSource(data,area);for(const [key,value]of Object.entries(tags))assert.equal(source.buildings[0].tags[key],value);
  const options={version:1,mode:'footprint',selected:[1],styles:[{id:'brick'}],ground:.2,fallbackHeight:15},roads={crossings:[],roads:[]},surface={model:{meshes:[]},footprints:{road:[],sidewalk:[]}},legacy=osmShellPlan(source,roads,surface,options),raised=osmShellPlan(source,roads,surface,{...options,roof:osmRoofDefaults});assert.equal(legacy.placements[0].roof,'flat');assert.equal(legacy.placements[0].roofPlan,undefined);assert.equal(raised.placements[0].roof,'gabled');assert.deepEqual(raised,osmShellPlan(source,roads,surface,{...options,roof:osmRoofDefaults}));
  const relation=structuredClone(data);delete relation.elements.at(-1).tags;relation.elements.push({type:'relation',id:5,members:[{type:'way',ref:1,role:'outer'}],tags:{type:'multipolygon',building:'yes',...tags}});for(const [key,value]of Object.entries(tags))assert.equal(osmSource(relation,area).buildings.find(b=>b.relation).tags[key],value);
  const invalid=structuredClone(data);invalid.elements.at(-1).tags['roof:shape']='g'.repeat(1025);assert.throws(()=>osmSource(invalid,area),/značka/);
});
