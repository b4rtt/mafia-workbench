import test from 'node:test';
import assert from 'node:assert/strict';
import {osmRoadProfile} from '../src/plugins/osm/profiles.js';
import {osmSurfaceModel,osmSurfaceDefaults} from '../src/plugins/osm/surface.js';
import {osmSource,osmRoadPlan} from '../src/plugins/osm/area.js';
import {writeSurfaceModel} from '../src/core/surface-model.js';
import {parseFourDs} from '../src/core/fourds.js';
const options={...osmSurfaceDefaults,useOsmTags:true};
const street=(tags,reverse=false)=>({flat:true,crossings:(reverse?[[40,0,0],[-40,0,0]]:[[-40,0,0],[40,0,0]]).map(position=>({position})),roads:[{from:0,to:1,positions:[],tags,way:10}]});
function faces(model){return model.meshes.flatMap(m=>m.lods[0].faces.flatMap(f=>Array.from({length:f.indices.length/3},(_,i)=>({material:f.material,p:f.indices.slice(i*3,i*3+3).map(v=>m.lods[0].positions.slice(v*3,v*3+3))}))));}
function materialAt(model,x,z){return faces(model).filter(({material,p:[a,b,c]})=>{if(material===3)return false;const sign=(a,b)=>(b[0]-a[0])*(z-a[2])-(b[2]-a[2])*(x-a[0]),s=[sign(a,b),sign(b,c),sign(c,a)];return s.every(n=>n>1e-8)||s.every(n=>n< -1e-8);}).map(f=>f.material);}
test('OSM profile lengths use explicit metric/imperial units and never coerce ambiguous ranges or comma decimals',()=>{
  for(const [width,expected]of [['8',8],['8.5 m',8.5],['800 cm',8],['0.008 km',8],['20 ft',6.096],[`20'3"`,6.1722]]){const p=osmRoadProfile({width},options);assert.ok(Math.abs(p.width-expected)<1e-9);assert.equal(p.widthSource,'OSM width');assert.equal(p.estimated,false);}
  for(const width of ['8,5','6-8','6;8','6m','narrow','-3','100','Infinity',`20'13"`]){const p=osmRoadProfile({width},options);assert.equal(p.width,6);assert.match(p.widthSource,/ruční/);assert.match(p.notes[0],/width=/);}
  const p=osmRoadProfile({width:'bad','width:carriageway':'7',est_width:'9'},options);assert.equal(p.width,7);assert.equal(p.estimated,false);assert.equal(osmRoadProfile({est_width:'7'},options).estimated,true);
});
test('lane width is an explicit opt-in estimate and can never override a recorded carriageway width',()=>{
  assert.equal(osmRoadProfile({lanes:'1'},options).width,6);const p=osmRoadProfile({lanes:'2'},{...options,estimateLanes:true,laneWidth:3.25});assert.equal(p.width,6.5);assert.equal(p.estimated,true);assert.match(p.notes[0],/parkovací/);
  assert.equal(osmRoadProfile({width:'9',lanes:'1'},{...options,estimateLanes:true}).width,9);
  for(const lanes of ['2;3','2.5','0','8','conditional'])assert.equal(osmRoadProfile({lanes},{...options,estimateLanes:true,laneWidth:4}).width,6);
});
test('sidewalk hierarchy, side-specific widths, absent sidewalks and explicit separate/ambiguous fallbacks remain distinct',()=>{
  const p=osmRoadProfile({sidewalk:'no','sidewalk:both':'yes','sidewalk:right':'no','sidewalk:both:width':'1.5','sidewalk:left:width':'2.5'},options);assert.equal(p.left,2.5);assert.equal(p.right,0);assert.match(p.leftSource,/left:width/);
  const q=osmRoadProfile({sidewalk:'left','sidewalk:left:width':'bad','sidewalk:both:width':'1.2'},options);assert.equal(q.left,1.2);assert.equal(q.right,0);assert.match(q.notes[0],/left:width/);
  for(const sidewalk of ['separate','yes','lane','unknown']){const p=osmRoadProfile({sidewalk},{...options,sidewalks:'right'});assert.equal(p.left,0);assert.equal(p.right,2);assert.ok(p.notes.length);}
  for(const sidewalk of ['no','none']){const p=osmRoadProfile({sidewalk},options);assert.equal(p.left+p.right,0);}
  const manual=osmRoadProfile({width:'12',sidewalk:'right'},{...options,useOsmTags:false,sidewalks:'left'});assert.deepEqual([manual.width,manual.left,manual.right],[6,2,0]);
  for(const value of [{useOsmTags:'true'},{sidewalks:'elsewhere'},{laneWidth:NaN},{estimateLanes:1}])assert.throws(()=>osmRoadProfile({}, {...options,...value}),/profilu/);
});
test('one-sided sidewalks follow OSM way orientation rather than oneway direction and serialize without opposite-side pavement',()=>{
  const forward=osmSurfaceModel(street({width:'8',sidewalk:'left','sidewalk:left:width':'1.5',oneway:'-1'}),{size:200},options),reversed=osmSurfaceModel(street({width:'8',sidewalk:'right','sidewalk:right:width':'1.5'},true),{size:200},options);
  for(const model of [forward.model,reversed.model,parseFourDs(writeSurfaceModel(forward.model),'all')]){assert.deepEqual(materialAt(model,5.123,4.731),[2]);assert.deepEqual(materialAt(model,5.123,-4.731),[]);assert.deepEqual(materialAt(model,5.123,2.731),[1]);assert.deepEqual(materialAt(model,5.123,5.731),[]);}
  assert.equal(JSON.stringify(forward.footprints),JSON.stringify(reversed.footprints));
  const none=osmSurfaceModel(street({sidewalk:'no'}),{size:200},options);assert.deepEqual(none.footprints.sidewalk,[]);assert.ok(faces(parseFourDs(writeSurfaceModel(none.model),'all')).every(f=>f.material===1));
});
test('variable widths and asymmetric curved sidewalks join without layered tops, retain courtyard holes and preserve the source plan',()=>{
  const plan={flat:true,crossings:[[-60,0,0],[0,0,0],[60,0,0],[20,0,50]].map(position=>({position})),roads:[{from:0,to:1,positions:[],way:1,tags:{width:'4',sidewalk:'left'}},{from:1,to:2,positions:[],way:2,tags:{width:'10',sidewalk:'right','sidewalk:right:width':'1'}},{from:1,to:3,positions:[[5,0,20]],way:3,tags:{width:'6',sidewalk:'left'}}]},before=structuredClone(plan),{model}=osmSurfaceModel(plan,{size:200},options);
  assert.deepEqual(plan,before);for(const [x,z,material]of [[-30.113,1.731,1],[-30.113,3.731,2],[-30.113,-3.731,null],[30.113,4.731,1],[30.113,-5.731,2],[30.113,5.731,null]])assert.deepEqual(materialAt(model,x,z),material?[material]:[]);
  for(let x=-65.123;x<65;x+=2.73)for(let z=-10.147;z<58;z+=2.41)assert.ok(materialAt(model,x,z).length<=1,`${x}/${z}`);
  const closed={flat:true,crossings:[[-25,0,-25],[25,0,-25],[25,0,25],[-25,0,25]].map(position=>({position})),roads:[[0,1],[1,2],[2,3],[3,0]].map(([from,to])=>({from,to,positions:[],tags:{sidewalk:'left',width:'4'}}))};assert.deepEqual(materialAt(osmSurfaceModel(closed,{size:200},options).model,.123,.456),[]);
});
test('OSM source retains supported profile tags through clipping and reverse one-way planning',()=>{
  const area={latitude:50,longitude:14,size:200},data={elements:[{type:'node',id:1,lat:50,lon:13.999},{type:'node',id:2,lat:50,lon:14.001},{type:'way',id:3,nodes:[1,2],tags:{highway:'residential',oneway:'-1',width:'8','sidewalk:left':'yes','sidewalk:right':'no','sidewalk:left:width':'1.2'}}]},plan=osmRoadPlan(osmSource(data,area),[3]),profile=osmSurfaceModel(plan,area,options).profiles[0];assert.deepEqual([profile.width,profile.left,profile.right],[8,1.2,0]);assert.equal(plan.roads[0].forward,false);assert.equal(plan.roads[0].reverse,true);
});
