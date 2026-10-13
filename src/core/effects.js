import iconv from 'iconv-lite';

function chunk(bytes,start,limit){
  if(start+6>limit)throw new Error('Efekty: useknutá hlavička bloku.');
  const type=bytes.readUInt16LE(start),length=bytes.readUInt32LE(start+2);
  if(length<6||start+length>limit)throw new Error('Efekty: blok překračuje soubor.');
  return {type,start,end:start+length,length,payload:start+6};
}
function string(bytes,start,end){
  const zero=bytes.indexOf(0,start);
  if(zero<start||zero>=end||zero-start>998)throw new Error('Efekty: neplatný název.');
  return {value:iconv.decode(bytes.subarray(start,zero),'windows-1250'),zero};
}
function encode(value){
  if(typeof value!=='string'||value.includes('\0'))throw new Error('Efekty: neplatný název objektu.');
  const bytes=iconv.encode(value,'windows-1250');
  if(bytes.length>998||iconv.decode(bytes,'windows-1250')!==value)throw new Error('Efekty: název nelze zapsat v kódování Windows-1250.');
  return bytes;
}
function pack(type,payload){const header=Buffer.alloc(6);header.writeUInt16LE(type);header.writeUInt32LE(payload.length+6,2);return Buffer.concat([header,payload]);}
function vector(value){
  if(!Array.isArray(value)||value.length!==3||!Array.from(value).every(n=>typeof n==='number'&&Number.isFinite(n)&&Number.isFinite(Math.fround(n))))throw new Error('Efekty: vektor musí mít tři konečná čísla float32.');
  return value;
}
function effectIndex(value){if(!Number.isInteger(value)||value<0||value>0xffffffff)throw new Error('Efekty: neplatný index typu.');return value;}
function layout(source){
  const bytes=Buffer.from(source),root=chunk(bytes,0,bytes.length);
  if(root.type!==100)throw new Error('Efekty: podporovaná je pouze verze 100.');
  const nodes=[],effects=[],entries=[];
  for(let at=root.payload;at<root.end;){
    if(nodes.length>=100000)throw new Error('Efekty: příliš mnoho záznamů.');
    const node=chunk(bytes,at,root.end);node.id=`effects/${nodes.length}`;nodes.push(node);at=node.end;
    if(node.type!==1000)continue;
    if(node.length<74)throw new Error('Efekty: useknutá matice nebo index typu.');
    const matrix=Array.from({length:16},(_,i)=>bytes.readFloatLE(node.payload+i*4));
    if(matrix.some(n=>!Number.isFinite(n)))throw new Error('Efekty: matice obsahuje neplatné číslo.');
    const effect={id:node.id,index:effects.length,effectId:bytes.readUInt32LE(node.payload+64),position:matrix.slice(12,15),direction:matrix.slice(4,7),matrix,frame:'',bindingEditable:node.length===74,fields:{}};
    if(node.length>74){
      try{const binding=chunk(bytes,node.payload+68,node.end);if(binding.type===1001){const name=string(bytes,binding.payload,binding.end);node.binding={...binding,...name};effect.frame=name.value;effect.bindingEditable=true;}}
      catch{/* A foreign binding remains opaque; position/type edits still preserve it. */}
    }
    const add=(field,label,kind,value)=>{const id=`${node.id}/${field}`;effect.fields[field]=id;entries.push({id,label,kind,value,context:`Efekt ${effect.index+1} · typ ${effect.effectId}`});};
    add('position','Pozice XYZ','vec3',effect.position);add('direction','Směr XYZ','vec3',effect.direction);add('effectId','Index typu efektu','uint',effect.effectId);
    if(effect.bindingEditable)add('frame','Vazba na objekt (prázdné = svět)','string',effect.frame);
    effects.push(effect);node.effect=effect;
  }
  return {bytes,root,nodes,effects,entries};
}
export function parseEffects(source){const {root,nodes,effects,entries,bytes}=layout(source);return {version:100,effects,entries,unknownChunks:nodes.filter(node=>node.type!==1000).length,tailBytes:bytes.length-root.end};}
function rebuild(parsed,nodes){return Buffer.concat([pack(100,Buffer.concat(nodes)),parsed.bytes.subarray(parsed.root.end)]);}
export function editEffects(source,changes){
  const parsed=layout(source),known=new Map(parsed.entries.map(entry=>[entry.id,entry])),updates=new Map();
  if(!Array.isArray(changes)||changes.length>1024)throw new Error('Efekty: neplatné změny.');
  for(const change of changes){
    const entry=known.get(change?.id);if(!entry||updates.has(change.id))throw new Error('Efekty: neplatná nebo opakovaná vlastnost.');
    if(entry.kind==='vec3')vector(change.value);else if(entry.kind==='uint')effectIndex(change.value);else encode(change.value);
    updates.set(change.id,change.value);
  }
  const nodes=parsed.nodes.map(node=>{
    const raw=Buffer.from(parsed.bytes.subarray(node.start,node.end));if(!node.effect)return raw;
    for(const [field,offset] of [['position',54],['direction',22]]){
      const value=updates.get(node.effect.fields[field]);if(value)value.forEach((n,i)=>{if(!Object.is(n,node.effect[field][i]))raw.writeFloatLE(n,offset+i*4);});
    }
    const type=updates.get(node.effect.fields.effectId);if(type!==undefined)raw.writeUInt32LE(type,70);
    const frame=updates.get(node.effect.fields.frame);if(frame===undefined||frame===node.effect.frame)return raw;
    const binding=node.binding;
    if(!frame){if(binding&&(binding.end!==node.end||binding.zero+1!==binding.end))throw new Error('Efekty: vazbu s neznámými doplňkovými daty nelze odebrat.');return pack(1000,raw.subarray(6,74));}
    const name=encode(frame),tail=binding?parsed.bytes.subarray(binding.zero+1,binding.end):Buffer.alloc(0),child=pack(1001,Buffer.concat([name,Buffer.from([0]),tail]));
    return pack(1000,Buffer.concat([raw.subarray(6,74),child,binding?parsed.bytes.subarray(binding.end,node.end):Buffer.alloc(0)]));
  });
  const result=rebuild(parsed,nodes);parseEffects(result);return result;
}
export function changeEffects(source,request){
  const parsed=layout(source),nodes=parsed.nodes.map(node=>parsed.bytes.subarray(node.start,node.end));
  if(!request||!['add','duplicate','delete'].includes(request.action))throw new Error('Efekty: neplatná operace.');
  if(request.action==='add'){
    const position=vector(request.position),direction=vector(request.direction??[0,1,0]);
    const matrix=[1,0,0,0,...direction,0,0,0,1,0,...position,1],payload=Buffer.alloc(68);matrix.forEach((n,i)=>payload.writeFloatLE(n,i*4));payload.writeUInt32LE(effectIndex(request.effectId),64);
    const frame=encode(request.frame??''),binding=frame.length?pack(1001,Buffer.concat([frame,Buffer.from([0])])):Buffer.alloc(0);
    nodes.push(pack(1000,Buffer.concat([payload,binding])));
  }else{
    const index=parsed.nodes.findIndex(node=>node.id===request.id&&node.effect);if(index<0)throw new Error('Efekty: záznam neexistuje.');
    if(request.action==='duplicate')nodes.push(Buffer.from(nodes[index]));else nodes.splice(index,1);
  }
  const result=rebuild(parsed,nodes);parseEffects(result);return result;
}
export function parseEffectTypes(source){
  const bytes=Buffer.from(source),items=[];
  for(let at=0;at<bytes.length;){
    if(items.length>=10000)throw new Error('Efekty: příliš mnoho definic.');
    const type=chunk(bytes,at,bytes.length);at=type.end;if(type.type!==100)throw new Error('Efekty: nepodporovaný blok tabulky.');
    const item={effectId:items.length,name:'',model:'',emitters:0},seen=new Set();
    for(let p=type.payload;p<type.end;){const child=chunk(bytes,p,type.end);p=child.end;
      if(child.type===101){item.emitters++;continue;}
      if(![103,104,110].includes(child.type))continue;
      if(seen.has(child.type))throw new Error('Efekty: opakovaná vlastnost definice.');seen.add(child.type);
      if(child.type===110){if(child.length<8)throw new Error('Efekty: useknuté příznaky definice.');item.rotateDirection=Boolean(bytes[child.payload]);item.rotatePosition=Boolean(bytes[child.payload+1]);}
      else item[child.type===103?'name':'model']=string(bytes,child.payload,child.end).value;
    }
    items.push(item);
  }
  return {items};
}
