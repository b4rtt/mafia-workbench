import iconv from 'iconv-lite';

// Own CHG reader/writer based on game_load_differences (005ea0c0) and
// program_load_source_code. Actor payloads and frame-specific tails stay opaque.
function layout(source) {
  const bytes = Buffer.from(source);
  if (bytes.length < 6 || bytes.readUInt16LE(0) !== 1234 || bytes.readUInt32LE(2) !== bytes.length) throw new Error('CHG: neplatný kořen nebo délka souboru.');
  const chunks = [], entries = [], descriptors = new Map(), objects = [], actors = [], bindings = [];
  let opaqueBytes = 0;
  const add = (chunk, id, label, kind, value, start, end, context) => {
    const entry = {id:`${chunk.index}/${id}`,label,kind,value,context}; entries.push(entry); descriptors.set(entry.id,{chunk,entry,start,end});
    if (entries.length > 200000) throw new Error('CHG: příliš mnoho vlastností.');
  };
  for (let offset = 6; offset < bytes.length;) {
    if (offset+6 > bytes.length || chunks.length >= 100000) throw new Error('CHG: neúplná hlavička bloku.');
    const type = bytes.readUInt16LE(offset), size = bytes.readUInt32LE(offset+2);
    if (size < 6 || offset+size > bytes.length) throw new Error('CHG: blok překračuje konec souboru.');
    const chunk = {index:chunks.length,type,raw:bytes.subarray(offset,offset+size),payload:bytes.subarray(offset+6,offset+size)}; chunks.push(chunk); offset += size;
    const data = chunk.payload; let cursor = 0;
    const need = count => { if (cursor+count > data.length) throw new Error('CHG: neúplná vlastnost bloku.'); };
    const uint = () => { need(4); const value = data.readUInt32LE(cursor); cursor += 4; return value; };
    const text = () => { const length = uint(); if (length > 1000000) throw new Error('CHG: řetězec je příliš dlouhý.'); need(length); const value = iconv.decode(data.subarray(cursor,cursor+length),'windows-1250'); cursor += length; return value; };
    const vector = count => { need(count*4); const value = Array.from({length:count},(_,i)=>data.readFloatLE(cursor+i*4)); cursor += count*4; if (value.some(n=>!Number.isFinite(n))) throw new Error('CHG: neplatná transformace.'); return value; };
    if (type === 100) {
      const frameType = uint(), position = vector(3), scale = vector(3), rotation = vector(4), name = text(), parent = text();
      const object = {index:chunk.index,frameType,name,parent,position,scale,rotation};
      if (frameType === 9 || frameType === 4) object.resource = text();
      objects.push(object); const context = `Objekt ${chunk.index} / ${name}`;
      add(chunk,'position','Pozice XYZ','vec3',position,4,16,context);
      add(chunk,'scale','Měřítko XYZ','vec3',scale,16,28,context);
      add(chunk,'rotation','Rotace WXYZ (raw)','quat',rotation,28,44,context);
      opaqueBytes += data.length-cursor;
    } else if (type === 200) {
      actors.push({index:chunk.index,kind:uint(),bytes:data.length-4}); opaqueBytes += data.length-4;
    } else if (type === 400) {
      const name = text(), kind = uint(); bindings.push({index:chunk.index,name,kind}); opaqueBytes += data.length-cursor;
    } else if (type === 500) {
      let index = 0;
      while (cursor < data.length) {
        need(1); const start = cursor++; const name = text(), code = text();
        add(chunk,`script/${index++}`,'Skript','script',{name,code},start,cursor,`Skripty ${chunk.index}`);
      }
    } else opaqueBytes += data.length;
  }
  return {bytes,chunks,entries,descriptors,objects,actors,bindings,opaqueBytes};
}
export function inspectDifference(source) {
  const {entries,objects,actors,bindings,opaqueBytes,chunks} = layout(source);
  return {entries,objects,actors,bindings,opaqueBytes,blocks:chunks.length};
}
function encodeText(value) {
  if (typeof value !== 'string' || value.includes('\0') || value.length > 1000000) throw new Error('CHG: neplatný text skriptu.');
  const bytes = iconv.encode(value,'windows-1250');
  if (iconv.decode(bytes,'windows-1250') !== value) throw new Error('CHG: text nelze zapsat v kódování Windows-1250.');
  const length = Buffer.alloc(4); length.writeUInt32LE(bytes.length); return Buffer.concat([length,bytes]);
}
export function editDifference(source, changes) {
  const file = layout(source), replacements = new Map(), seen = new Set();
  if (!Array.isArray(changes) || changes.length > 4096) throw new Error('CHG: neplatné změny.');
  for (const change of changes) {
    const field = file.descriptors.get(change?.id);
    if (!field || seen.has(change.id)) throw new Error('CHG: neznámá nebo opakovaná vlastnost.'); seen.add(change.id);
    const {chunk,entry,start,end} = field, original = chunk.payload.subarray(start,end); let bytes;
    if (entry.kind === 'script') {
      const value = change.value;
      if (!value || typeof value.name !== 'string' || typeof value.code !== 'string') throw new Error('CHG: neplatný skript.');
      // Preserve the complete original representation on an unchanged script.
      const codeStart = 5+original.readUInt32LE(1);
      bytes = Buffer.concat([original.subarray(0,1),value.name === entry.value.name ? original.subarray(1,codeStart) : encodeText(value.name),value.code === entry.value.code ? original.subarray(codeStart) : encodeText(value.code)]);
    } else {
      const value = change.value, count = entry.kind === 'quat' ? 4 : 3;
      if (!Array.isArray(value) || value.length !== count || value.some(n=>typeof n!=='number'||!Number.isFinite(n)||!Number.isFinite(Math.fround(n)))) throw new Error('CHG: neplatná transformace float32.');
      if (entry.kind === 'quat' && !value.some(n=>Math.fround(n)!==0)) throw new Error('CHG: rotace nesmí být nulový quaternion.');
      bytes = Buffer.from(original); value.forEach((n,i)=>{if(n!==entry.value[i])bytes.writeFloatLE(n,i*4);});
    }
    if (!replacements.has(chunk.index)) replacements.set(chunk.index,[]);
    replacements.get(chunk.index).push({start,end,bytes});
  }
  const chunks = file.chunks.map(chunk=>{
    const edits = replacements.get(chunk.index); if (!edits) return chunk.raw;
    edits.sort((a,b)=>a.start-b.start); const pieces = []; let cursor = 0;
    for (const edit of edits) { pieces.push(chunk.payload.subarray(cursor,edit.start),edit.bytes); cursor = edit.end; }
    pieces.push(chunk.payload.subarray(cursor)); const payload = Buffer.concat(pieces), header = Buffer.from(chunk.raw.subarray(0,6)); header.writeUInt32LE(payload.length+6,2); return Buffer.concat([header,payload]);
  });
  const result = Buffer.concat([file.bytes.subarray(0,6),...chunks]); result.writeUInt32LE(result.length,2); return result;
}
