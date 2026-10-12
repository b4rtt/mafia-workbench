export function collisionFixture() {
  const header=Buffer.alloc(24,0xa5);header.write('GifC');header.writeUInt32LE(5,4);header.writeUInt32LE(52,8);header.writeUInt32LE(1,12);
  const offsets=Buffer.alloc(4);offsets.writeUInt32LE(32);const gap=Buffer.from([1,2,3,4]),link=Buffer.alloc(16,0xee);link.writeUInt32LE(2);link.write('old\0',4);
  const grid=Buffer.alloc(104,0xaa);for(const [i,n] of [0,0,20,20,10,10].entries())grid.writeFloatLE(n,i*4);grid.writeUInt32LE(2,24);grid.writeUInt32LE(2,28);
  for(const offset of [0x30,0x38,0x40,0x48,0x50,0x58])grid.writeUInt32LE(1,offset);grid.writeUInt32LE(3,0x60);
  const bounds=Buffer.alloc(24);[0,10,20,0,10,20].forEach((n,i)=>bounds.writeFloatLE(n,i*4));
  const triangle=Buffer.alloc(32);triangle[0]=3;for(let i=0;i<3;i++){triangle.writeUInt16LE(i,4+i*4);triangle.writeUInt16LE(0x7fff,6+i*4);}triangle.writeFloatLE(1,20);
  const prim=(type,size)=>{const bytes=Buffer.alloc(size,0xd5);bytes[0]=type;bytes.writeUInt32LE(0,4);return bytes;};
  const aabb=prim(0x81,32);[1,2,3,4,5,6].forEach((n,i)=>aabb.writeFloatLE(n,8+i*4));
  const vertices=Buffer.alloc(36);[0,0,0,1,0,0,0,0,1].forEach((n,i)=>vertices.writeFloatLE(n,i*4));
  const cell=Buffer.alloc(16+24+8,0x88);cell.writeUInt32LE(6);[0x81,0x80,0x84,0x83,0x82,0].forEach((n,i)=>{cell.writeUInt32LE((n*0x1000000)>>>0,16+i*4);cell[40+i]=i+1;});
  const empty=Buffer.alloc(16,0x19);empty.writeUInt32LE(0);
  return Buffer.concat([header,offsets,gap,link,Buffer.from('GAP!'),grid,bounds,Buffer.from('SEP!'),triangle,aabb,prim(0x80,184),prim(0x84,20),prim(0x83,160),prim(0x82,24),vertices,Buffer.from('CELL'),cell,empty,empty,empty,Buffer.from('opaque tail')]);
}
