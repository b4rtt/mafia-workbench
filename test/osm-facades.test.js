import test from 'node:test';
import assert from 'node:assert/strict';
import {Ray,Vector3} from 'three';
import {osmFacadePanels,osmFacadeRecipe,osmFacadeRing} from '../src/plugins/osm/building-facades.js';
import {osmShellModel,osmShellPlan,osmShellStyles} from '../src/plugins/osm/building-shells.js';
import {osmFacadeTexture} from '../src/plugins/osm/building-facade-texture.js';
import {parseBmp} from '../src/core/bmp.js';
import {osmRoofPlan,osmRoofDefaults} from '../src/plugins/osm/building-roofs.js';
import {writeSurfaceModel} from '../src/core/surface-model.js';
import {parseFourDs} from '../src/core/fourds.js';
import {modelCollisionSurface} from '../src/core/model-collision.js';
const facade={version:1},rect=[[-13,-8],[13,-8],[13,8],[-13,8]],hole=[[-3,-2],[3,-2],[3,2],[-3,2]];
const item=(style='brick',height=15,polygon=[rect,hole])=>({style,height,polygon,position:[0,.2,0],facade});
function triangles(m){return m.meshes.flatMap(mesh=>mesh.lods[0].faces.flatMap(f=>Array.from({length:f.indices.length/3},(_,i)=>({material:f.material,p:f.indices.slice(i*3,i*3+3).map(n=>mesh.lods[0].positions.slice(n*3,n*3+3)),uv:f.indices.slice(i*3,i*3+3).map(n=>mesh.lods[0].uv.slice(n*2,n*2+2))}))));}
function hits(m,p,d){const ray=new Ray(new Vector3(...p),new Vector3(...d));return triangles(m).flatMap(t=>{const hit=ray.intersectTriangle(...t.p.map(p=>new Vector3(...p)),true,new Vector3());return hit?[hit.toArray()]:[];});}
const near=(a,b)=>assert(Math.abs(a-b)<.0001,`${a} != ${b}`);

test('facade panels cover arbitrary widths/heights exactly once with whole atlas ends, complete window rows and bounded scaling',()=>{
  for(const style of osmShellStyles)for(const length of [.02,1,3,5.31,13.7,37,300])for(const trim of [2.75,5.23,11.75,26.1,119.75]){
    const ground=Math.min(style.groundHeight,trim),panels=osmFacadePanels(length,ground,trim,style),rows=osmFacadeRecipe(style).rows;
    near(panels.reduce((n,p)=>n+(p.x1-p.x0)*(p.y1-p.y0),0),length*trim);
    for(let i=0;i<panels.length;i++){
      const p=panels[i];assert(p.x0>=0&&p.x1<=length&&p.y0>=0&&p.y1<=trim&&p.x1>p.x0&&p.y1>p.y0);
      for(const q of panels.slice(i+1))assert(Math.min(p.x1,q.x1)-Math.max(p.x0,q.x0)<=1e-7||Math.min(p.y1,q.y1)-Math.max(p.y0,q.y0)<=1e-7,'overlapping panels');
      if(p.material===5)continue;
      const [u0,v0,u1,v1]=p.uv;assert.equal(u0,0);assert(Number.isInteger(u1)&&u1>0);assert(p.material===1?v0===0&&v1===1:rows.includes(v0)&&rows[rows.indexOf(v0)+1]===v1);
      const sx=(p.x1-p.x0)/(u1*(p.material===1?style.groundWidth:style.width)),sy=(p.y1-p.y0)/((v1-v0)*(p.material===1?style.groundHeight:style.upperHeight));assert(sx>=.85-1e-6&&sx<=1.15+1e-6);assert(sy>=.85-1e-6&&sy<=1.15+1e-6);
    }
    assert.deepEqual(panels,osmFacadePanels(length,ground,trim,style));
  }
});

test('whole-window shells preserve native footprint area, normals, courtyard and collision for flat, gabled and skillion roofs',()=>{
  const concave=[[-13,-8],[13,-8],[13,8],[3,8],[3,-2],[-3,-2],[-3,8],[-13,8]];
  for(const style of osmShellStyles)for(const polygon of [[rect,hole],[concave]])for(const shape of ['flat','gabled','skillion']){
    const p={...item(style.id,15,polygon),...osmRoofPlan({'roof:shape':shape,'roof:direction':'NE'},polygon,{height:15,heightSource:'OSM',estimated:false},osmRoofDefaults)},bytes=writeSurfaceModel(osmShellModel(p)),m=parseFourDs(bytes,true),ts=triangles(m),eaves=15-p.roofPlan.height;
    assert.equal(m.materials.length,5);assert.equal(m.materials[4].texture,`WB_OSMF_${style.id}.BMP`);
    assert.equal(hits(m,[.1,30,.1],[0,-1,0]).length,0);assert(hits(m,[10.1,30,.1],[0,-1,0]).length);assert(hits(m,[20,4,.1],[-1,0,0]).some(p=>Math.abs(p[0]-13)<1e-6));
    const roofArea=ts.filter(t=>t.material===3).reduce((n,{p:[a,b,c]})=>n+((b[2]-a[2])*(c[0]-a[0])-(b[0]-a[0])*(c[2]-a[2]))/2,0);near(roofArea,polygon.length===2?392:356);
    if(shape!=='flat'){const gables=ts.filter(t=>t.p.some(p=>p[1]>eaves+.0001)&&t.material!==3);assert(gables.length);assert(gables.every(t=>t.material===5),'window texture reached gable');}
    for(const mesh of m.meshes){const l=mesh.lods[0];for(let n=0;n<l.vertices;n++)near(Math.hypot(...l.normals.slice(n*3,n*3+3)),1);assert(l.uv.every(Number.isFinite));}
    const object={...p,id:1,name:'HOUSE',frameType:9,model:'house.4ds',rotation:[1,0,0,0],scale:[1,1,1]},collision=modelCollisionSurface(m,object,{objects:[object]},{meshes:[]});assert.equal(collision.indices.length/3,ts.length);assert(collision.positions.every(Number.isFinite));
    assert.deepEqual(bytes,writeSurfaceModel(osmShellModel(JSON.parse(JSON.stringify(p)))));
  }
});

function bitmap(bits,topDown){
  const size=64,count=bits===8?256:0,offset=54+count*4,stride=size*bits/8,b=Buffer.alloc(offset+stride*size);b.write('BM');b.writeUInt32LE(b.length,2);b.writeUInt32LE(offset,10);b.writeUInt32LE(40,14);b.writeInt32LE(size,18);b.writeInt32LE(topDown?-size:size,22);b.writeUInt16LE(1,26);b.writeUInt16LE(bits,28);b.writeUInt32LE(count,46);
  for(let i=0;i<count;i++){b[54+i*4]=i;b[55+i*4]=(i*3)%256;b[56+i*4]=255-i;}
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){const at=offset+(topDown?y:size-1-y)*stride+x*bits/8;if(bits===8)b[at]=(x*3+y)%256;else{b[at]=x*3;b[at+1]=y*3;b[at+2]=(x+y)*2;if(bits===32)b[at+3]=0;}}
  return b;
}
test('derived filler BMPs use only their audited source swatch, stay opaque and seamless, and preserve all source bytes',()=>{
  for(const bits of [8,24,32])for(const topDown of [false,true])for(const style of osmShellStyles){
    const source=bitmap(bits,topDown),before=Buffer.from(source),original=parseBmp(source),bytes=osmFacadeTexture(source,style),b=parseBmp(bytes);assert.equal(b.width,32);assert.equal(b.height,32);assert.equal(b.bits,24);assert.deepEqual(source,before);assert.deepEqual(bytes,osmFacadeTexture(source,style));
    const [u0,v0,u1,v1]=osmFacadeRecipe(style).swatch,colors=[];
    for(let y=Math.floor(v0*64);y<Math.ceil(v1*64);y++)for(let x=Math.floor(u0*64);x<Math.ceil(u1*64);x++){const i=y*64+x;colors.push(bits===8?original.palette[original.pixels[i]]:Array.from(original.pixels.slice(i*original.channels,i*original.channels+3)));}
    for(let i=0;i<b.pixels.length;i++)assert(b.pixels[i]>=Math.min(...colors.map(c=>c[i%3]))&&b.pixels[i]<=Math.max(...colors.map(c=>c[i%3])),'sample outside audited wall swatch');
    for(let n=0;n<32;n++)for(let k=0;k<3;k++){assert.equal(b.pixels[n*32*3+k],b.pixels[(n*32+31)*3+k]);assert.equal(b.pixels[n*3+k],b.pixels[(31*32+n)*3+k]);}
  }
  assert.throws(()=>osmFacadeTexture(Buffer.from('not BMP'),osmShellStyles[0]),/BMP/);
  for(const bad of [null,false,{},1,{version:2},{version:1,other:true}])assert.throws(()=>osmShellModel({...item(),facade:bad}),/fasády/);
  for(const path of ['maps/../bad.bmp','maps/original.bmp','maps/WB_OSMF_bad/child.bmp'])assert.throws(()=>osmShellModel({...item(),facadeTexture:path}),/textura/);
});

test('planner retains explicit new layout only when requested and validates it before allocating any houses',()=>{
  const source={area:{size:100},ways:[],buildings:[{id:1,tags:{building:'yes'},polygons:[[rect,hole]]}]},surface={model:{meshes:[]},footprints:{road:[],sidewalk:[]}},options={version:1,mode:'footprint',selected:[1],styles:[{id:'brick'}],ground:.2,fallbackHeight:15};
  const legacy=osmShellPlan(source,{},surface,options),modern=osmShellPlan(source,{},surface,{...options,facade});assert.equal(legacy.placements[0].facade,undefined);assert.deepEqual(modern.placements[0].facade,facade);assert.notEqual(legacy.placements[0].triangles,modern.placements[0].triangles);assert.match(modern.placements[0].notes.join(' '),/Celé bloky/);assert.deepEqual(modern,osmShellPlan(source,{},surface,{...options,facade}));assert.throws(()=>osmShellPlan(source,{},surface,{...options,facade:{version:9}}),/fasády/);
});
test('redundant points on a straight wall cannot restart or remove whole window blocks; real corners stay intact',()=>{
  const subdivided=[rect[0],[-10,-8],[-7,-8],[0,-8],...rect.slice(1)],original=item('brick',15,[rect]),split={...original,polygon:[subdivided]},native=p=>parseFourDs(writeSurfaceModel(osmShellModel(p)),true);
  const before=structuredClone(subdivided);assert.deepEqual(osmFacadeRing(subdivided),rect);assert.deepEqual(subdivided,before);
  assert.deepEqual(triangles(native(split)).filter(t=>t.material!==3),triangles(native(original)).filter(t=>t.material!==3));
  const corner=[rect[0],[-7,-8.001],...rect.slice(1)];assert.deepEqual(osmFacadeRing(corner),corner);
});
