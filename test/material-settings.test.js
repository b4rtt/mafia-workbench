import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import * as THREE from 'three';
import {parseFourDs,editFourDs} from '../src/core/fourds.js';
import {materialFlags,materialAlphaMode,withMaterialAlphaMode,materialDraft} from '../src/shared/material-settings.js';
import {Viewport} from '../src/ui/viewport.js';
import {ModProject} from '../src/core/project.js';
import {hash,writeSafe} from '../src/core/files.js';
const u16=n=>{const b=Buffer.alloc(2);b.writeUInt16LE(n);return b;},u32=n=>{const b=Buffer.alloc(4);b.writeUInt32LE(n);return b;},floats=values=>{const b=Buffer.alloc(values.length*4);values.forEach((value,i)=>b.writeFloatLE(value,i*4));return b;},text=value=>Buffer.concat([Buffer.from([Buffer.byteLength(value)]),Buffer.from(value)]);
function fixture(){
  const header=Buffer.alloc(14,0xbb);header.write('4DS\0');header.writeUInt16LE(29,4);
  const material=Buffer.concat([u32(0x440c8001),floats([.1,.2,.3,.4,.5,.6,0,0,0,1,.7]),text('reflection.bmp'),text('tree.bmp'),text('mask.bmp'),Buffer.alloc(18,0xee)]);
  const plain=Buffer.concat([u32(1),floats([-0,.25,2,1,1,1,0,0,0,1]),text('')]);
  const mesh=Buffer.concat([Buffer.from([1,0,0x42,0x43]),u16(0),floats([0,0,0,1,1,1,1,0,0,0]),Buffer.from([7]),text('mesh'),text('opaque properties'),u16(0),Buffer.from([1]),floats([0]),u16(3),floats([0,0,0,0,1,0,0,0,1,0,0,0,1,0,1,0,0,1,0,0,1,0,0,1]),Buffer.from([1]),u16(1),u16(0),u16(1),u16(2),u16(1)]);
  return Buffer.concat([header,u16(2),material,plain,u16(1),mesh,Buffer.from([0x63])]);
}
const fields=['flags','ambient','diffuse','emission','opacity','texture','alphaTexture','reflection','environmentTexture'];
const settings=material=>Object.fromEntries(fields.filter(key=>material[key]!==undefined).map(key=>[key,material[key]]));

test('material mode changes preserve unrelated bits and distinguish implicit masks from embedded alpha',()=>{
  const base=0x0c001001;
  for(const [mode,bits] of [['opacity',0],['key',0x20008000],['embedded',0x01008000],['mask',0x40008000],['implicit',0x8000],['additive',0x80008000]]){
    const flags=withMaterialAlphaMode(base,mode);assert.equal(flags,(base|bits)>>>0);assert.equal(materialAlphaMode(flags),mode);
  }
  assert.throws(()=>withMaterialAlphaMode(base,'unknown'),/režim/);
});

test('material settings rebuild conditional masks/reflections and preserve animation, geometry and untouched fields exactly',()=>{
  const source=fixture(),parsed=parseFourDs(source,true),original=settings(parsed.materials[0]);
  assert.deepEqual(editFourDs(source,parsed.entries.map(({id,value})=>({id,value}))),source);
  assert.deepEqual(editFourDs(source,[{id:'materials/0/settings',value:original}]),source);
  for(const mode of ['opacity','key','embedded','mask','implicit','additive']){
    const value={...original,flags:withMaterialAlphaMode(original.flags,mode),opacity:.25,texture:'longer-name.bmp',alphaTexture:mode==='mask'?'new-mask.bmp':original.alphaTexture};
    const changed=editFourDs(source,[{id:'materials/0/settings',value}]),checked=parseFourDs(changed,true);
    assert.equal(checked.materials[0].flags,value.flags);assert.equal(checked.materials[0].opacity,.25);assert.equal(checked.materials[0].texture,value.texture);
    assert.equal(checked.materials[0].alphaTexture,mode==='mask'?value.alphaTexture:undefined);
    assert.deepEqual(checked.meshes,parsed.meshes);assert.ok(changed.includes(Buffer.alloc(18,0xee)));assert.equal(changed.at(-1),0x63);assert.deepEqual(changed.subarray(0,16),source.subarray(0,16));
    assert.deepEqual(editFourDs(changed,[{id:'materials/0/settings',value:original}]),source);
  }
  const noReflection=editFourDs(source,[{id:'materials/0/settings',value:{flags:(original.flags&~materialFlags.environment)>>>0}}]);assert.equal(parseFourDs(noReflection).materials[0].environmentTexture,undefined);
  assert.deepEqual(editFourDs(noReflection,[{id:'materials/0/settings',value:original}]),source);
  const second=settings(parsed.materials[1]),reflected=editFourDs(source,[{id:'materials/1/settings',value:{flags:second.flags|materialFlags.environment,reflection:.8,environmentTexture:'new-reflection.bmp'}}]);
  assert.equal(parseFourDs(reflected).materials[1].environmentTexture,'new-reflection.bmp');assert.deepEqual(editFourDs(reflected,[{id:'materials/1/settings',value:second}]),source);
  const combined=editFourDs(source,[{id:'materials/0/texture',value:'changed.bmp'},{id:'materials/1/settings',value:{flags:0x40048001,texture:'plain.bmp',alphaTexture:'plain-mask.bmp'}},{id:'meshes/0/name',value:'changed mesh'}]);
  const checked=parseFourDs(combined,true);assert.equal(checked.materials[1].alphaTexture,'plain-mask.bmp');assert.equal(checked.materials[0].texture,'changed.bmp');assert.equal(checked.meshes[0].name,'changed mesh');assert.deepEqual(checked.meshes[0].lods,parsed.meshes[0].lods);assert.ok(Object.is(checked.materials[1].ambient[0],-0));
});

test('generic diffuse edits create/remove required alpha name bytes without corrupting following materials and meshes',()=>{
  const source=fixture(),plain=editFourDs(source,[{id:'materials/0/texture',value:''}]),parsed=parseFourDs(plain,true);
  assert.equal(parsed.materials[0].texture,'');assert.equal(parsed.materials[0].alphaTexture,undefined);assert.equal(parsed.meshes[0].name,'mesh');
  const textured=editFourDs(plain,[{id:'materials/0/texture',value:'new.bmp'}]);assert.equal(parseFourDs(textured).materials[0].alphaTexture,'');
  const changed=editFourDs(source,[{id:'materials/0/settings',value:{opacity:.4}},{id:'materials/0/opacity',value:.5}]);assert.equal(parseFourDs(changed).materials[0].opacity,.5);
});

test('material writes reject unsupported layout bits, duplicate IDs, invalid arrays and unencodable texture names',()=>{
  const source=fixture(),flags=parseFourDs(source).materials[0].flags;
  for(const value of [{flags:(flags^0x04000000)>>>0},{flags:(flags^1)>>>0},{flags:-1},{flags:'1'},{opacity:2},{diffuse:[1,2]},{diffuse:[NaN,0,0]},{diffuse:[,0,0]},{ambient:[1e100,0,0]},{texture:null},{texture:undefined},{alphaTexture:3},{environmentTexture:false},{reflection:Infinity},{texture:'bad\0.bmp'},{texture:'emoji 🐱'},{texture:'x'.repeat(256)},{unknown:1},null,[]])assert.throws(()=>editFourDs(source,[{id:'materials/0/settings',value}]),/4DS/);
  assert.throws(()=>editFourDs(source,[{id:'materials/0/settings',value:{}},{id:'materials/0/settings',value:{}}]),/vlastnost/);
  assert.throws(()=>editFourDs(source,[{id:'materials/2/settings',value:{}}]),/vlastnost/);
  const signed=editFourDs(source,[{id:'materials/1/settings',value:{ambient:[0,.25,2]}}]);assert.ok(Object.is(parseFourDs(signed).materials[1].ambient[0],0));assert.deepEqual(editFourDs(signed,[{id:'materials/1/settings',value:settings(parseFourDs(source).materials[1])}]),source);
});

test('texture loads isolate wrapping and ignore an outdated diffuse or alpha load after a live edit',async t=>{
  const loaded=[];t.mock.method(THREE.TextureLoader.prototype,'loadAsync',async url=>{loaded.push(url);const texture=new THREE.Texture();texture.name=url;return texture;});
  const view=Object.create(Viewport.prototype);view.materials=new Set();view.textures=new Set();view.disposed=false;
  const original={flags:0x40048000,texture:'old.bmp',alphaTexture:'mask.bmp',opacity:1,diffuse:[1,1,1],emission:[0,0,0]};
  const add=(index,flags=original.flags)=>{const material=new THREE.MeshStandardMaterial();Object.assign(material.userData,{source:{...original,flags},texture:original.texture,alpha:{alphaTexture:original.alphaTexture},materialIndex:index,modelKey:''});view.materials.add(material);return material;};
  const material=add(0),clamped=add(1,original.flags|0x10000);
  await view.loadTextures(async name=>name);assert.equal(material.map.wrapS,THREE.RepeatWrapping);assert.equal(clamped.map.wrapS,THREE.ClampToEdgeWrapping);assert.notEqual(material.map,clamped.map);assert.equal(material.alphaMap.wrapS,THREE.RepeatWrapping);assert.equal(clamped.alphaMap.wrapS,THREE.ClampToEdgeWrapping);
  const unchangedMap=clamped.map,unchangedMask=clamped.alphaMap;
  loaded.length=0;let resume;const slow=view.loadTextures(name=>name==='mask.bmp'?new Promise(resolve=>{resume=resolve;}):name,{index:0});
  // Wait for the old mask request, after its diffuse texture has been assigned.
  while(!resume)await Promise.resolve();
  assert.equal(view.updateMaterial(0,{...original,flags:0x40000,texture:'new.bmp',alphaTexture:''}),true);
  await view.loadTextures(async name=>name,{index:0});const latest=material.map;
  resume('mask.bmp');await slow;assert.equal(material.map,latest);assert.equal(material.map.name,'new.bmp');assert.equal(material.alphaMap,null);assert.equal(clamped.map,unchangedMap);assert.equal(clamped.alphaMap,unchangedMask);
  let finish;const stale=view.loadTextures(()=>new Promise(resolve=>{finish=resolve;}),{index:0});
  view.updateMaterial(0,{...original,flags:0x40000,texture:'newest.bmp',alphaTexture:''});finish('new.bmp');await stale;assert.equal(material.map,null);
  assert.deepEqual(await view.loadTextures(async()=>null,{index:0}),['Chybí textura: newest.bmp']);
  for(const texture of view.textures)texture.dispose();for(const item of view.materials)item.dispose();
});

test('live material changes update every matching surface, preserve other models and invalidate only texture-dependent loads',()=>{
  const view=Object.create(Viewport.prototype);view.materials=new Set();view.textures=new Set();
  const original={flags:0,texture:'base.bmp',opacity:1,diffuse:[.2,.3,.4],emission:[0,0,0]};
  const add=key=>{const material=new THREE.MeshStandardMaterial();Object.assign(material.userData,{source:original,materialIndex:0,modelKey:key});material.map=new THREE.Texture();view.materials.add(material);return material;};
  const a=add(''),b=add(''),other=add('nested');
  assert.equal(view.updateMaterial(0,{...original,opacity:.5,emission:[.1,.2,.3]}),false);for(const m of [a,b]){assert.equal(m.opacity,.5);assert.equal(m.transparent,true);assert.equal(m.depthWrite,false);assert.deepEqual(m.emissive.toArray(),[.1,.2,.3]);assert.deepEqual(m.color.toArray(),[1,1,1]);}assert.equal(other.opacity,1);
  assert.equal(view.updateMaterial(0,{...original,flags:0x08000000}),false);assert.deepEqual(a.color.toArray(),original.diffuse);
  assert.equal(view.updateMaterial(0,{...original,flags:0x20018000,texture:'changed.bmp'}),true);assert.equal(a.map,null);assert.equal(a.alphaTest,.5);assert.equal(a.depthWrite,true);assert.equal(a.userData.revision,1);
  const texture=new THREE.Texture();view.applyTexture(a,texture);assert.equal(texture.wrapS,THREE.ClampToEdgeWrapping);assert.equal(texture.wrapT,THREE.RepeatWrapping);
  const draft=materialDraft(original,0,new Map([['materials/0/settings',{opacity:.2}],['materials/0/diffuse',[1,0,0]],['materials/1/opacity',.1]]));assert.equal(draft.opacity,.2);assert.deepEqual(draft.diffuse,[1,0,0]);
});

test('project material changes export, reopen and undo exact model bytes while checking the opened version',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'mafia-materials-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));await writeSafe(root,'workbench.json',JSON.stringify({format:'mafia-workbench',version:1,name:'Materials',assets:[],history:[]}));
  const p=await ModProject.open(root),source=fixture(),name='models/Model.4ds';await p.createFiles([{path:name,data:source}]);const history=p.manifest.history.length;
  await p.saveModel(name,[{id:'materials/0/settings',value:{flags:withMaterialAlphaMode(parseFourDs(source).materials[0].flags,'embedded'),opacity:.5}},{id:'meshes/0/position',value:[7,8,9]}],hash(source));
  const changed=await p.read(name),reopened=await ModProject.open(root);assert.deepEqual(await reopened.read(name),changed);assert.equal(parseFourDs(changed).materials[0].alphaTexture,undefined);
  await assert.rejects(p.saveModel(name,[{id:'materials/0/opacity',value:.1}],hash(source)),/změnil/);
  const destination=path.join(root,'export');await reopened.export(destination);assert.deepEqual(await fs.readFile(path.join(destination,name)),changed);
  await reopened.undo();assert.deepEqual(await reopened.read(name),source);assert.equal(reopened.manifest.history.length,history);
});
