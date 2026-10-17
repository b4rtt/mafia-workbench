// Hand-audited horizontal cuts between complete window rows in original BMPs.
// U always spans whole atlases: asymmetric ornament is never cut into bays.
const recipes=Object.freeze({
  brick:{rows:[0,.5,1],swatch:[.01,.1,.065,.25]},
  shops:{rows:[0,.5,1],swatch:[.01,.18,.09,.38]},
  stone:{rows:[0,.5,1],swatch:[.02,.03,.08,.15]},
  rose:{rows:[0,.5,1],swatch:[.1,.1,.25,.3]},
  ornate:{rows:[0,.32,.65,1],swatch:[.64,.44,.70,.55]},
  'green-stone':{rows:[0,.17,.36,.68,1],swatch:[.02,.2,.07,.27]},
  arched:{rows:[0,1/3,2/3,1],swatch:[.12,.34,.25,.36]},
  hotel:{rows:[0,1/3,2/3,1],swatch:[.005,.17,.025,.29]},
  'old-brick':{rows:[0,.5,1],swatch:[.02,.2,.06,.4]},
});
export function validateOsmFacade(options){
  if(options===undefined)return;
  if(!options||options.version!==1||Object.keys(options).some(k=>k!=='version'))throw Error('OpenStreetMap · fasády: neplatné nastavení skládání.');
}
export const osmFacadeRecipe=style=>recipes[style.id];
export function osmFacadeTileSize(style){const [u0,v0,u1,v1]=recipes[style.id].swatch;return [2*(u1-u0)*style.width,2*(v1-v0)*style.upperHeight];}
export function osmFacadeRing(ring){
  const result=[...ring];let changed=true;
  while(changed&&result.length>3){changed=false;for(let i=0;i<result.length;i++){
    const a=result[(i+result.length-1)%result.length],p=result[i],b=result[(i+1)%result.length],u=[p[0]-a[0],p[1]-a[1]],v=[b[0]-p[0],b[1]-p[1]],length=Math.hypot(b[0]-a[0],b[1]-a[1]);
    if(length>0&&Math.abs(u[0]*v[1]-u[1]*v[0])/length<=1e-7&&u[0]*v[0]+u[1]*v[1]>0){result.splice(i,1);changed=true;break;}
  }}
  return result;
}

// Keep a complete atlas at its native scale unless <=15% adjustment fits the
// edge exactly. Otherwise centre whole atlases between two masonry margins.
function widthFit(length,width){
  const nearest=Math.round(length/width);
  if(nearest>0&&length/(nearest*width)>=.85&&length/(nearest*width)<=1.15)return {count:nearest,start:0,end:length};
  const count=Math.floor(length/width),start=(length-count*width)/2;return {count,start,end:length-start};
}
function rowFit(height,style){
  const rows=recipes[style.id].rows,bands=[];let total=0,best=null;
  for(let i=0;i<128;i++){
    const row=rows.length-2-i%(rows.length-1),v0=rows[row],v1=rows[row+1];total+=(v1-v0)*style.upperHeight;
    bands.push({v0,v1,height:(v1-v0)*style.upperHeight});
    const ratio=height/total;
    if(ratio>=.85&&ratio<=1.15&&(!best||Math.abs(1-ratio)<best.error))best={bands:[...bands],scale:ratio,error:Math.abs(1-ratio)};
    if(total>height/.85)break;
  }
  if(best)return best;
  total=0;const fitting=[];for(const band of bands){if(total+band.height>height+1e-7)break;fitting.push(band);total+=band.height;}
  return {bands:fitting,scale:1};
}

// Rectangles cover the wall exactly once. Unused width/height has a separate
// window-free material, so neither windows nor storefronts need clipping.
export function osmFacadePanels(length,ground,trim,style){
  const [tileWidth,tileHeight]=osmFacadeTileSize(style),panels=[],blank=(x0,x1,y0,y1)=>{if(x1-x0>1e-7&&y1-y0>1e-7)panels.push({x0,x1,y0,y1,material:5,uv:[x0/tileWidth,-y1/tileHeight,x1/tileWidth,-y0/tileHeight]});};
  function band(y0,y1,width,v0,v1,material){
    const fit=widthFit(length,width);
    if(!fit.count){blank(0,length,y0,y1);return;}
    blank(0,fit.start,y0,y1);panels.push({x0:fit.start,x1:fit.end,y0,y1,material,uv:[0,v0,fit.count,v1]});blank(fit.end,length,y0,y1);
  }
  if(ground/style.groundHeight>=.85)band(0,ground,style.groundWidth,0,1,1);else blank(0,length,0,ground);
  const fit=rowFit(trim-ground,style);let y=ground;
  for(const row of fit.bands){let next=Math.min(trim,y+row.height*fit.scale);if(trim-next<1e-5)next=trim;band(y,next,style.width,row.v0,row.v1,2);y=next;}
  blank(0,length,y,trim);
  return panels;
}
