import {deflateSync,crc32} from 'node:zlib';
export function pngChunk(type,data=Buffer.alloc(0)){
  const out=Buffer.alloc(data.length+12);out.writeUInt32BE(data.length);out.write(type,4,'latin1');data.copy(out,8);out.writeUInt32BE(crc32(out.subarray(4,-4)),out.length-4);return out;
}
const paeth=(a,b,c)=>{const p=a+b-c,d=[a,b,c].map(n=>Math.abs(p-n));return d[0]<=d[1]&&d[0]<=d[2]?a:d[1]<=d[2]?b:c;};
export function terrariumPng(height=()=>200,{channels=3,filter=y=>y%5,alpha=255,transform=chunks=>chunks}={}){
  const stride=256*channels,pixels=Buffer.alloc(stride*256),raw=Buffer.alloc((stride+1)*256),header=Buffer.alloc(13);header.writeUInt32BE(256);header.writeUInt32BE(256,4);header[8]=8;header[9]=channels===4?6:2;
  for(let y=0;y<256;y++)for(let x=0;x<256;x++){
    const n=Math.round((height(x,y)+32768)*256),i=y*stride+x*channels;pixels[i]=n>>>16;pixels[i+1]=n>>>8&255;pixels[i+2]=n&255;if(channels===4)pixels[i+3]=alpha;
  }
  for(let y=0;y<256;y++){
    const f=filter(y);raw[y*(stride+1)]=f;
    for(let x=0;x<stride;x++){
      const i=y*stride+x,a=x>=channels?pixels[i-channels]:0,b=y?pixels[i-stride]:0,c=y&&x>=channels?pixels[i-stride-channels]:0;
      raw[y*(stride+1)+x+1]=(pixels[i]-(f===0?0:f===1?a:f===2?b:f===3?Math.floor((a+b)/2):paeth(a,b,c)))&255;
    }
  }
  const compressed=deflateSync(raw),half=Math.floor(compressed.length/2);
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),...transform([pngChunk('IHDR',header),pngChunk('IDAT',compressed.subarray(0,half)),pngChunk('IDAT',compressed.subarray(half)),pngChunk('IEND')])]);
}
