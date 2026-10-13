import * as THREE from 'three';

export function sceneMarkerKind(source) {
  if(source.model)return null;
  return source.frameType===4?'sound':source.frameType===2?'light':source.frameType===6?'script':null;
}

// Billboard glyphs remain legible from every viewing direction. Their parent
// keeps the source frame's transform and picking identity.
export function markerMaterial(kind) {
  const canvas=document.createElement('canvas');canvas.width=canvas.height=128;
  const c=canvas.getContext('2d');c.lineWidth=7;c.lineCap=c.lineJoin='round';
  c.fillStyle='#20252de8';c.beginPath();c.roundRect(8,8,112,112,24);c.fill();
  c.strokeStyle=kind==='light'?'#ffd76a':kind==='sound'?'#86c7ff':'#b7a1ff';c.fillStyle=c.strokeStyle;
  if(kind==='sound'){
    c.beginPath();c.moveTo(28,51);c.lineTo(45,51);c.lineTo(64,34);c.lineTo(64,94);c.lineTo(45,77);c.lineTo(28,77);c.closePath();c.fill();
    for(const r of [17,31]){c.beginPath();c.arc(64,64,r,-.8,.8);c.stroke();}
  }else if(kind==='script'){
    for(const [a,b,d] of [[48,34,48],[80,94,80]]){c.beginPath();c.moveTo(a,42);c.lineTo(b,64);c.lineTo(d,86);c.stroke();}
    c.beginPath();c.moveTo(72,35);c.lineTo(57,93);c.stroke();
  }else{
    c.beginPath();c.arc(64,53,22,0,2*Math.PI);c.stroke();
    c.beginPath();c.moveTo(52,75);c.lineTo(52,91);c.lineTo(76,91);c.lineTo(76,75);c.moveTo(56,102);c.lineTo(72,102);c.stroke();
    for(const [x,y,dx,dy] of [[64,16,0,9],[23,53,10,0],[95,53,10,0],[33,22,7,7],[95,22,-7,7]]){c.beginPath();c.moveTo(x,y);c.lineTo(x+dx,y+dy);c.stroke();}
  }
  const map=new THREE.CanvasTexture(canvas);map.colorSpace=THREE.SRGBColorSpace;
  return new THREE.SpriteMaterial({map,transparent:true,depthWrite:false,toneMapped:false,sizeAttenuation:false});
}
