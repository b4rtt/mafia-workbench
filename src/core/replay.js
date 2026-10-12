import iconv from 'iconv-lite';

// Own REP layout, checked against recorder_load_replay_file (005427f0),
// recorder_names_read_dta and recorder_replay_state_read. Counts/layout stay fixed.
function layout(source) {
  const bytes = Buffer.from(source), entries = [], fields = new Map(), tracks = [], warnings = [];
  if (bytes.length < 104 || bytes.readUInt32LE(0) !== 0x1631) throw new Error('REP: nepodporovaná hlavička.');
  const h = Array.from({length:9},(_,i)=>bytes.readUInt32LE(i*4)), nameCount = bytes.readUInt32LE(96);
  if (nameCount > 100000 || h[3] > 100000 || h[5] > 100000 || h[6] > 100000 || h[1] !== 8+nameCount*52) throw new Error('REP: neplatné počty nebo tabulka animací.');
  const objectsOffset = 96+h[1], arenaOffset = objectsOffset+h[3]*108, cameraOffset = arenaOffset+h[2], eventsOffset = cameraOffset+h[5]*64+h[6]*56, stateOffset = eventsOffset+h[7], end = stateOffset+h[8];
  if (end > bytes.length) throw new Error('REP: bloky překračují konec souboru.');
  let duration = 0, keyCount = 0, opaqueKeyBytes = 0;
  const channels = [];
  const channel = (id,label) => { const c={id,label,records:[]}; channels.push(c); return c; };
  const record = (c,index,time,label) => { const r={index,time,label,prefix:`${c.id}/${index}/`};c.records.push(r);duration=Math.max(duration,time);return r; };
  const text = (offset,length) => { const data=bytes.subarray(offset,offset+length),zero=data.indexOf(0);return iconv.decode(zero<0?data:data.subarray(0,zero),'windows-1250'); };
  const field = (r,key,label,kind,offset,count=1) => {
    const value = kind === 'string' ? text(offset,count) : kind === 'uint' ? bytes.readUInt32LE(offset) : Array.from({length:count},(_,i)=>bytes.readFloatLE(offset+i*4));
    if (Array.isArray(value)&&value.some(n=>!Number.isFinite(n))) throw new Error('REP: neplatná číselná vlastnost.');
    const entry={id:r.prefix+key,label,kind,value:kind==='float'?value[0]:value,context:`${r.label} · ${r.time} ms`};
    entries.push(entry); fields.set(entry.id,{entry,offset,count});if(entries.length>1000000)throw new Error('REP: příliš mnoho vlastností.');
    return entry.value;
  };
  const animations=channel('animations','Animace');
  for(let i=0;i<nameCount;i++){const offset=104+i*52,id=bytes.readUInt32LE(offset),r=record(animations,i,0,`Animace ${id}`);field(r,'name','Soubor animace','string',offset+4,48);r.animationId=id;}
  let arenaCursor=0;
  for(let i=0;i<h[3];i++) {
    const s=objectsOffset+i*108,size=bytes.readUInt32LE(s+100),offset=bytes.readUInt32LE(s+104),kind=bytes.readUInt32LE(s+96),strides=Array.from({length:4},(_,j)=>bytes.readUInt32LE(s+72+j*4));
    if(offset!==arenaCursor||size<8||arenaCursor+size>h[2]||strides[0]!==8)throw new Error('REP: neplatná oblast klíčů.');
    const name=text(s,36),trackName=text(s+36,36),c=channel(`objects/${i}`,`${name || trackName} · ${trackName}`),track={index:i,name,trackName,kind,lastKeyTime:bytes.readUInt32LE(s+92),keys:[],strides};tracks.push(track);
    let cursor=8,previous=-1;
    while(cursor<size) {
      if(cursor+8>size||keyCount++>1000000)throw new Error('REP: neúplná hlavička klíče.');
      const k=arenaOffset+arenaCursor+cursor,time=bytes.readUInt32LE(k),type=bytes.readUInt32LE(k+4),stride=strides[type];
      if(type>3||!stride||stride<8||cursor+stride>size)throw new Error('REP: nepodporovaná délka klíče.');
      const index=track.keys.length,r=record(c,index,time,`${trackName} / klíč ${index}`),key={index,time,type,bytes:stride};
      if(time<previous)warnings.push(`${trackName}: klíče nejsou seřazené podle času; pořadí se zachová.`);previous=time;
      // Common pose prefix proven in the actor, human and car playback methods.
      if([1,2,3,4,6,27].includes(kind)&&([1,2].includes(type)||([2,3,27].includes(kind)&&type===3))&&stride>=36) {
        key.position=field(r,'position','Pozice XYZ','vec3',k+8,3);key.rotation=field(r,'rotation','Rotace WXYZ','quat',k+20,4);opaqueKeyBytes+=stride-36;
      } else opaqueKeyBytes+=stride-8;
      track.keys.push(key);cursor+=stride;
    }
    arenaCursor+=size;
  }
  if(arenaCursor!==h[2])throw new Error('REP: nesoulad délky oblasti klíčů.');
  const cameraChannels=[];
  for(const [id,label,count,stride,start] of [['camera','Kamera',h[5],64,cameraOffset],['focus','Cíl kamery',h[6],56,cameraOffset+h[5]*64]]) {
    const c=channel(id,label),keys=[];cameraChannels.push({id,keys});
    for(let i=0;i<count;i++) {
      const s=start+i*stride,time=bytes.readUInt32LE(s),r=record(c,i,time,`${label} / klíč ${i}`),key={index:i,time,curveTime:bytes.readUInt32LE(s+4),flags:bytes.readUInt32LE(s+8)};
      if(id==='camera'&&bytes.readFloatLE(s+52)===666){key.stop=true;key.fov=666;r.label='Konec přehrávání kamery';keys.push(key);continue;}
      if(key.flags===2){if(i+2>=count||bytes.readUInt32LE(s+stride+8)!==4||bytes.readUInt32LE(s+stride*2+8)!==8)throw new Error('REP: střih nemá dvojici kamerových poloh.');key.cut=true;r.label=`${label} / střih ${i}`;keys.push(key);continue;}
      key.position=field(r,'position','Pozice XYZ','vec3',s+12,3);key.tangentOut=field(r,'tangentOut','Odchozí tangenta XYZ','vec3',s+24,3);key.tangentIn=field(r,'tangentIn','Příchozí tangenta XYZ','vec3',s+36,3);
      if(id==='camera'){key.roll=field(r,'roll','Náklon kamery (radiány)','float',s+48);key.fov=field(r,'fov','FOV (radiány)','float',s+52);}
      keys.push(key);
    }
  }
  const events={scripts:[],sounds:[],dialogues:[],subtitles:[],morphs:[]};
  let clockCount=0,fadeCount=0;
  if(h[7]) {
    if(h[7]<16)throw new Error('REP: neúplná sekce událostí.');
    const sizes=Array.from({length:4},(_,i)=>bytes.readUInt32LE(eventsOffset+i*4));
    if(16+sizes.reduce((a,b)=>a+b,0)!==h[7]||sizes.some((n,i)=>n%[12,32,40,40][i]))throw new Error('REP: neplatné délky událostí.');
    clockCount=sizes[0]/12;fadeCount=sizes[1]/32;let cursor=eventsOffset+16+sizes[0]+sizes[1];
    for(const [id,label,size] of [['scripts','Skriptové události',sizes[2]],['sounds','Zvukové události',sizes[3]]]) {
      const c=channel(id,label);
      for(let i=0;i<size/40;i++) {const s=cursor+i*40,time=bytes.readUInt32LE(s),r=record(c,i,time,`${label} / ${i}`),event={index:i,time,name:field(r,'name',id==='scripts'?'Název skriptu CHG':'Název zvukového objektu CHG','string',s+(id==='scripts'?4:8),id==='scripts'?36:32)};field(r,'time','Čas události (ms)','uint',s);if(id==='sounds')event.state=bytes.readUInt32LE(s+4);events[id].push(event);}
      cursor+=size;
    }
  }
  if(h[8]) {
    if(h[8]<12)throw new Error('REP: neúplný stav přehrávání.');
    const counts=Array.from({length:3},(_,i)=>bytes.readUInt32LE(stateOffset+i*4));
    if(12+counts[0]*36+counts[1]*12+counts[2]*44!==h[8])throw new Error('REP: neplatná délka stavu přehrávání.');
    let cursor=stateOffset+12;
    for(const [id,label,count,stride] of [['dialogues','Dialogy a vazby mluvčích',counts[0],36],['subtitles','Titulky',counts[1],12],['morphs','Morfování',counts[2],44]]) {
      const c=channel(id,label);
      for(let i=0;i<count;i++) {
        const s=cursor+i*stride,time=bytes.readUInt32LE(s),r=record(c,i,time,`${label} / ${i}`),event={index:i,time};
        if(id==='dialogues'){event.character=bytes.readUInt32LE(s+4);event.textId=bytes.readUInt32LE(s+8);event.command=event.textId<2||event.textId>0xfffffffc;if(!event.command)field(r,'textId','ID dialogu / textu','uint',s+8);field(r,'time','Čas události (ms)','uint',s);event.name=text(s+12,24);}
        if(id==='subtitles'){event.character=bytes.readUInt32LE(s+4);event.textId=bytes.readUInt32LE(s+8);}
        if(id==='morphs'){event.end=bytes.readUInt32LE(s+4);event.name=text(s+8,32);duration=Math.max(duration,event.end);}
        events[id].push(event);
      }
      cursor+=count*stride;
    }
  }
  return {bytes,fields,entries,channels,tracks,cameras:cameraChannels[0].keys,focus:cameraChannels[1].keys,events,duration,keyCount,clockCount,fadeCount,opaqueKeyBytes,tailBytes:bytes.length-end,warnings};
}
export function inspectReplay(source) {const {bytes,fields,...file}=layout(source);return file;}
export function editReplay(source,changes) {
  const file=layout(source),result=Buffer.from(file.bytes),seen=new Set();
  if(!Array.isArray(changes)||changes.length>4096)throw new Error('REP: neplatné změny.');
  for(const change of changes) {
    const field=file.fields.get(change?.id);if(!field||seen.has(change.id))throw new Error('REP: neznámá nebo opakovaná vlastnost.');seen.add(change.id);
    const {entry,offset,count}=field,value=change.value;
    if(entry.kind==='string') {
      if(typeof value!=='string'||value.includes('\0'))throw new Error('REP: neplatný text.');if(value===entry.value)continue;
      const encoded=iconv.encode(value,'windows-1250');if(encoded.length>=count||iconv.decode(encoded,'windows-1250')!==value)throw new Error('REP: text je příliš dlouhý nebo jej nelze zapsat.');
      encoded.copy(result,offset);result[offset+encoded.length]=0; // Preserve padding beyond the new terminator.
    } else {
      const values=Array.isArray(entry.value)?value:[value];if(!Array.isArray(values)||values.length!==count||values.some(n=>typeof n!=='number'||!Number.isFinite(n)||(entry.kind==='uint'? !Number.isInteger(n)||n<0||n>0xffffffff : !Number.isFinite(Math.fround(n)))))throw new Error('REP: neplatná číselná hodnota.');
      if(entry.kind==='quat'&&!values.some(n=>Math.fround(n)!==0))throw new Error('REP: nulová rotace.');
      if(entry.id.endsWith('/fov')&&value!==entry.value&&(value<=0||value>=Math.PI))throw new Error('REP: FOV musí být mezi 0 a π radiány.');
      if(entry.id.endsWith('/textId')&&(value<2||value>0xfffffffc))throw new Error('REP: ID dialogu nesmí změnit událost na příkaz vazby mluvčího.');
      const before=Array.isArray(entry.value)?entry.value:[entry.value];values.forEach((n,i)=>{if(n!==before[i])entry.kind==='uint'?result.writeUInt32LE(n,offset+i*4):result.writeFloatLE(n,offset+i*4);});
    }
  }
  const timedChannels=new Set(changes.filter(c=>c.id.endsWith('/time')).map(c=>c.id.split('/')[0]));
  if(timedChannels.size)for(const channel of layout(result).channels.filter(c=>timedChannels.has(c.id))) {
    if(channel.records.some((r,i)=>i&&r.time<channel.records[i-1].time))throw new Error('REP: časy událostí musí zachovat pořadí.');
  }
  return result;
}
