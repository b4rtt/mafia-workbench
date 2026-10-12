import { createProject } from '../src/core/project.js';
const [game, destination, ...extra] = process.argv.slice(2);
if (!game || !destination || extra.length) { console.error('Použití: npm run extract -- SLOŽKA_HRY NOVÝ_PROJEKT'); process.exitCode = 1; }
else {
  try {
    let lastArchive;
    const project = await createProject(game, destination, p => { if (lastArchive !== p.archive || p.current === p.total) console.log(`${p.archive}: ${p.current}/${p.total}`); lastArchive = p.archive; });
    console.log(`Hotovo: ${project.manifest.assets.length} souborů; ${project.root}`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
