export function pickupParameters(itemId, clip, reserve) {
  if (!Number.isInteger(itemId) || itemId < 1 || itemId > 65535) throw new Error('Předmět: ID musí být celé číslo 1–65535.');
  for (const value of [clip, reserve]) if (!Number.isInteger(value) || value < 0 || value > 2147483647) throw new Error('Předmět: počty nábojů musí být nezáporná celá čísla do 2147483647.');
  return { itemId, clip, reserve };
}
export function pickupScript(name, itemId, clip, reserve) {
  pickupParameters(itemId, clip, reserve);
  if (typeof name !== 'string' || !/^[a-zA-Z0-9_#][a-zA-Z0-9_# -]{0,62}$/.test(name) || name !== name.trim()) throw new Error('Předmět: neplatný název.');
  return `// Mafia Workbench pickup v1\r\ndim_frm 1\r\nfindframe 0, "${name}"\r\ncreateweaponfromframe 0, ${itemId}, ${clip}, ${reserve}\r\nend\r\n`;
}
export function parsePickupScript(name, code) {
  const match = /^\/\/ Mafia Workbench pickup v1\r\ndim_frm 1\r\nfindframe 0, "([^"\r\n]+)"\r\ncreateweaponfromframe 0, (\d+), (\d+), (\d+)\r\nend\r\n$/.exec(code);
  if (!match || match[1] !== name) return null;
  try {
    const result = pickupParameters(...match.slice(2).map(Number));
    return pickupScript(name, result.itemId, result.clip, result.reserve) === code ? result : null;
  } catch { return null; }
}
