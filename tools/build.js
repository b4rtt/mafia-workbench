import { build } from 'esbuild';
import { prepareFace } from './prepare-face.js';
await build({ entryPoints: ['src/ui/app.js'], outfile: 'out/app.js', bundle: true, format: 'esm', platform: 'browser', target: 'chrome140', sourcemap: true, legalComments: 'linked' });
await build({ entryPoints: ['src/ui/face-worker.js'], outfile: 'out/face-worker.js', bundle: true, format: 'iife', platform: 'browser', target: 'chrome140', legalComments: 'linked' });
await prepareFace();
