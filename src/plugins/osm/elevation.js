import {osmArea} from './area.js';

const fail=message=>{throw Error('OpenStreetMap · výšky: '+message);};
// Shared native coordinates for terrain tiles, clipped tops and curb seams.
export const elevationCoordinate=n=>Math.fround(Math.round(n*1e6)/1e6);
const interval=(axis,n)=>{let lo=0,hi=axis.length-1;while(lo+1<hi){const mid=(lo+hi)>>>1;if(axis[mid]<=n)lo=mid;else hi=mid;}return lo;};

// Numeric data only. Providers, download, attribution and project publication
// belong to the host; this immutable grid never fetches or changes a project.
export function osmElevationGrid(settings,expectedArea){
  if(!settings||settings.version!==1)fail('neplatná verze výškového rastru.');
  const area=osmArea(settings.area),expected=osmArea(expectedArea);
  if(['latitude','longitude','size'].some(k=>area[k]!==expected[k]))fail('výškový podklad patří jiné oblasti.');
  const {columns,rows,samples,base}=settings;
  if([columns,rows].some(n=>!Number.isInteger(n)||n<1||n>128))fail('rastr musí mít 1–128 polí v každém směru.');
  if(!Array.isArray(samples)||samples.length!==(columns+1)*(rows+1)||!Array.from(samples).every(n=>typeof n==='number'&&Number.isFinite(n)&&n>=-12000&&n<=9000))fail('neúplný rastr nebo neplatné výšky; chybějící data nelze nahradit nulou.');
  if(typeof base!=='number'||!Number.isFinite(base)||base<.5||base>1000)fail('základní výška musí být 0,5–1000 m.');
  const minimum=Math.min(...samples),maximum=Math.max(...samples),heights=Object.freeze(samples.map(n=>Math.fround(base+n-minimum))),axis=count=>Object.freeze(Array.from({length:count+1},(_,i)=>elevationCoordinate(area.size*(i/count-.5)))),x=axis(columns),z=axis(rows);
  function cell(px,pz){
    if(![px,pz].every(n=>typeof n==='number'&&Number.isFinite(n))||px<x[0]||px>x.at(-1)||pz<z[0]||pz>z.at(-1))fail('bod leží mimo výškový podklad.');
    return [interval(x,px),interval(z,pz)];
  }
  function heightAt(px,pz){
    const [i,j]=cell(px,pz),u=(px-x[i])/(x[i+1]-x[i]),v=(pz-z[j])/(z[j+1]-z[j]),a=j*(columns+1)+i,b=a+1,c=a+columns+1,d=c+1;
    // SW/NW/SE and SE/NW/NE: the same diagonal as native terrain geometry.
    return Math.fround(u+v<=1?heights[a]*(1-u-v)+heights[b]*u+heights[c]*v:heights[d]*(u+v-1)+heights[c]*(1-u)+heights[b]*(1-v));
  }
  function splitEdge(a,b){
    cell(...a);cell(...b);const dx=b[0]-a[0],dz=b[1]-a[1],cuts=new Set([0,1]);
    for(const [axis,start,delta]of [[x,a[0],dx],[z,a[1],dz]])if(delta)for(const value of axis){const t=(value-start)/delta;if(t>0&&t<1)cuts.add(t);}
    const ordered=[...cuts].sort((a,b)=>a-b);
    for(let n=1;n<ordered.length;n++){
      const low=ordered[n-1],high=ordered[n],mid=(low+high)/2,[i,j]=cell(a[0]+dx*mid,a[1]+dz*mid),width=x[i+1]-x[i],depth=z[j+1]-z[j],delta=dx/width+dz/depth;
      if(!delta)continue;const t=(1-(a[0]-x[i])/width-(a[1]-z[j])/depth)/delta;if(t>low+1e-12&&t<high-1e-12)cuts.add(t);
    }
    return [...cuts].sort((a,b)=>a-b).map(t=>({t,point:[a[0]+dx*t,a[1]+dz*t].map(elevationCoordinate)})).filter((v,i,all)=>!i||v.point.some((n,k)=>n!==all[i-1].point[k]));
  }
  return Object.freeze({version:1,area:Object.freeze({...area,bbox:Object.freeze(area.bbox)}),columns,rows,samples:Object.freeze([...samples]),base,minimum,maximum,x,z,heights,cell,heightAt,splitEdge});
}
