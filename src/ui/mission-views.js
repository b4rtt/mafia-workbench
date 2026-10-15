import { missionParts, missionViewKey } from '../shared/mission-parts.js';

// Retain only views of mission assets, scoped to the project and editor type.
export class MissionViews {
  constructor() { this.views = new Map(); }
  clear() { this.views.clear(); }
  remember(view) {
    if (!view || view.disposed || !view.projectRoot) return;
    if (view.logicPath) {
      this.views.set(missionViewKey(view.projectRoot, view.logicPath, 'logic'), view.captureLogic());
      return;
    }
    let path, type, value;
    if (view.mapPath) {
      path=view.mapPath;type='map';value={selectedName:view.selectedName,mode:view.gizmo.mode,backdrop:view.backdrop?.visible,collisions:view.collisionOverlay?.visible,sounds:view.soundExtentVisible,lights:view.lightPreviewVisible,areas:view.missionAreasVisible};
    } else if (view.modelPath) {
      path=view.modelPath;type='model';value={selectedId:view.selectedId,mode:view.gizmo.mode,wireframe:view.modelWireframe,sectors:view.sectorsVisible};
    } else if (view.navigationPath || view.roadPath) {
      path=view.navigationPath??view.roadPath;type=view.navigationPath?'navigation':'roads';value={selectedPoint:view.selectedPoint,geometry:view.navigationGeometryWanted??view.roadGeometryWanted};
      if(view.roadPath)value.lanes=view.roadLanesVisible;
    } else if (view.effectsPath) {
      path=view.effectsPath;type='effects';value={selectedId:view.selectedId,geometry:view.contextGeometry?.visible};
    } else if (view.collisionPath) {
      path=view.collisionPath;type='collision';value={selectedId:view.selectedId,search:view.collisionSearch,type:view.collisionType,mode:view.gizmo.mode,geometry:view.collisionGeometryWanted};
    } else return;
    if (!missionParts([{path}],path).length) return;
    this.views.set(missionViewKey(view.projectRoot,path,type),{...value,camera:view.captureCamera()});
  }
  get(root, file) { return this.views.get(missionViewKey(root,file.path,file.type))??null; }
}
