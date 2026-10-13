const { contextBridge, ipcRenderer } = require('electron');
async function invoke(channel, ...args) {
  const result = await ipcRenderer.invoke(channel, ...args);
  if (!result.ok) throw new Error(result.error);
  return result.value;
}
contextBridge.exposeInMainWorld('workbench', {
  project: () => invoke('project:get'),
  open: () => invoke('project:open'),
  create: () => invoke('project:create'),
  inspect: name => invoke('asset:inspect', name),
  media: name => invoke('asset:media', name),
  map: name => invoke('asset:map', name),
  carModels: () => invoke('asset:car-models'),
  pickupItems: () => invoke('asset:pickup-items'),
  replayMissions: name => invoke('replay:missions', name),
  replayContext: (name, scene, difference) => invoke('replay:context', name, scene, difference),
  playtestState: () => invoke('playtest:get'),
  startLevel: name => invoke('playtest:start', name),
  stopLevel: () => invoke('playtest:stop'),
  onPlaytest: callback => ipcRenderer.on('playtest:state', (_event, state) => callback(state)),
  importLoose: () => invoke('project:loose'),
  missionTemplate: () => invoke('mission:template'),
  createMission: options => invoke('mission:create', options),
  saveTexts: (name, changes, expectedHash) => invoke('asset:texts', name, changes, expectedHash),
  saveScene: (name, changes, expectedHash) => invoke('asset:scene', name, changes, expectedHash),
  changeSceneObject: (name, operation, expectedHash) => invoke('asset:scene-object', name, operation, expectedHash),
  saveModel: (name, changes, expectedHash) => invoke('asset:model', name, changes, expectedHash),
  saveAnimation: (name, changes, expectedHash) => invoke('asset:animation', name, changes, expectedHash),
  saveCache: (name, changes, expectedHash) => invoke('asset:cache', name, changes, expectedHash),
  saveItems: (name, changes, expectedHash) => invoke('asset:items', name, changes, expectedHash),
  saveVehicles: (name, changes, expectedHash) => invoke('asset:vehicles', name, changes, expectedHash),
  saveNavigation: (name, changes, expectedHash) => invoke('asset:navigation', name, changes, expectedHash),
  changeNavigationConnection: (name, request, expectedHash) => invoke('asset:navigation-connection', name, request, expectedHash),
  changeNavigationPoint: (name, request, expectedHash) => invoke('asset:navigation-point', name, request, expectedHash),
  saveRoads: (name, changes, expectedHash) => invoke('asset:roads', name, changes, expectedHash),
  saveTrack: (name, changes, expectedHash) => invoke('asset:track', name, changes, expectedHash),
  saveDifference: (name, changes, expectedHash) => invoke('asset:difference', name, changes, expectedHash),
  saveReplay: (name, changes, expectedHash) => invoke('asset:replay', name, changes, expectedHash),
  restore: name => invoke('asset:restore', name),
  undo: () => invoke('project:undo'),
  replace: name => invoke('asset:replace', name),
  export: () => invoke('project:export'),
  onProgress: callback => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on('extraction:progress', listener);
    return () => ipcRenderer.removeListener('extraction:progress', listener);
  }
});
