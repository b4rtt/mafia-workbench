// Native 4DS thresholds are squared distances, adjusted by engine quality and
// object scale. Keep metres in the reproducible import options.
export function validateOsmBuildingLod(options,facade){
  if(options===undefined)return;
  if(!options||options.version!==1||Object.keys(options).some(k=>!['version','distance'].includes(k))||!Number.isFinite(options.distance)||options.distance<25||options.distance>250||!facade)throw Error('OpenStreetMap · vzdálené domy: zapněte celá okna a zadejte vzdálenost 25–250 m.');
}

// Merge only coplanar, vertically adjacent panels with the same material and
// affine texture mapping, allowing integer V wraps. The full atlas repeats;
// window phase, scale and blank margins remain identical to the editable rows.
export function osmFacadeLodPanels(panels){
  const result=[],close=(a,b)=>Math.abs(a-b)<1e-8;
  for(const panel of panels){
    const next={...panel,uv:[...panel.uv]},previous=result.findLast(p=>p.material===next.material&&close(p.x0,next.x0)&&close(p.x1,next.x1)&&close(p.y1,next.y0)&&close(p.uv[0],next.uv[0])&&close(p.uv[2],next.uv[2]));
    if(previous){
      const shift=Math.round(previous.uv[1]-next.uv[3]),bottom=next.uv[3]+shift,top=next.uv[1]+shift,slope=(previous.uv[1]-previous.uv[3])/(previous.y1-previous.y0),expected=previous.uv[1]+slope*(next.y1-next.y0);
      if(close(bottom,previous.uv[1])&&close(top,expected)){previous.y1=next.y1;previous.uv[1]=top;continue;}
    }
    result.push(next);
  }
  return result;
}
