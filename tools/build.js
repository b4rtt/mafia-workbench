import { build } from 'esbuild';
await build({ entryPoints: ['src/ui/app.js'], outfile: 'out/app.js', bundle: true, format: 'esm', platform: 'browser', target: 'chrome140', sourcemap: true, legalComments: 'linked' });
