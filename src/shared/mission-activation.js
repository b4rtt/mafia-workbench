// Reserved labels 3/4 and flt[0] run before each recipe initializes its state.
// Mask 1 is enforced by the scene writers: only the player activates this sphere.
export function missionActivation(trigger = 'use', radius = null, context = 'Spuštění') {
  if (!['use', 'load', 'area'].includes(trigger)) throw new Error(`${context}: vyberte použití bodu, načtení nebo přiblížení hráče.`);
  if (trigger !== 'area') {
    if (radius !== null) throw new Error(`${context}: poloměr patří pouze k oblasti.`);
    return '';
  }
  if (typeof radius !== 'number' || !Number.isFinite(radius) || radius <= 0 || !Number.isFinite(Math.fround(radius)) || Math.fround(radius) <= 0) throw new Error(`${context}: poloměr oblasti musí být kladné konečné číslo.`);
  return `label 3\ndetector_inrange 0, ${radius}\nif flt[0] > 0, 4, -1\nwait 100\ngoto 3\nlabel 4\n`;
}

// This is only a candidate; callers require their entire recipe to round trip.
export function inspectMissionActivation(source) {
  const area = /^detector_inrange 0, ([\d.e+-]+)$/m.exec(source);
  return area ? { trigger: 'area', triggerRadius: Number(area[1]) } : { trigger: /^detector_waitforuse \d+$/m.test(source) ? 'use' : 'load' };
}
