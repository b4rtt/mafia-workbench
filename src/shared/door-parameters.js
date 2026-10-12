export const doorFields = [
  {key:'bothDirections',label:'Otevírat od postavy na obě strany',kind:'boolean',offset:5,default:true},
  {key:'reverse',label:'Obrácený směr otevření',kind:'boolean',offset:6,default:false},
  {key:'angle',label:'Úhel otevření (stupně)',kind:'float',offset:7,factor:180/Math.PI,max:360,default:90},
  {key:'opened',label:'Na začátku otevřené',kind:'boolean',offset:11,default:false},
  {key:'locked',label:'Zamčené',kind:'boolean',offset:12,default:false},
  {key:'openSpeed',label:'Rychlost otevření (stupně/s)',kind:'float',offset:13,factor:180000/Math.PI,default:90},
  {key:'closeSpeed',label:'Rychlost zavření (stupně/s)',kind:'float',offset:17,factor:180000/Math.PI,default:90},
  {key:'openSound',label:'Zvuk otevření',kind:'string',offset:21,default:'d_woodop.wav'},
  {key:'closeSound',label:'Zvuk zavření',kind:'string',offset:37,default:'d_woodcl.wav'},
  {key:'lockedSound',label:'Zvuk zamčených dveří',kind:'string',offset:53,default:'d_woodlo.wav'}
];
