export const categories = [
  ['levels', 'Mapy a mise'], ['models', 'Modely 4DS'], ['textures', 'Textury a obrázky'],
  ['animations', 'Animace 5DS'], ['music', 'Hudba'], ['sounds', 'Zvuky a dialogy'],
  ['texts', 'Texty'], ['tables', 'Tabulky a nastavení'], ['cutscenes', 'Cutscény'], ['other', 'Ostatní'],
  ['all', 'Všechny soubory'], ['changed', 'Upravené']
];
export function assetCategory(name) {
  const p = name.replaceAll('\\', '/').toLowerCase();
  if (/textdb_[a-z]{2}\.def$/.test(p)) return 'texts';
  if (/\.(bmp|png|jpe?g|tga|dds)$/.test(p)) return 'textures';
  if (/\.5ds$/.test(p)) return 'animations';
  if (/\.(tck|chg|rep|bik|avi|mp4)$/.test(p)) return 'cutscenes';
  if (/(^|\/)music\//.test(p)) return 'music';
  if (/\.(wav|ogg|mp3|flac)$/.test(p)) return 'sounds';
  if (/^missions\//.test(p)) return 'levels';
  if (/\.4ds$/.test(p)) return 'models';
  if (/^tables\//.test(p) || /\.(def|ini|cfg)$/.test(p)) return 'tables';
  return 'other';
}
export function groupAssets(files) {
  const groups = new Map();
  for (const file of files) {
    const folder = file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : 'Kořen hry';
    const key = folder.normalize('NFC').toLowerCase();
    if (!groups.has(key)) groups.set(key, { folder, files: [] });
    groups.get(key).files.push(file);
  }
  return [...groups.values()];
}
