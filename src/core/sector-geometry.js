import {parseFourDs} from './fourds.js';
import {sectorVolume,portalPolygon,sameSectorValues} from '../shared/sector-geometry.js';

export function editSectorGeometry(source,request){
  source=Buffer.from(source);const parsed=parseFourDs(source,true),mesh=parsed.meshes[request?.mesh-1],sector=mesh?.sector,draft=request?.sector;
  if(!Number.isInteger(request?.mesh)||!sector||!draft||typeof draft!=='object'||Array.isArray(draft)||Object.keys(draft).some(k=>!['positions','indices','portals'].includes(k)))throw new Error('4DS: neplatná geometrie sektoru.');
  const positions=Object.hasOwn(draft,'positions')?draft.positions:sector.positions,indices=Object.hasOwn(draft,'indices')?draft.indices:sector.indices;
  const changed=!sameSectorValues(positions,sector.positions)||!sameSectorValues(indices,sector.indices);
  let geometry;
  if(changed){const data=sectorVolume(positions,indices);geometry=Buffer.alloc(8+data.positions.length*4+data.indices.length*2+24);let at=0;geometry.writeUInt32LE(data.positions.length/3,at);at+=4;geometry.writeUInt32LE(data.indices.length/3,at);at+=4;for(const v of data.positions){geometry.writeFloatLE(v,at);at+=4;}for(const i of data.indices){geometry.writeUInt16LE(i,at);at+=2;}for(const v of data.bounds){geometry.writeFloatLE(v,at);at+=4;}}
  else geometry=source.subarray(sector.geometryOffset,sector.portalsOffset);
  const portals=Object.hasOwn(draft,'portals')?draft.portals:sector.portals.map((_,source)=>({source}));
  if(!Array.isArray(portals)||portals.length>255)throw new Error('4DS: neplatný počet portálů.');
  const records=Array.from(portals).map(portal=>{
    if(!portal||Object.keys(portal).some(k=>!['source','positions','flags','parameters'].includes(k)))throw new Error('4DS: neplatný portál.');
    if(Object.hasOwn(portal,'source')){
      if(!Number.isInteger(portal.source)||!sector.portals[portal.source]||Object.hasOwn(portal,'flags')||Object.hasOwn(portal,'parameters'))throw new Error('4DS: neplatný původní portál.');
      const original=sector.portals[portal.source];if(!Object.hasOwn(portal,'positions')||sameSectorValues(portal.positions,original.positions))return source.subarray(original.offset,original.endOffset);
      const data=portalPolygon(portal.positions),header=Buffer.from(source.subarray(original.offset,original.planeOffset));header.writeUInt8(data.positions.length/3);return Buffer.concat([header,floats([...data.plane,...data.positions])]);
    }
    const data=portalPolygon(portal.positions),flags=Object.hasOwn(portal,'flags')?portal.flags:4,parameters=Object.hasOwn(portal,'parameters')?portal.parameters:[0,0];
    if(!Number.isInteger(flags)||flags<0||flags>4294967295||!Array.isArray(parameters)||parameters.length!==2||!Array.from(parameters).every(v=>typeof v==='number'&&Number.isFinite(v)&&Number.isFinite(Math.fround(v))))throw new Error('4DS: neplatné parametry nového portálu.');
    const header=Buffer.alloc(5);header.writeUInt8(data.positions.length/3);header.writeUInt32LE(flags,1);return Buffer.concat([header,floats([...parameters,...data.plane,...data.positions])]);
  });
  const result=Buffer.concat([source.subarray(0,sector.geometryOffset),geometry,Buffer.from([portals.length]),...records,source.subarray(sector.endOffset)]);
  parseFourDs(result,true);return result;
}
function floats(values){const b=Buffer.alloc(values.length*4);values.forEach((v,i)=>b.writeFloatLE(v,i*4));return b;}
