// The PC speech channel formats the TextDB ID as signed decimal, padded to eight
// digits, and reads sounds/%08d.wav. Import emits a plain mono PCM16 WAVE, without
// resampling or changing the source file. Stereo is explicitly averaged.
export function dialogueSoundPath(id) {
  if (!Number.isSafeInteger(id) || id < 0 || id > 0x7fffffff) throw new Error('Dabing: ID musí být celé číslo 0–2147483647.');
  return `sounds/${String(id).padStart(8,'0')}.wav`;
}
export function prepareDialogueWav(source) {
  const bytes=Buffer.from(source);
  if(bytes.length<44||bytes.length>64*1024*1024||bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WAVE'||bytes.readUInt32LE(4)+8!==bytes.length)throw new Error('Dabing: neplatný nebo příliš velký RIFF/WAVE soubor (maximum 64 MiB).');
  let fmt,data;
  for(let offset=12;offset<bytes.length;){
    if(offset+8>bytes.length)throw new Error('Dabing: neúplná WAV hlavička.');
    const name=bytes.toString('ascii',offset,offset+4),size=bytes.readUInt32LE(offset+4),end=offset+8+size,next=end+(size%2);
    if(next>bytes.length)throw new Error('Dabing: neúplný WAV blok.');
    if(name==='fmt '){if(fmt)throw new Error('Dabing: WAV má více formátových bloků.');fmt=bytes.subarray(offset+8,end);}
    if(name==='data'){if(data)throw new Error('Dabing: WAV má více zvukových bloků.');data=bytes.subarray(offset+8,end);}
    offset=next;
  }
  if(!fmt||fmt.length<16||!data?.length)throw new Error('Dabing: WAV nemá formát nebo zvuková data.');
  let format=fmt.readUInt16LE(0);const channels=fmt.readUInt16LE(2),sampleRate=fmt.readUInt32LE(4),byteRate=fmt.readUInt32LE(8),align=fmt.readUInt16LE(12),bits=fmt.readUInt16LE(14);
  if(format===0xfffe){
    if(fmt.length<40||fmt.readUInt16LE(16)<22||fmt.length<18+fmt.readUInt16LE(16)||fmt.readUInt16LE(18)!==bits)throw new Error('Dabing: nepodporovaný rozšířený WAV formát.');
    const guid=fmt.subarray(24,40).toString('hex');
    format=guid==='0100000000001000800000aa00389b71'?1:guid==='0300000000001000800000aa00389b71'?3:0;
  }else if(fmt.length!==16&&(fmt.length<18||fmt.length<18+fmt.readUInt16LE(16)))throw new Error('Dabing: poškozený WAV formát.');
  if(![1,2].includes(channels)||sampleRate<8000||sampleRate>96000||!((format===1&&[8,16,24,32].includes(bits))||(format===3&&[32,64].includes(bits))))throw new Error('Dabing: vyberte mono/stereo WAV PCM 8/16/24/32 bit nebo float 32/64 bit, 8–96 kHz. Komprimované WAV a vícekanálový zvuk nejsou podporované.');
  const width=bits/8;
  if(align!==channels*width||byteRate!==sampleRate*align||data.length%align)throw new Error('Dabing: WAV má neplatné zarovnání vzorků.');
  const samples=data.length/align,output=Buffer.alloc(44+samples*2);let clipped=0;
  output.write('RIFF');output.writeUInt32LE(output.length-8,4);output.write('WAVEfmt ',8);output.writeUInt32LE(16,16);output.writeUInt16LE(1,20);output.writeUInt16LE(1,22);output.writeUInt32LE(sampleRate,24);output.writeUInt32LE(sampleRate*2,28);output.writeUInt16LE(2,32);output.writeUInt16LE(16,34);output.write('data',36);output.writeUInt32LE(samples*2,40);
  for(let index=0;index<samples;index++){
    let value=0;
    for(let channel=0;channel<channels;channel++){
      const offset=index*align+channel*width;
      const sample=format===3?(bits===32?data.readFloatLE(offset):data.readDoubleLE(offset)):bits===8?(data[offset]-128)/128:data.readIntLE(offset,width)/(2**(bits-1));
      if(!Number.isFinite(sample))throw new Error('Dabing: nahrávka obsahuje NaN nebo nekonečný vzorek.');
      value+=sample/channels;
    }
    if(value < -1||value>1)clipped++;
    output.writeInt16LE(Math.max(-32768,Math.min(32767,Math.round(value*32768))),44+index*2);
  }
  return {bytes:output,info:{sourceFormat:format===1?'PCM':'float',sourceBits:bits,sourceChannels:channels,sampleRate,samples,duration:samples/sampleRate,clipped,outputSize:output.length,channels:1,bits:16}};
}
