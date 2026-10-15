import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { parseFourDs, editFourDs } from '../src/core/fourds.js';
import { textureSequence, textureFrame } from '../src/ui/texture-animation.js';
import { ParticleViewport } from '../src/ui/particle-preview.js';
import { materialTransparency } from '../src/ui/materials.js';

const source = (texture='FLAME1_0000.BMP', flags=0x86048001) => ({texture,flags,diffuse:[1,1,1],opacity:1,animation:{frames:5,delay:180,unknown:0,unknown2:0,unknown3:0}});

test('animation metadata is read without exposing edits or changing any opaque material bytes',()=>{
  const b=Buffer.alloc(16+44+1+15+18+3);b.write('4DS\0');b.writeUInt16LE(29,4);b.writeUInt16LE(1,14);b.writeUInt32LE(0x04000000,16);b.writeFloatLE(1,56);b[60]=15;b.write('FLAME1_0000.BMP ',61);const at=76;
  b.writeUInt32LE(5,at);b.writeUInt16LE(123,at+4);b.writeUInt32LE(180,at+6);b.writeUInt32LE(456,at+10);b.writeUInt32LE(789,at+14);
  const p=parseFourDs(b,true);assert.deepEqual(p.materials[0].animation,{frames:5,delay:180,unknown:123,unknown2:456,unknown3:789});assert.equal(p.materials[0].layout.animationLength,18);
  assert.ok(p.entries.every(e=>!e.id.includes('animation')));assert.deepEqual(editFourDs(b,p.entries.map(({id,value})=>({id,value}))),b);
  const changed=editFourDs(b,[{id:'materials/0/opacity',value:.5}]);assert.deepEqual(changed.subarray(at),b.subarray(at));
  assert.throws(()=>parseFourDs(b.subarray(0,at+17)),/mimo soubor/);
});

test('numeric suffixes retain padding, extension, first index and a bounded reproducible millisecond cycle',()=>{
  const s=textureSequence(source());assert.deepEqual(s.names,['FLAME1_0000.BMP','FLAME1_0001.BMP','FLAME1_0002.BMP','FLAME1_0003.BMP','FLAME1_0004.BMP']);
  assert.deepEqual([0,179,180,899,900,1080,0].map(t=>textureFrame(s,t)),[0,0,1,4,0,1,0]);
  assert.equal(textureSequence({...source('folder/Fire001.bmp'),animation:{...source().animation,frames:2}}).names[1],'folder/Fire002.bmp');
  assert.equal(textureSequence({flags:0}),null);
  for(const patch of [{frames:0},{frames:129},{frames:1.5},{delay:0},{delay:null},{unknown:1},{unknown2:1},{unknown3:1}])assert.throws(()=>textureSequence({...source(),animation:{...source().animation,...patch}}),/Nepodporovaná/);
  for(const name of ['flame.bmp','frame0000000.bmp','frame9.bmp'])assert.throws(()=>textureSequence(source(name)),/textur/);
});

function viewOf(materials) {
  const view=Object.create(ParticleViewport.prototype);Object.assign(view,{materials:new Set(materials),textures:new Set(),textureWarnings:['base warning']});return view;
}
function material(s) {
  const m=new THREE.MeshBasicMaterial();Object.assign(m.userData,{texture:s.texture,source:s,alpha:materialTransparency(s)});m.map=new THREE.Texture();return m;
}

test('animation frames reuse BMP/mask/wrap loading, keep source maps intact and reject a missing frame as one complete sequence',async()=>{
  const original=THREE.TextureLoader.prototype.loadAsync,requested=[];THREE.TextureLoader.prototype.loadAsync=async url=>{requested.push(url);return new THREE.Texture();};
  const a=material(source()),b=material({...source('MASKED00.bmp',0x44058000),alphaTexture:'mask.bmp',animation:{...source().animation,frames:2}}),view=viewOf([a,b]);
  b.alphaMap=new THREE.Texture();const base=a.map;
  try {
    await view.loadTextureAnimations(async name=>name==='FLAME1_0003.BMP'?null:name);
    assert.equal(view.textureAnimations.has(a),false);assert.ok(view.textureWarnings.some(w=>w.includes('Neúplná')));assert.ok(view.textureWarnings.includes('base warning'));
    const sequence=view.textureAnimations.get(b);assert.equal(sequence.frames.length,2);assert.equal(sequence.frames[0].map,b.map);assert.equal(sequence.frames[1].map.wrapS,THREE.ClampToEdgeWrapping);assert.ok(sequence.frames[1].alphaMap);assert.equal(sequence.frames[1].alphaMap.colorSpace,THREE.NoColorSpace);
    assert.equal(a.map,base);assert.equal(view.materials.size,2);assert.ok(requested.includes('MASKED01.bmp'));assert.ok(requested.includes('mask.bmp'));
  } finally {THREE.TextureLoader.prototype.loadAsync=original;for(const m of view.materials)m.dispose();for(const t of view.textures)t.dispose();}
});

test('closing during frame load discards the result and releases late textures',async()=>{
  const original=THREE.TextureLoader.prototype.loadAsync,a=material({...source(),animation:{...source().animation,frames:2}}),view=viewOf([a]);let resume,disposed=0;
  THREE.TextureLoader.prototype.loadAsync=()=>new Promise(resolve=>{resume=()=>{const t=new THREE.Texture();t.addEventListener('dispose',()=>disposed++);resolve(t);};});
  try {const loading=view.loadTextureAnimations(async name=>name);while(!resume)await new Promise(resolve=>setImmediate(resolve));view.disposed=true;resume();await loading;assert.equal(view.textureAnimations.size,0);assert.equal(disposed,1);}finally{THREE.TextureLoader.prototype.loadAsync=original;a.dispose();}
});
