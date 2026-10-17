import {roadConnections,roadSettingsPair} from './roads.js';

// Editor diagram in LS3D coordinates, before the viewport's Z reflection.
// Native lane.distance is a signed band width, not its centre offset.
// Each band consumes its full width, including inactive/AI-only bands;
// traffic/parking centres are previous widths + half the current width.
// AI-only arrows show that band schematically, not an engine AI trajectory.
// Positive offsets follow the horizontal right vector: up × forward.
// Arrows are independent segment markers, not an engine lane/turn simulation.
export function roadLanePreview(file,selection,positions=null){
  const result={arrows:[],warnings:[],roads:0,inactive:0};
  const total=file.crossings.length,point=index=>positions?.[index]??(index<total?file.crossings[index]?.position:file.nodes[index-total]?.position);
  let connections;
  if(!Number.isInteger(selection)||selection<0||selection>=total+file.nodes.length)return result;
  if(selection<total)connections=roadConnections(file,selection).map(link=>({from:selection,...link}));
  else {
    const node=file.nodes[selection-total],owner=node.previousCrossing;
    connections=roadConnections(file,owner).filter(link=>link.nodes.includes(32768|(selection-total))).map(link=>({from:owner,...link}));
    if(connections.length!==1){result.warnings.push('Bod nemá jednoznačnou silnici pro náhled pruhů.');return result;}
  }
  for(const link of connections){
    const pair=roadSettingsPair(file,link.from,link.slot);
    if(!pair){result.warnings.push(`Výjezd ${link.from}/${link.slot}: nejednoznačný zpáteční řetězec.`);continue;}
    result.roads++;
    const chain=[link.from,...link.nodes.map(ref=>total+(ref&32767)),link.target];
    for(const [direction,from,to,refs]of [[pair.forward,link.from,link.target,chain],[pair.reverse,link.target,link.from,[...chain].reverse()]]){
      if(!direction.enabled){result.inactive++;if(direction.target!==65535&&direction.target!==to)result.warnings.push(`Směr ${from} → ${to}: uložený cíl nesouhlasí s cestou.`);continue;}
      const lanes=[];let edge=0;
      for(const [index,lane]of direction.lanes.entries()){
        if(!Number.isFinite(lane.distance)){
          result.warnings.push(`Směr ${from} → ${to}, pruh ${index+1}: neplatná šířka pásu; poloha tohoto a dalších pruhů není určitelná.`);break;
        }
        const offset=edge+lane.distance/2;edge+=lane.distance;
        if(!Number.isFinite(offset)||!Number.isFinite(edge)){result.warnings.push(`Směr ${from} → ${to}, pruh ${index+1}: šířky pásů překračují rozsah náhledu.`);break;}
        if(!lane.type)continue;
        if(![1,2,3].includes(lane.type)){result.warnings.push(`Směr ${from} → ${to}, pruh ${index+1}: raw typ ${lane.type} nemá náhled.`);continue;}
        lanes.push({...lane,index,offset});
      }
      for(let i=1;i<refs.length;i++){
        const a=point(refs[i-1]),b=point(refs[i]);
        if(!a||!b||a.some(n=>!Number.isFinite(n))||b.some(n=>!Number.isFinite(n))){result.warnings.push(`Směr ${from} → ${to}: neplatná poloha úseku.`);continue;}
        const delta=b.map((n,j)=>n-a[j]),horizontal=Math.hypot(delta[0],delta[2]),length=Math.hypot(...delta);
        if(horizontal<1e-8||length<1e-8){result.warnings.push(`Směr ${from} → ${to}: úsek nemá směr XZ.`);continue;}
        const forward=delta.map(n=>n/length),right=[delta[2]/horizontal,0,-delta[0]/horizontal],size=Math.min(3.5,length*.5),head=Math.min(.6,size*.3);
        for(const lane of lanes){
          const center=a.map((n,j)=>(n+b[j])/2+right[j]*lane.offset+(j===1?.08:0));
          const start=center.map((n,j)=>n-forward[j]*size/2),end=center.map((n,j)=>n+forward[j]*size/2);
          const wing=side=>end.map((n,j)=>n-forward[j]*head+side*right[j]*head*.6);
          const left=wing(-1),rightWing=wing(1);
          if([...start,...end,...left,...rightWing].every(n=>Number.isFinite(Math.fround(n))))result.arrows.push({from,to,lane:lane.index,type:lane.type,distance:lane.distance,offset:lane.offset,start,end,left,right:rightWing});
          else result.warnings.push(`Směr ${from} → ${to}, pruh ${lane.index+1}: náhled překračuje rozsah float32.`);
        }
      }
    }
  }
  result.warnings=[...new Set(result.warnings)];return result;
}
