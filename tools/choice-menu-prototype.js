// Standalone diagnostic entry point. Production Playtest uses the same scoped
// runtime extension in its private copy; exports never contain an executable.
import { patchDirectLevelExe } from '../src/core/playtest.js';
import { patchScopedChoiceMenuRuntime } from '../src/core/choice-menu-runtime.js';
export { choiceMenuMarkerBase, choiceMenuStatusMarkerBase } from '../src/shared/choice-menu-protocol.js';
export function patchScopedChoiceMenu(source) {
  return patchScopedChoiceMenuRuntime(source, patchDirectLevelExe(source));
}
