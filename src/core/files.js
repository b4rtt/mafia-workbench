import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { relativeAssetPath } from './dta.js';
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export async function safePath(root, relative, makeParents = false) {
  const parts = relativeAssetPath(relative).split('/');
  const rootStat = await fs.lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('Kořen projektu není vlastní adresář.');
  let current = root;
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i]);
    let stat;
    try { stat = await fs.lstat(current); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      if (i < parts.length - 1) {
        if (!makeParents) throw error;
        await fs.mkdir(current); stat = await fs.lstat(current);
      } else return current;
    }
    if (stat.isSymbolicLink() || (i < parts.length - 1 && !stat.isDirectory()) || (i === parts.length - 1 && !stat.isFile())) throw new Error(`Projekt obsahuje nebezpečný odkaz nebo typ souboru: ${relative}`);
    if (stat.isFile() && stat.nlink > 1) throw new Error(`Projekt obsahuje sdílený pevný odkaz: ${relative}`);
  }
  return current;
}
export async function readSafe(root, relative) {
  const file = await safePath(root, relative);
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { return await handle.readFile(); } finally { await handle.close(); }
}
export async function writeSafe(root, relative, bytes, exclusive = false) {
  const target = await safePath(root, relative, true);
  const temporaryRelative = `${relative}.${randomUUID()}.tmp`;
  const temporary = await safePath(root, temporaryRelative, true);
  const handle = await fs.open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
  try {
    await safePath(root, relative);
    if (exclusive) { await fs.link(temporary, target); await fs.unlink(temporary); }
    else await fs.rename(temporary, target);
  } catch (error) { await fs.unlink(temporary).catch(() => {}); throw error; }
}
