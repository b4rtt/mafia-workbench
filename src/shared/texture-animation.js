// 4DS v29 ANIMATION (RoadTrain template / Mafia4Blender): frame count,
// unknown u16, frame period in milliseconds, two unknown u32s. Read only.
export function textureSequence(source) {
  if (!(source?.flags & 0x04000000)) return null;
  const a = source.animation, match = /^(.*?)(\d+)(\.[^./\\]+)$/.exec(source.texture ?? '');
  if (!a || !Number.isInteger(a.frames) || a.frames < 1 || a.frames > 128 || !Number.isInteger(a.delay) || a.delay < 1 || a.unknown || a.unknown2 || a.unknown3 || !match || match[2].length > 6) throw Error('Nepodporovaná animovaná textura: ' + source.texture);
  const start = Number(match[2]), width = match[2].length;
  if (String(start + a.frames - 1).length > width) throw Error('Neplatné číslování animované textury: ' + source.texture);
  return { delay: a.delay, names: Array.from({ length: a.frames }, (_, i) => match[1] + String(start + i).padStart(width, '0') + match[3]) };
}

export function textureFrame(sequence, age) {
  return Math.floor(Math.max(0, age ?? 0) / sequence.delay) % sequence.names.length;
}
