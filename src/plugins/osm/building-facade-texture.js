import {parseBmp} from '../../core/bmp.js';
import {osmFacadeRecipe} from './building-facades.js';

// A mirrored, window-free swatch makes a small seamless power-of-two BMP for
// the native renderer. Derive it locally from the hash-checked facade source.
export function osmFacadeTexture(source,style){
  const bitmap=parseBmp(source),[u0,v0,u1,v1]=osmFacadeRecipe(style).swatch,size=32,stride=size*3,bytes=Buffer.alloc(54+stride*size);
  bytes.write('BM');bytes.writeUInt32LE(bytes.length,2);bytes.writeUInt32LE(54,10);bytes.writeUInt32LE(40,14);bytes.writeInt32LE(size,18);bytes.writeInt32LE(size,22);bytes.writeUInt16LE(1,26);bytes.writeUInt16LE(24,28);bytes.writeUInt32LE(stride*size,34);
  const reflect=n=>1-Math.abs(2*n-1),color=(x,y)=>{const i=y*bitmap.width+x;return bitmap.bits===8?bitmap.palette[bitmap.pixels[i]]:Array.from(bitmap.pixels.slice(i*bitmap.channels,i*bitmap.channels+3));};
  const left=Math.min(bitmap.width-1,Math.floor(u0*bitmap.width)),right=Math.max(left,Math.min(bitmap.width-1,Math.ceil(u1*bitmap.width)-1)),top=Math.min(bitmap.height-1,Math.floor(v0*bitmap.height)),bottom=Math.max(top,Math.min(bitmap.height-1,Math.ceil(v1*bitmap.height)-1));
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const sx=left+reflect(x/(size-1))*(right-left),sy=top+reflect(y/(size-1))*(bottom-top),ix=Math.floor(sx),iy=Math.floor(sy),tx=sx-ix,ty=sy-iy,c=[color(ix,iy),color(Math.min(right,ix+1),iy),color(ix,Math.min(bottom,iy+1)),color(Math.min(right,ix+1),Math.min(bottom,iy+1))],at=54+(size-1-y)*stride+x*3;
    for(let k=0;k<3;k++)bytes[at+2-k]=Math.round((c[0][k]*(1-tx)+c[1][k]*tx)*(1-ty)+(c[2][k]*(1-tx)+c[3][k]*tx)*ty);
  }
  return bytes;
}
