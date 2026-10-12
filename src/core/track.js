// Own reader/writer, based on the game's recorder_load_tck and
// anim_machine_load_track. Only version 4's two vector arrays are interpreted.
function layout(source) {
  const bytes = Buffer.from(source);
  if (bytes.length < 44 || bytes.readUInt32LE(0) !== 4) throw new Error('TCK: podporovaná je pouze stopa verze 4.');
  const duration = bytes.readUInt32LE(28), step = bytes.readUInt32LE(32), count = bytes.readUInt32LE(36);
  if (!step || !count || count > 1000000 || (count - 1) * step !== duration) throw new Error('TCK: neplatné počty nebo časování klíčů.');
  const secondCountOffset = 40 + count * 12;
  if (secondCountOffset + 4 > bytes.length) throw new Error('TCK: neúplná dráha.');
  const secondaryCount = bytes.readUInt32LE(secondCountOffset), secondaryOffset = secondCountOffset + 4;
  if (secondaryCount && secondaryCount !== count) throw new Error('TCK: nepodporovaný počet doplňkových vektorů.');
  const end = secondaryOffset + secondaryCount * 12;
  if (end > bytes.length) throw new Error('TCK: neúplné doplňkové vektory.');
  const vector = offset => {
    const value = [0,1,2].map(i => bytes.readFloatLE(offset + i * 4));
    if (value.some(n => !Number.isFinite(n))) throw new Error('TCK: neplatný vektor.');
    return value;
  };
  const positions = Array.from({length:count}, (_,i) => vector(40 + i * 12));
  const secondary = Array.from({length:secondaryCount}, (_,i) => vector(secondaryOffset + i * 12));
  return {bytes, duration, step, positions, secondary, secondaryOffset, tailBytes:bytes.length-end, headerVectors:[vector(4),vector(16)]};
}
export function parseTrack(source) {
  const {bytes, secondaryOffset, ...track} = layout(source);
  return track;
}
export function editTrack(source, changes) {
  const track = layout(source), result = Buffer.from(track.bytes), seen = new Set();
  if (!Array.isArray(changes) || changes.length > 1024) throw new Error('TCK: neplatné změny.');
  for (const change of changes) {
    const match = /^(positions|secondary)\/(0|[1-9]\d*)$/.exec(change?.id ?? '');
    if (!match || seen.has(change.id)) throw new Error('TCK: neplatný nebo opakovaný klíč.');
    seen.add(change.id);
    const [,channel,rawIndex] = match, index = Number(rawIndex), original = track[channel][index], value = change.value;
    if (!original || !Array.isArray(value) || value.length !== 3 || value.some(n => typeof n !== 'number' || !Number.isFinite(n) || !Number.isFinite(Math.fround(n)))) throw new Error('TCK: vektor musí obsahovat tři konečná čísla float32.');
    const offset = (channel === 'positions' ? 40 : track.secondaryOffset) + index * 12;
    // Unchanged components preserve their original representation, including -0.
    value.forEach((n,i) => { if (n !== original[i]) result.writeFloatLE(n,offset+i*4); });
  }
  return result;
}
