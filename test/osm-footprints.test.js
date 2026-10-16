import test from 'node:test';
import assert from 'node:assert/strict';
import clipping from 'polygon-clipping';
import {Vector3} from 'three';
import {osmSource} from '../src/plugins/osm/area.js';
import {osmBuildingFootprints} from '../src/plugins/osm/footprints.js';
import {osmBuildingPlan} from '../src/plugins/osm/buildings.js';
import {frameMatrix} from '../src/shared/scene-world.js';
const area={latitude:50,longitude:14,size:200},rad=Math.PI/180,r=6371008.8;
const node=(id,x,z)=>({type:'node',id,lat:50+z/r/rad,lon:14+x/r/rad/Math.cos(50*rad)});
const way=(id,nodes,tags)=>({type:'way',id,nodes,...(tags?{tags}:{})});
const member=(ref,role='outer')=>({type:'way',ref,role});
const relation=(id,members,tags={})=>({type:'relation',id,members,tags:{type:'multipolygon',building:'yes',height:'10',...tags}});
const rect=(first,x,z,w,d)=>[[x,z],[x+w,z],[x+w,z+d],[x,z+d]].map((p,i)=>node(first+i,...p));
function fixture(){return {elements:[...rect(1,-30,-20,60,40),...rect(5,-8,-5,16,10),way(20,[1,2,3]),way(21,[1,4,3]),way(22,[5,6,7,8,5]),relation(20,[member(22,'inner'),member(21),member(20)],{name:'Courtyard'})]};}
const read=data=>osmSource(data,area),features=data=>osmBuildingFootprints(read(data)).filter(b=>!b.suppressed);
const measure=mp=>mp.reduce((s,p)=>s+Math.abs(p[0].reduce((v,a,i)=>{const b=p[0][(i+1)%p[0].length];return v+a[0]*b[1]-b[0]*a[1];},0))/2-p.slice(1).reduce((v,h)=>v+measure([[h]]),0),0);
test('multipolygon joins untagged, reversed and unordered members by node IDs; hole and identity survive',()=>{
  const data=fixture(),before=structuredClone(data),a=features(data);assert.equal(a.length,1);assert.equal(a[0].id,'relation/20/1');assert.equal(a[0].polygons[0].length,2);assert(Math.abs(measure(a[0].polygons)-2240)<1e-5);assert.deepEqual(data,before);
  const reversed=structuredClone(data);for(const e of reversed.elements)if(e.type==='way')e.nodes.reverse();else if(e.type==='relation')e.members.reverse();reversed.elements.reverse();assert.deepEqual(features(reversed),a);
});
test('separate outer components get stable selectable IDs and preserve holes on their owning part',()=>{
  const data=fixture();data.elements.push(...rect(9,50,40,20,20),way(23,[9,10,11,12,9]));data.elements.find(e=>e.type==='relation').members.unshift(member(23));const a=features(data);assert.equal(a.length,2);assert.deepEqual(a.map(b=>b.id),['relation/20/1','relation/20/2']);assert.deepEqual(a.map(b=>b.polygons[0].length),[2,1]);assert(a.every(b=>b.components===2));
  const other=structuredClone(data);other.elements.find(e=>e.type==='relation').members.reverse();assert.deepEqual(features(other),a);
});
test('incomplete, ambiguous, duplicate and unsupported members stay visible with reasons, never fall back to outer fill',()=>{
  const cases=[
    d=>d.elements.splice(d.elements.findIndex(e=>e.type==='way'&&e.id===21),1),
    d=>d.elements.splice(d.elements.findIndex(e=>e.type==='node'&&e.id===4),1),
    d=>d.elements.find(e=>e.type==='way'&&e.id===21).nodes.push(2),
    d=>d.elements.find(e=>e.type==='relation').members.push(member(20)),
    d=>d.elements.find(e=>e.type==='relation').members[0].role='',
    d=>d.elements.find(e=>e.type==='relation').members[0].type='relation',
    d=>d.elements.find(e=>e.type==='relation').tags.type='building',
    d=>d.elements.find(e=>e.type==='relation').members=Array(129).fill(member(20))
  ];
  for(const change of cases){const data=fixture();change(data);const result=features(data);assert.equal(result.length,1);assert.match(result[0].reason,/./);assert.deepEqual(result[0].polygons,[]);}
  const data=fixture();data.elements.find(e=>e.type==='way'&&e.id===20).tags={building:'yes'};const s=read(data);assert.equal(s.buildings.find(b=>b.id===20).suppressed,true);assert.match(s.buildings.find(b=>b.id===20).reason,/relaci/);assert.equal(features(data).length,1);
});
test('crossing, touching, outside or overlapping rings are rejected; self-intersecting boundaries are rejected',()=>{
  for(const [x,z,w,d]of [[25,0,20,10],[-30,-5,10,10],[70,0,5,5]]){const data=fixture();data.elements.splice(4,4,...rect(5,x,z,w,d));assert.match(features(data)[0].reason,/Otvor/);}
  const data=fixture();data.elements.push(...rect(9,-4,-3,10,6),way(23,[9,10,11,12,9]));data.elements.find(e=>e.type==='relation').members.push(member(23,'inner'));assert.match(features(data)[0].reason,/Otvory/);
  const bow=fixture();bow.elements.find(e=>e.type==='way'&&e.id===22).nodes=[5,7,6,8,5];assert.match(features(bow)[0].reason,/protíná/);
  const outer=fixture();outer.elements.push(...rect(9,20,0,30,20),way(23,[9,10,11,12,9]));outer.elements.find(e=>e.type==='relation').members.push(member(23));assert.match(features(outer)[0].reason,/Vnější/);
});
test('legacy outer-way tags and explicit relation exclusions cannot silently fill their holes',()=>{
  for(const building of [undefined,'no']){
    const data=fixture(),r=data.elements.find(e=>e.type==='relation');if(building===undefined)delete r.tags.building;else r.tags.building=building;
    data.elements.find(e=>e.type==='way'&&e.id===20).tags={building:'yes'};
    const source=read(data),feature=source.buildings.find(b=>b.relation===20);assert.match(feature.reason,/starší či rozporné/);assert.equal(source.ways[0].buildingRelation,true);assert.equal(source.buildings.find(b=>b.id===20).suppressed,true);
  }
});
test('house placement uses full multipolygon area and native transform; courtyards cannot be filled',()=>{
  const s=read(fixture()),model={path:'models/house.4ds',sha256:'a'.repeat(64),min:[-12,0,-9],max:[12,10,9],vertices:8},settings={version:1,selected:['relation/20/1'],adjustScale:false,minCoverage:.25,fallbackHeight:10,ground:.2},roads={crossings:[{position:[-90,0,-70]},{position:[90,0,-70]}],roads:[{from:0,to:1,positions:[]}]},surface={model:{meshes:[]},footprints:{road:[],sidewalk:[]}};
  const tooBig=osmBuildingPlan(s,roads,surface,[{...model,min:[-30,0,-20],max:[30,10,20]}],settings);assert.equal(tooBig.placements.length,0);
  const fit=osmBuildingPlan(s,roads,surface,[{...model,min:[-10,0,-15],max:[10,10,15]}],settings);assert.equal(fit.placements.length,1);const p=fit.placements[0];assert.equal(p.name,'OSM_R_20_1');assert.equal(p.relation,20);assert.equal(p.component,1);assert.equal(p.estimated,false);
  const corners=[[-10,-15],[10,-15],[10,15],[-10,15]].map(([x,z])=>new Vector3(x,0,z).applyMatrix4(frameMatrix(p)).toArray()).map(p=>[p[0],p[2]]),poly=[[...corners,corners[0]]],outline=s.buildings[0].polygons[0];assert(measure(clipping.difference(poly,outline))<1e-4);assert(measure(clipping.intersection(poly,[outline[1]]))<1e-5);
  assert.deepEqual(osmBuildingPlan(s,roads,surface,[{...model,min:[-10,0,-15],max:[10,10,15]}],settings),fit);
});
test('legacy way selections coexist with relation IDs and an invalid component cannot import',()=>{
  const data=fixture();data.elements.push(...rect(9,50,50,10,10),way(20_000,[9,10,11,12,9],{building:'yes'}));const s=read(data),features=osmBuildingFootprints(s);assert(features.some(b=>b.id===20_000));assert(features.some(b=>b.id==='relation/20/1'));assert.equal(s.ways.length,1);
  const model={path:'models/H.4ds',sha256:'a',min:[-2,0,-2],max:[2,10,2],vertices:8},settings={version:1,selected:['relation/20/2'],adjustScale:false,minCoverage:.25,fallbackHeight:10,ground:0},roads={crossings:[{position:[-90,0,-70]},{position:[90,0,-70]}],roads:[{from:0,to:1,positions:[]}]};assert.throws(()=>osmBuildingPlan(s,roads,{model:{meshes:[]},footprints:{road:[],sidewalk:[]}},[model],settings),/není v podkladu/);
});
