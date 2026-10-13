export const materialFlags = { alpha:0x8000, noTileU:0x10000, noTileV:0x20000, diffuse:0x40000, environment:0x80000, embeddedAlpha:0x01000000, colored:0x08000000, doubleSided:0x10000000, colorKey:0x20000000, alphaTexture:0x40000000, additive:0x80000000 };
export const editableMaterialFlags = Object.values(materialFlags).reduce((value,flag)=>(value|flag)>>>0,0);
const alphaFlags=(materialFlags.alpha|materialFlags.embeddedAlpha|materialFlags.colorKey|materialFlags.alphaTexture|materialFlags.additive)>>>0;
export const materialAlphaModes = [['opacity','Krytí materiálu'],['key','Barevný klíč BMP'],['embedded','Alpha kanál v textuře'],['mask','Samostatná alpha textura'],['implicit','Automatická maska (+)'],['additive','Sčítací průhlednost']];
export function materialAlphaMode(flags){
  if(flags&materialFlags.additive)return 'additive';
  if(flags&materialFlags.colorKey)return 'key';
  if(!(flags&materialFlags.alpha))return 'opacity';
  if(flags&materialFlags.embeddedAlpha)return 'embedded';
  return flags&materialFlags.alphaTexture?'mask':'implicit';
}
export function withMaterialAlphaMode(flags,mode){
  if(!materialAlphaModes.some(([value])=>value===mode))throw new Error('Materiál: neplatný režim průhlednosti.');
  const bits={opacity:0,key:materialFlags.alpha|materialFlags.colorKey,embedded:materialFlags.alpha|materialFlags.embeddedAlpha,mask:materialFlags.alpha|materialFlags.alphaTexture,implicit:materialFlags.alpha,additive:materialFlags.alpha|materialFlags.additive}[mode];
  return ((flags&~alphaFlags)|bits)>>>0;
}
export function materialDraft(source,index,changes){
  const prefix=`materials/${index}/`,settings=changes.get(prefix+'settings');
  const result={...source,...settings};
  for(const [id,value] of changes)if(id.startsWith(prefix)&&id!==prefix+'settings'&&!value?.invalid)result[id.slice(prefix.length)]=value;
  return result;
}
