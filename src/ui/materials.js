import * as THREE from 'three';

export function materialTransparency(source = {}) {
  const flags=source.flags??0, colorKey=Boolean(flags&0x20000000), additive=Boolean(flags&0x80000000);
  const alpha=Boolean(flags&0x8000), inTexture=alpha&&Boolean(flags&0x01000000);
  let alphaTexture=alpha&&!inTexture&&!colorKey&&!additive?source.alphaTexture:null;
  // LS3D can look up an implicit mask with '+' before the extension.
  if(alpha&&!inTexture&&!colorKey&&!additive&&!alphaTexture&&source.texture)alphaTexture=source.texture.replace(/(\.[^./\\]+)$/,'+$1');
  const transparent=(source.opacity??1)<1||additive||(!colorKey&&alpha&&(inTexture||Boolean(alphaTexture)));
  return {colorKey,inTexture,alphaTexture,transparent,alphaTest:colorKey?Math.max(0,source.opacity??1)*.5:0,depthWrite:!transparent,blending:additive?THREE.AdditiveBlending:THREE.NormalBlending};
}

// Palette entry zero is LS3D's BMP colour key, even when it isn't black/green.
// Preserve stored alpha from uncompressed 32-bit BMPs that browser decoders may drop.
export function bmpTransparency(bytes) {
  const view=new DataView(bytes.buffer??bytes,bytes.byteOffset??0,bytes.byteLength);
  if(view.byteLength<30||view.getUint16(0,true)!==0x4d42)return null;
  const header=view.getUint32(14,true),core=header===12;
  if((!core&&header<40)||14+header>view.byteLength)return null;
  const bits=view.getUint16(core?24:28,true),palette=14+header,offset=view.getUint32(10,true);
  const key=[1,4,8].includes(bits)&&palette+(core?3:4)<=offset&&offset<=view.byteLength?[view.getUint8(palette+2),view.getUint8(palette+1),view.getUint8(palette)]:null;
  let alpha=null,width,height;
  if(!core&&bits===32&&view.getUint32(30,true)===0){
    width=view.getInt32(18,true);const signedHeight=view.getInt32(22,true);height=Math.abs(signedHeight);
    if(width>0&&height>0&&width*height<=16*1024*1024&&offset>=14+header&&offset+width*height*4<=view.byteLength){
      alpha=new Uint8Array(width*height);
      for(let y=0;y<height;y++)for(let x=0;x<width;x++)alpha[y*width+x]=view.getUint8(offset+((signedHeight>0?height-1-y:y)*width+x)*4+3);
    }
  }
  return {key,alpha,width,height};
}
export function maskTexturePixels(pixels,key=null,alpha=null) {
  const result=new Uint8ClampedArray(pixels);
  for(let i=0;i<result.length;i+=4){
    if(alpha)result[i+3]=alpha[i/4];
    if(key&&result[i]===key[0]&&result[i+1]===key[1]&&result[i+2]===key[2])result[i+3]=0;
  }
  return result;
}
export function textureWithMask(texture,metadata,{colorKey,inTexture}) {
  const image=texture.image,canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
  const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);
  const pixels=ctx.getImageData(0,0,canvas.width,canvas.height),alpha=inTexture&&metadata?.width===canvas.width&&metadata?.height===canvas.height?metadata.alpha:null;
  pixels.data.set(maskTexturePixels(pixels.data,colorKey?metadata?.key:null,alpha));ctx.putImageData(pixels,0,0);
  const result=new THREE.CanvasTexture(canvas);result.flipY=texture.flipY;return result;
}
