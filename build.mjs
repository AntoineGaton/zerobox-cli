// Bundles src/ (including the Ink .tsx menu) into one ESM file for npm.
// Runtime dependencies stay external and are installed from package.json.
import { build } from 'esbuild';
import { rmSync } from 'fs';

rmSync('dist', { recursive: true, force: true });

await build({
  entryPoints: { zerobox: 'src/index.js' },
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  packages: 'external',
  outdir: 'dist',
  logLevel: 'info',
});
