import iconv from 'iconv-lite';

export function detectorScriptLayout(data){
  // Detector v1 + mask uint32 + C_program v1 + empty first string.
  if(!data||data.length<14||data[0]!==1||data[5]!==1||data.readUInt32LE(6)!==0)return null;
  const length=data.readUInt32LE(10);
  return length<=1000000&&14+length<=data.length?{lengthOffset:10,codeStart:14,length}:null;
}
export function editDetectorMask(source,value){
  if(!detectorScriptLayout(source))throw new Error('Detektor: nepodporovaná konfigurace.');
  if(!Number.isInteger(value)||value<0||value>4294967295)throw new Error('Detektor: maska musí být celé číslo 0–4294967295.');
  const data=Buffer.from(source);data.writeUInt32LE(value,1);return data;
}
export function createDetector(code,mask=1){
  if(typeof code!=='string'||code.includes('\0')||code.length>1000000)throw new Error('Detektor: neplatný zdroj skriptu.');
  const encoded=iconv.encode(code,'windows-1250');
  if(encoded.length>1000000||iconv.decode(encoded,'windows-1250')!==code)throw new Error('Detektor: skript musí být v kódování Windows-1250 a mít nejvýše 1 MB.');
  const header=Buffer.alloc(14);header[0]=header[5]=1;header.writeUInt32LE(encoded.length,10);
  return editDetectorMask(Buffer.concat([header,encoded]),mask);
}
