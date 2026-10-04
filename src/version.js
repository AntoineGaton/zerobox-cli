/**
 * @module version
 * The package version, read from package.json so it is defined in one place.
 * package.json sits one level up from both src/ (dev) and dist/ (installed).
 */

import fs from 'fs';

export const VERSION = JSON.parse(
  fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')
).version;
