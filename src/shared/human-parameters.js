// C_human v6; statistical defaults follow the engine's human_ctor.
const labels = ['Síla','Energie (maximum)','Energie levé ruky (maximum)','Energie pravé ruky (maximum)','Energie levé nohy (maximum)','Energie pravé nohy (maximum)','Reakce','Rychlost','Agresivita','Inteligence','Střelba','Zrak','Sluch','Řízení','Hmotnost','Doplňkový parametr chování'];
const defaults = [.7,100,20,20,20,20,.7,1,.6,.8,.7,1,1,.8,80,.5];
export const humanFields = [
  { key:'reactionsMask', label:'Reakce (dolní bajt příznaků)', kind:'byte', offset:1, default:0 },
  { key:'voice', label:'Hlas (ID)', kind:'byte', offset:5, default:0 },
  ...labels.map((label,index)=>({key:`stat${index}`,label,kind:'float',offset:9+4*index,maximum:index<15,default:defaults[index]}))
];
