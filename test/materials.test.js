import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {materialTransparency,bmpTransparency,maskTexturePixels} from '../src/ui/materials.js';

test('material transparency distinguishes colour-key cutouts, masks, embedded alpha and additive surfaces',()=>{
  const cutout=materialTransparency({flags:0x20008000,opacity:1,texture:'Tree.bmp'});
  assert.equal(cutout.transparent,false);assert.equal(cutout.depthWrite,true);assert.equal(cutout.alphaTest,.5);assert.equal(cutout.alphaTexture,null);
  assert.equal(materialTransparency({flags:0x20008000,opacity:.2}).alphaTest,.1);
  const mask=materialTransparency({flags:0x40008000,texture:'Window.bmp',alphaTexture:'WindowMask.bmp'});assert.equal(mask.alphaTexture,'WindowMask.bmp');assert.equal(mask.transparent,true);assert.equal(mask.depthWrite,false);
  assert.equal(materialTransparency({flags:0x8000,texture:'Window.BMP'}).alphaTexture,'Window+.BMP');
  assert.equal(materialTransparency({flags:0x41008000,texture:'Window.bmp'}).inTexture,true);assert.equal(materialTransparency({flags:0x41008000}).alphaTexture,null);
  const additive=materialTransparency({flags:0x80008000});assert.equal(additive.blending,THREE.AdditiveBlending);assert.equal(additive.depthWrite,false);
  assert.equal(materialTransparency({flags:0,opacity:1}).transparent,false);assert.equal(materialTransparency({opacity:.5}).transparent,true);
});
test('BMP key comes from palette entry zero rather than a guessed background colour',()=>{
  const bytes=Buffer.alloc(62);bytes.write('BM');bytes.writeUInt32LE(58,10);bytes.writeUInt32LE(40,14);bytes.writeUInt16LE(8,28);bytes.set([37,73,109,0],54);
  assert.deepEqual(bmpTransparency(bytes).key,[109,73,37]);
  const pixels=new Uint8ClampedArray([109,73,37,255,0,255,0,255,110,73,37,255]),before=new Uint8ClampedArray(pixels);
  assert.deepEqual([...maskTexturePixels(pixels,[109,73,37])],[109,73,37,0,0,255,0,255,110,73,37,255]);assert.deepEqual(pixels,before);
  assert.equal(bmpTransparency(bytes.subarray(0,54)).key,null);assert.equal(bmpTransparency(Buffer.alloc(3)),null);
  bytes.writeUInt16LE(24,28);assert.equal(bmpTransparency(bytes).key,null);
});
test('32-bit BMP alpha follows top/bottom row direction and never reads truncated pixels',()=>{
  const bytes=Buffer.alloc(62);bytes.write('BM');bytes.writeUInt32LE(54,10);bytes.writeUInt32LE(40,14);bytes.writeInt32LE(1,18);bytes.writeInt32LE(2,22);bytes.writeUInt16LE(32,28);bytes[57]=20;bytes[61]=200;
  assert.deepEqual([...bmpTransparency(bytes).alpha],[200,20]);bytes.writeInt32LE(-2,22);assert.deepEqual([...bmpTransparency(bytes).alpha],[20,200]);assert.equal(bmpTransparency(bytes.subarray(0,58)).alpha,null);
  assert.deepEqual([...maskTexturePixels([1,2,3,255,4,5,6,255],null,new Uint8Array([20,200]))],[1,2,3,20,4,5,6,200]);
});
