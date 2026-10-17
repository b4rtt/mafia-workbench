import {inflateSync} from 'node:zlib';

const fail=()=>{throw Error('OpenStreetMap · výšky: neplatná nebo nepodporovaná Terrarium PNG dlaždice.');};
const table=Uint32Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
const crc=bytes=>{let c=0xffffffff;for(const b of bytes)c=table[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0;};
const paeth=(a,b,c)=>{const p=a+b-c,x=Math.abs(p-a),y=Math.abs(p-b),z=Math.abs(p-c);return x<=y&&x<=z?a:y<=z?b:c;};
// Numeric decoding deliberately avoids colour management, canvas and image codecs.
// Only the provider's 256 px, 8-bit RGB/RGBA, non-interlaced subset is accepted.
export function decodeTerrariumPng(bytes){
  if(!Buffer.isBuffer(bytes)||bytes.length>1024*1024||bytes.length<57||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))fail();
  let at=8,channels=0,ended=false,idat=false,afterIdat=false,count=0;const parts=[];
  while(at<bytes.length){
    if(++count>1024||at+12>bytes.length)fail();
    const length=bytes.readUInt32BE(at),end=at+12+length;if(end>bytes.length)fail();
    const type=bytes.toString('latin1',at+4,at+8),data=bytes.subarray(at+8,end-4);
    if(!/^[A-Za-z]{4}$/.test(type)||crc(bytes.subarray(at+4,end-4))!==bytes.readUInt32BE(end-4))fail();
    if(count===1&&type!=='IHDR')fail();
    if(type==='IHDR'){
      if(count!==1||length!==13||data.readUInt32BE(0)!==256||data.readUInt32BE(4)!==256||data[8]!==8||![2,6].includes(data[9])||data[10]||data[11]||data[12])fail();channels=data[9]===2?3:4;
    }else if(type==='IDAT'){
      if(afterIdat||!channels)fail();idat=true;parts.push(data);
    }else if(type==='IEND'){
      if(length||!idat||end!==bytes.length)fail();ended=true;
    }else{
      // Transparency chunks change RGB meaning; APNG and unknown critical chunks
      // must not silently become a valid terrain source. Ancillary colour/text
      // chunks are ignored after CRC verification, never applied to numeric RGB.
      if(type==='tRNS'||['acTL','fcTL','fdAT'].includes(type)||type[0]===type[0].toUpperCase())fail();
      if(idat)afterIdat=true;
    }
    at=end;
  }
  if(!ended)fail();
  const stride=256*channels,expected=(stride+1)*256,compressed=Buffer.concat(parts);let raw;
  try{const result=inflateSync(compressed,{maxOutputLength:expected,info:true});if(result.buffer.length!==expected||result.engine.bytesWritten!==compressed.length)fail();raw=result.buffer;}catch{fail();}
  const pixels=Buffer.alloc(stride*256),samples=new Float64Array(256*256);
  for(let y=0;y<256;y++){
    const start=y*(stride+1),filter=raw[start];if(filter>4)fail();
    for(let x=0;x<stride;x++){
      const i=y*stride+x,a=x>=channels?pixels[i-channels]:0,b=y?pixels[i-stride]:0,c=y&&x>=channels?pixels[i-stride-channels]:0;
      pixels[i]=(raw[start+x+1]+(filter===0?0:filter===1?a:filter===2?b:filter===3?Math.floor((a+b)/2):paeth(a,b,c)))&255;
    }
    for(let x=0;x<256;x++){
      const i=y*stride+x*channels,n=pixels[i]*256+pixels[i+1]+pixels[i+2]/256-32768;
      if(channels===4&&pixels[i+3]!==255||n < -12000||n>9000)fail();samples[y*256+x]=n;
    }
  }
  return samples;
}
