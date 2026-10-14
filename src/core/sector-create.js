import {parseFourDs} from './fourds.js';
import {sectorBox} from '../shared/sector-box.js';

// Append at the end: existing IDs, parent/joint/instance references and bytes
// stay exact. Identity transform avoids assumptions about baked sector space.
export function appendSector(source,options,otherNames=[]){
  source=Buffer.from(source);const parsed=parseFourDs(source,'all'),mesh=sectorBox(options),sector=mesh.sector;
  if(parsed.meshes.length>=65535)throw new Error('4DS: nelze přidat další objekt.');
  if(!Array.isArray(otherNames)||!otherNames.every(n=>typeof n==='string'))throw new Error('Sektor: neplatné názvy scény.');
  const key=n=>n.normalize('NFC').toLowerCase();
  if([...parsed.meshes.map(m=>m.name),...otherNames].some(n=>key(n)===key(mesh.name)))throw new Error('Sektor: objekt tohoto názvu již existuje v misi.');
  const parts=[],integer=(size,n)=>{const b=Buffer.alloc(size);size===1?b.writeUInt8(n):size===2?b.writeUInt16LE(n):b.writeUInt32LE(n);parts.push(b);},floats=values=>{const b=Buffer.alloc(values.length*4);values.forEach((v,i)=>b.writeFloatLE(v,i*4));parts.push(b);},string=s=>{const b=Buffer.from(s,'ascii');integer(1,b.length);parts.push(b);};
  integer(1,5);integer(2,0);floats([...mesh.position,...mesh.scale,...mesh.rotation]);integer(1,mesh.culling);string(mesh.name);string('');
  for(const v of sector.flags)integer(4,v);integer(4,sector.vertices);integer(4,sector.faces);floats(sector.positions);for(const i of sector.indices)integer(2,i);floats(sector.bounds);integer(1,0);
  const {meshCountOffset,animatedOffset}=parsed.layout,count=Buffer.alloc(2);count.writeUInt16LE(parsed.meshes.length+1);
  const result=Buffer.concat([source.subarray(0,meshCountOffset),count,source.subarray(meshCountOffset+2,animatedOffset),...parts,source.subarray(animatedOffset)]);
  parseFourDs(result,'all');return result;
}
