// Disk STCars offsets, not the larger, reordered runtime S_CARINIT structure.
export const vehicleFields = [
  ['mass',0x000,'Hmotnost','Podvozek',0,undefined,true],
  ['power',0x004,'Výkon (Power)','Motor',0,undefined,true],
  ['powerFactor',0x008,'Koeficient výkonu (GearSpeedFactor)','Motor',0,undefined,true],
  ['redline',0x00c,'Červené pole (RPM)','Motor',0,undefined,true],
  ['maxRPM',0x010,'Maximální otáčky (RPM)','Motor',0,undefined,true],
  ['idleRPM',0x014,'Volnoběžné otáčky (RPM)','Motor',0],
  ['idleMoment',0x018,'Moment při volnoběhu — parametr','Motor',0,undefined,true],
  ['redlineMoment',0x01c,'Moment u červeného pole — parametr','Motor',0,undefined,true],
  ['bandMoment',0x020,'Křivka momentu — parametr 0x020','Motor',0,undefined,true],
  ['bandLowRPM',0x024,'Začátek výkonového pásma (RPM)','Motor',0],
  ['bandHighRPM',0x028,'Konec výkonového pásma (RPM)','Motor',0],
  ['momentFactor',0x02c,'Křivka momentu — parametr 0x02C','Motor',0,undefined,true],
  ['motorTime',0x030,'Motor time — původní parametr','Motor',0,undefined,true],
  ['skidFactor',0x034,'SkidFactor — původní parametr','Podvozek',0],
  ['shiftTime',0x038,'Shift time — původní parametr','Převodovka',0,undefined,true],
  ['motorSpeed',0x03c,'Motor speed — původní parametr','Motor',0,undefined,true],
  ['shiftLowRPM',0x040,'Mez řazení 0x040 (RPM)','Převodovka',0],
  ['shiftHighRPM',0x044,'Mez řazení 0x044 (RPM)','Převodovka',0],
  ['firstGearRPM',0x048,'Mez prvního převodu (RPM)','Převodovka',0],
  ['gears',0x04c,'Počet převodů vpřed','Převodovka',1,10,false,true],
  ...Array.from({length:11},(_,gear)=>[
    [`gear${gear}Ratio`,0x050+gear*12,`${gear?'Převod '+gear:'Zpátečka'} — poměr`,'Převody',0],
    [`gear${gear}Up`,0x054+gear*12,`${gear?'Převod '+gear:'Zpátečka'} — řazení nahoru (%)`,'Převody',0,100],
    [`gear${gear}Down`,0x058+gear*12,`${gear?'Převod '+gear:'Zpátečka'} — řazení dolů (%)`,'Převody',0,100]
  ]).flat(),
  ['massX',0x108,'Relativní těžiště X (0–1)','Podvozek',0,1],
  ['massY',0x10c,'Relativní těžiště Y (0–1)','Podvozek',0,1],
  ['massZ',0x110,'Relativní těžiště Z (0–1)','Podvozek',0,1],
  ['massHeight',0x114,'Těžiště — svislý parametr 0x114','Podvozek',0,undefined,true],
  ['tank',0x118,'Objem nádrže — původní hodnota','Palivo',1],
  ['consumption',0x11c,'Spotřeba — původní hodnota','Palivo',0,undefined,true]
].map(([key,offset,label,group,min,max,positive=false,integer=false])=>({key,offset,label,group,min,max,positive,integer}));
