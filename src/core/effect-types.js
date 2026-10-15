import iconv from 'iconv-lite';

// PC loaders: particle_manager_load_data (0x5a3da0),
// particle_data_type_load_data (0x5a6490). Destinations are definition offsets,
// not runtime offsets. Later chunks can overwrite just the first vector component.
const fail = message => { throw new Error('Definice efektů: ' + message); };
const scalar = (key, label, target, kind = 'float', limits = {}) => ({key, label, target, kind, ...limits});
const vector = (key, label, target) => ({key, label, target, kind:'vec3'});
const schemas = {
  100: [scalar('name','Název efektu',8,'string'), scalar('model','Model částic',52,'string'),
    vector('vector1','Původní vektor definice 1',28), vector('vector2','Původní vektor definice 2',40),
    scalar('rotateDirection','Otáčet směr podle rodiče',56,'boolean'), scalar('rotatePosition','Otáčet pozici podle rodiče',57,'boolean')],
  101: [scalar('name','Název emitoru',8,'string'), scalar('frame','Část modelu částic',28,'string'),
    vector('position','Místní pozice',32), vector('positionSpread','Rozptyl pozice',44),
    vector('direction','Počáteční směr',56), vector('directionSpread','Rozptyl směru',68),
    scalar('speed','Počáteční rychlost',80), scalar('speedSpread','Rozptyl rychlosti',84),
    vector('scale','Počáteční měřítko XYZ',88), vector('scaleSpread','Rozptyl měřítka XYZ',100),
    scalar('alpha','Počáteční neprůhlednost',112,'float',{min:0,max:1}), scalar('alphaSpread','Rozptyl neprůhlednosti',116,'float',{min:0}),
    scalar('lifetime','Doba emitoru (ms)',120,'float',{min:0}), scalar('burst','Počet částic při startu',124,'int',{min:0}),
    scalar('decay','Interval emise – původní hodnota',128,'float',{min:0}),
    scalar('parameter84','Původní parametr 0x84',132), scalar('parameter88','Původní parametr 0x88',136),
    scalar('mode','Původní režim 0x90',144,'uint'), scalar('parameter94','Původní parametr 0x94',148), scalar('flags','Příznaky emitoru',152,'uint')],
  102: [scalar('name','Název fáze',8,'string'), vector('direction','Cílový směr',12), vector('directionSpread','Rozptyl cílového směru',24),
    vector('rotation','Rychlosti rotace XYZ (původní jednotky)',36),
    scalar('duration','Délka fáze (ms)',48,'int',{min:1}), scalar('durationSpread','Rozptyl délky (ms)',52,'int',{min:0}),
    vector('scale','Cílové měřítko XYZ',56), vector('scaleSpread','Rozptyl cílového měřítka XYZ',68),
    scalar('alpha','Cílová neprůhlednost',80,'float',{min:0,max:1}), scalar('alphaSpread','Rozptyl neprůhlednosti',84,'float',{min:0}),
    scalar('spin','Cílová rotace – původní hodnota',88), scalar('spinSpread','Rozptyl rotace',92),
    scalar('flags','Příznaky fáze',96,'uint'), scalar('gravity','Gravitace – původní hodnota',100)],
};
function layout(source) {
  const bytes=Buffer.from(source),nodes=[],entries=[],roots=[]; let count=0;
  function block(start,limit,id) {
    if(++count>50000||start+6>limit)fail('useknutá nebo příliš rozsáhlá tabulka.');
    const type=bytes.readUInt16LE(start),length=bytes.readUInt32LE(start+2),end=start+length;
    if(length<6||end>limit)fail('blok překračuje soubor.');
    const node={id,type,start,payload:start+6,end,children:[],entries:[],warnings:[]}; nodes.push(node); return node;
  }
  function parse(node) {
    node.container=true;
    const assignments=new Map(),seen=new Set();
    const put=(child,target,relative,kind='float')=>{
      const size=kind==='boolean'?1:4,offset=child.payload+relative;
      if(offset+size>child.end)fail('useknuté parametry bloku '+child.type+'.');
      assignments.set(target,{offset,kind,child,opaque:child.opaque});
    };
    const pair=(child,target,relative=0)=>{for(let i=0;i<6;i++)put(child,target+i*4,relative+i*4);};
    const name=(child,target)=>{
      if(seen.has(child.type))fail('opakovaný název nebo příznaky.');seen.add(child.type);
      const zero=bytes.indexOf(0,child.payload);if(zero<child.payload||zero>=child.end||zero-child.payload>998)fail('neplatný název.');
      assignments.set(target,{offset:child.payload,zero,kind:'string',child});
    };
    for(let at=node.payload,index=0;at<node.end;index++){
      const child=block(at,node.end,node.id+'/'+index);node.children.push(child);at=child.end;
      if((node.type===100&&child.type===101)||(node.type===101&&child.type===102)){parse(child);continue;}
      if(child.type===103){name(child,8);continue;}
      if(node.type===100){
        if(child.type===104)name(child,52);
        else if(child.type===110){if(seen.has(110))fail('opakované příznaky.');seen.add(110);put(child,56,0,'boolean');put(child,57,1,'boolean');}
        else {child.opaque=child.type!==106;if(child.opaque)node.warnings.push('Neznámý blok '+child.type+' přebírá vektory definice; zůstává jen ke čtení.');pair(child,28);}
      }else if(node.type===101){
        if(child.type===105)name(child,28);
        else if(child.type===107)pair(child,56);
        else if(child.type===108)pair(child,88);
        else if(child.type===109)put(child,124,0,'int');
        else {
          child.opaque=child.type!==106;if(child.opaque)node.warnings.push('Neznámý blok '+child.type+' přebírá parametry emitoru; zůstává jen ke čtení.');
          pair(child,32);
          const destinations=[80,84,88,100,112,116,120,128,132,136,140,144,148,152];
          destinations.forEach((target,i)=>put(child,target,24+i*4,[144,152].includes(target)?'uint':'float'));
        }
      }else {
        if(child.type===107)put(child,100,0);
        else if(child.type===108)pair(child,56);
        else {
          child.opaque=child.type!==106;if(child.opaque)node.warnings.push('Neznámý blok '+child.type+' přebírá parametry fáze; zůstává jen ke čtení.');
          for(let i=0;i<9;i++)put(child,12+i*4,i*4);
          const destinations=[48,52,56,68,80,84,88,92,96];
          destinations.forEach((target,i)=>put(child,target,36+i*4,[48,52].includes(target)?'int':target===96?'uint':'float'));
        }
      }
    }
    for(const field of schemas[node.type]){
      const slots=Array.from({length:field.kind==='vec3'?3:1},(_,i)=>assignments.get(field.target+i*4));
      if(slots.some(slot=>!slot))continue; // Constructor defaults without serialized bytes are not editable.
      const read=slot=>slot.kind==='string'?iconv.decode(bytes.subarray(slot.offset,slot.zero),'windows-1250'):slot.kind==='boolean'?Boolean(bytes[slot.offset]):slot.kind==='int'?bytes.readInt32LE(slot.offset):slot.kind==='uint'?bytes.readUInt32LE(slot.offset):bytes.readFloatLE(slot.offset);
      const values=slots.map(read),invalid=values.some(value=>typeof value==='number'&&!Number.isFinite(value));
      const entry={...field,id:node.id+'/'+field.key,owner:node.id,value:invalid?null:field.kind==='vec3'?values:values[0],offsets:slots.map(slot=>slot.offset),readOnly:Boolean(field.readOnly||invalid||slots.some(slot=>slot.opaque)||field.kind==='boolean'&&bytes[slots[0].offset]>1)};
      node.entries.push(entry);entries.push({...entry,slots});
    }
    node.name=node.entries.find(entry=>entry.key==='name')?.value??'';
  }
  for(let at=0;at<bytes.length;){const root=block(at,bytes.length,'types/'+roots.length);if(root.type!==100)fail('nepodporovaný kořen tabulky.');roots.push(root);parse(root);at=root.end;}
  return {bytes,nodes,entries,roots};
}
export function parseEffectDefinitions(source) {
  const parsed=layout(source),flatten=node=>({id:node.id,kind:node.type===100?'effect':node.type===101?'emitter':'phase',name:node.name,entries:node.entries,warnings:node.warnings,children:node.children.filter(child=>child.container).map(flatten)});
  return {records:parsed.roots.map((node,index)=>({...flatten(node),index})),entries:parsed.entries.map(({slots,...entry})=>entry)};
}
function encode(value) {
  if(typeof value!=='string'||value.includes('\0'))fail('neplatný název.');
  const bytes=iconv.encode(value,'windows-1250');if(bytes.length>998||iconv.decode(bytes,'windows-1250')!==value)fail('název nelze zapsat v Windows-1250.');return bytes;
}
function validate(entry,value) {
  if(entry.readOnly)fail('vlastnost je pouze ke čtení.');
  if(entry.kind==='string'){
    encode(value);
    if(['model','frame'].includes(entry.key)&&!value.trim())fail('model a část modelu nesmí být prázdné.');
    if(entry.key==='model'&&!/^[^/\\:*?"<>|]+\.i3d$/i.test(value))fail('model musí být název souboru .I3D bez cesty nebo zástupných znaků.');
    return;
  }
  if(entry.kind==='boolean'){if(typeof value!=='boolean')fail('příznak musí být true nebo false.');return;}
  const values=entry.kind==='vec3'?value:[value];if(!Array.isArray(values)||values.length!==(entry.kind==='vec3'?3:1))fail('neplatný vektor.');
  for(const number of values){
    if(typeof number!=='number'||!Number.isFinite(number))fail('hodnota musí být konečné číslo.');
    if(['int','uint'].includes(entry.kind)){if(!Number.isInteger(number)||number<(entry.kind==='int'?-2147483648:0)||number>(entry.kind==='int'?2147483647:4294967295))fail('neplatné celé číslo.');}
    else if(!Number.isFinite(Math.fround(number))||number!==0&&Math.fround(number)===0)fail('hodnotu nelze zapsat jako float32.');
    if(entry.min!==undefined&&number<entry.min||entry.max!==undefined&&number>entry.max)fail(entry.label+': hodnota je mimo rozsah.');
  }
}
export function editEffectDefinitions(source,changes) {
  const parsed=layout(source),known=new Map(parsed.entries.map(entry=>[entry.id,entry])),updates=new Map();
  if(!Array.isArray(changes)||changes.length>16384)fail('neplatné změny.');
  const seen=new Set();
  for(const change of changes){
    const entry=known.get(change?.id);if(!entry||seen.has(change.id))fail('neplatná nebo opakovaná vlastnost.');seen.add(change.id);
    const unchanged=Array.isArray(entry.value)&&Array.isArray(change.value)?entry.value.length===change.value.length&&entry.value.every((value,i)=>Object.is(value,change.value[i])):Object.is(entry.value,change.value);
    if(unchanged)continue;
    validate(entry,change.value);updates.set(change.id,change.value);
  }
  const bytes=Buffer.from(parsed.bytes),strings=new Map();
  for(const node of parsed.nodes.filter(node=>node.type===102&&node.container)){
    const duration=node.entries.find(entry=>entry.key==='duration'),spread=node.entries.find(entry=>entry.key==='durationSpread');
    if(duration&&spread&&(updates.has(duration.id)||updates.has(spread.id))){
      if(duration.readOnly||spread.readOnly)fail('délka fáze má neznámé parametry.');
      if((updates.get(spread.id)??spread.value)>=(updates.get(duration.id)??duration.value))fail('rozptyl délky musí být menší než délka fáze.');
    }
  }
  for(const [id,value] of updates){
    const entry=known.get(id);if(entry.kind==='string'){if(value!==entry.value)strings.set(entry.slots[0].child.id,{slot:entry.slots[0],data:encode(value)});continue;}
    const values=entry.kind==='vec3'?value:[value],old=entry.kind==='vec3'?entry.value:[entry.value];
    values.forEach((number,i)=>{if(Object.is(number,old[i]))return;const offset=entry.slots[i].offset;if(entry.kind==='boolean')bytes[offset]=Number(number);else if(entry.kind==='int')bytes.writeInt32LE(number,offset);else if(entry.kind==='uint')bytes.writeUInt32LE(number,offset);else bytes.writeFloatLE(number,offset);});
  }
  function rebuild(node){
    const rename=strings.get(node.id);
    const payload=rename?Buffer.concat([rename.data,Buffer.from([0]),bytes.subarray(rename.slot.zero+1,node.end)]):node.children.length?Buffer.concat(node.children.map(rebuild)):bytes.subarray(node.payload,node.end);
    const header=Buffer.from(bytes.subarray(node.start,node.payload));header.writeUInt32LE(payload.length+6,2);return Buffer.concat([header,payload]);
  }
  const result=Buffer.concat(parsed.roots.map(rebuild));parseEffectDefinitions(result);return result;
}

// Type IDs are positions in the global table. Append new types only; emitter
// and phase chains are local ordered vectors populated by the native loaders.
export function changeEffectDefinition(source,request) {
  const parsed=layout(source);
  if(!request||typeof request!=='object'||Array.isArray(request)||!['duplicate','delete','move'].includes(request.action)||Object.keys(request).some(key=>!['action','id','name','direction'].includes(key)))fail('neplatná strukturální operace.');
  const node=parsed.nodes.find(node=>node.id===request.id&&node.container);
  if(!node)fail('vyberte existující typ, emitor nebo fázi.');
  const parent=parsed.nodes.find(parent=>parent.children.includes(node)),siblings=parent?parent.children.filter(child=>child.container):parsed.roots,index=siblings.indexOf(node);
  let selection=node.id,copy,neighbor;
  if(request.action==='duplicate'){
    if(request.direction!==undefined)fail('kopie nemá směr přesunu.');
    const name=encode(request.name);if(!request.name.trim())fail('kopie potřebuje neprázdný název.');
    if(siblings.some(sibling=>sibling.name.normalize('NFC').toLowerCase()===request.name.normalize('NFC').toLowerCase()))fail('název už mezi sourozenci existuje.');
    const field=node.entries.find(entry=>entry.key==='name'),entry=parsed.entries.find(entry=>entry.id===field?.id),slot=entry?.slots[0];
    if(node.type!==102&&!node.children.some(child=>child.container))fail('zdroj nemá emitor nebo fázi; vyberte úplný vzor.');
    const clone=child=>{
      let payload=child===slot?.child?Buffer.concat([name,Buffer.from([0]),parsed.bytes.subarray(slot.zero+1,child.end)]):child.children.length?Buffer.concat(child.children.map(clone)):parsed.bytes.subarray(child.payload,child.end);
      if(child===node&&!slot){const header=Buffer.alloc(6);header.writeUInt16LE(103);header.writeUInt32LE(name.length+7,2);payload=Buffer.concat([header,name,Buffer.from([0]),payload]);}
      const header=Buffer.from(parsed.bytes.subarray(child.start,child.payload));header.writeUInt32LE(payload.length+6,2);return Buffer.concat([header,payload]);
    };
    copy=clone(node);
    selection=parent?parent.id+'/'+(parent.children.indexOf(node)+1):'types/'+parsed.roots.length;
  }else{
    if(request.name!==undefined)fail('název se zadává jen při kopírování.');
    if(!parent)fail('původní typy nelze odstranit ani řadit, změnilo by se jejich globální ID.');
    if(request.action==='delete'){
      if(request.direction!==undefined)fail('odstranění nemá směr přesunu.');
      if(siblings.length<2)fail(node.type===101?'Typ musí mít alespoň jeden emitor.':'Emitor musí mít alespoň jednu fázi.');
      selection=parent.id;
    }else{
      if(![-1,1].includes(request.direction))fail('směr přesunu musí být −1 nebo 1.');
      neighbor=siblings[index+request.direction];if(!neighbor)fail('záznam je už na hranici seznamu.');
      selection=neighbor.id;
    }
  }
  const rebuild=branch=>{
    if(branch!==parent)return parsed.bytes.subarray(branch.start,branch.end);
    const children=branch.children.flatMap(child=>{
      const raw=parsed.bytes.subarray(child.start,child.end);
      if(child===node){if(request.action==='duplicate')return [raw,copy];if(request.action==='delete')return [];return [parsed.bytes.subarray(neighbor.start,neighbor.end)];}
      return [child===neighbor?parsed.bytes.subarray(node.start,node.end):raw];
    });
    const header=Buffer.from(parsed.bytes.subarray(branch.start,branch.payload)),payload=Buffer.concat(children);header.writeUInt32LE(payload.length+6,2);return Buffer.concat([header,payload]);
  };
  // Rebuild the selected parent and only its ancestors. All other chunks stay exact.
  const visit=branch=>{if(branch===parent)return rebuild(branch);if(!branch.children.some(child=>child===parent||parent?.id.startsWith(child.id+'/')))return parsed.bytes.subarray(branch.start,branch.end);const payload=Buffer.concat(branch.children.map(visit)),header=Buffer.from(parsed.bytes.subarray(branch.start,branch.payload));header.writeUInt32LE(payload.length+6,2);return Buffer.concat([header,payload]);};
  const data=Buffer.concat([...parsed.roots.map(visit),...(!parent&&copy?[copy]:[])]);
  const result=parseEffectDefinitions(data);if(result.records.length>10000)fail('tabulka může mít nejvýše 10000 typů.');
  return {data,selection};
}
