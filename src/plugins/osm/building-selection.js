// Categories are audited from the original models, not inferred from filenames.
// OSM building describes the physical form, not a business currently inside it.
export const osmBuildingKindLabels=Object.freeze({house:'Rodinný dům',urban:'Městský dům'});
const urban=['3rad02','3rad03','3rad05','3rad06','3rad08','9dum6r','%radovk18','%radovk34','%radovk5','%radovk9','%radovk10','%radovk30','%hotelv4','dum01','newdum8'];
const houses=['#rad022','#rad013','#rad015','#rad016','#rad017','#rad018','#rad020','#rad035','#rad042'];
export const osmBuildingProfiles=Object.freeze([...urban.map(name=>({path:`models/${name}.4ds`,kind:'urban'})),...houses.map(name=>({path:`models/${name}.4ds`,kind:'house'}))].map(Object.freeze));
export const osmBuildingProfile=path=>osmBuildingProfiles.find(p=>p.path.toLowerCase()===path.toLowerCase());
export function validateOsmBuildingMatching(options){
  if(options!==undefined&&(!options||options.version!==1||Object.keys(options).some(k=>k!=='version')))throw Error('OpenStreetMap · budovy: neplatná pravidla výběru modelů.');
}
export function osmBuildingMatch(tags,fallback){
  const type=tags.building;
  if(['house','detached','semidetached_house','bungalow'].includes(type))return {kind:'house',fallbackHeight:Math.min(fallback,type==='bungalow'?6:9),note:'Rodinný dům podle OSM; model je rozměrová náhrada.'};
  if(['apartments','terrace','office','commercial','retail','hotel'].includes(type))return {kind:'urban',fallbackHeight:fallback,note:'Městský dům podle OSM; model je rozměrová náhrada.'};
  if(['yes','residential'].includes(type))return {kind:'mixed',fallbackHeight:fallback,note:'OSM neurčuje konkrétní formu domu; výběr podle rozměrů a výšky.'};
  return {kind:'unsupported',fallbackHeight:fallback,note:`Pro typ building=${type??'neznámý'} není v katalogu ověřený vhodný model.`};
}
export function osmBuildingTie(way,path){
  return [...`${way}/${path.toLowerCase()}`].reduce((n,c)=>Math.imul(n^c.charCodeAt(0),16777619)>>>0,2166136261);
}
