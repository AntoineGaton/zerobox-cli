/**
 * @module settings
 * settings.json in the data folder: which built-in rules protect senders.
 *
 *   { "protect": { "replied": true, "opened": true, "openedMin": 40,
 *                  "government": true, "health": true, "finance": true,
 *                  "financeMarketing": true, "accountSecurity": true,
 *                  "utilities": true } }
 *
 * Missing keys fall back to the defaults, unknown keys are kept on save, and
 * a corrupt file falls back to the defaults with a one-line warning.
 * Starred mail and your own address are always protected: no setting.
 */

import fs from 'fs';
import path from 'path';

export const OPENED_MIN_RANGE = [10, 100];
export const OPENED_STEP = 5;

/** @typedef {{replied: boolean, opened: boolean, openedMin: number, government: boolean, health: boolean, finance: boolean, financeMarketing: boolean, accountSecurity: boolean, utilities: boolean}} ProtectSettings */

export const DEFAULT_PROTECT = Object.freeze({
  replied: true,
  opened: true,
  openedMin: 40,
  government: true,
  health: true,
  finance: true,
  financeMarketing: true,
  accountSecurity: true,
  utilities: true,
});

export const DEFAULT_SETTINGS = Object.freeze({ protect: DEFAULT_PROTECT });

/** Keys of settings.protect that are on/off switches. */
export const BOOLEAN_KEYS = Object.keys(DEFAULT_PROTECT).filter((k) => typeof DEFAULT_PROTECT[k] === 'boolean');

/** Clamp and round openedMin to the allowed range. */
export function clampOpenedMin(n) {
  const [lo, hi] = OPENED_MIN_RANGE;
  return Math.max(lo, Math.min(hi, Math.round(Number(n))));
}

const isPlainObject = (v) => v != null && typeof v === 'object' && !Array.isArray(v);

/**
 * Merge a parsed settings.json over the defaults. Known keys with the wrong
 * type are replaced by their default; unknown keys are kept as they are.
 * @param {unknown} raw
 * @returns {{protect: ProtectSettings} & Record<string, unknown>}
 */
export function mergeSettings(raw) {
  const top = isPlainObject(raw) ? raw : {};
  const given = isPlainObject(top.protect) ? top.protect : {};
  const protect = { ...given };
  for (const [k, def] of Object.entries(DEFAULT_PROTECT)) {
    const v = given[k];
    if (k === 'openedMin') protect[k] = typeof v === 'number' && Number.isFinite(v) ? clampOpenedMin(v) : def;
    else protect[k] = typeof v === 'boolean' ? v : def;
  }
  return { ...top, protect };
}

/**
 * Read settings.json. Never throws: a missing file gives the defaults, a
 * corrupt one gives the defaults plus a warning to show the user.
 * @param {string} file
 * @returns {{settings: ReturnType<typeof mergeSettings>, warning: string|null}}
 */
export function loadSettings(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return { settings: mergeSettings({}), warning: null };
    return { settings: mergeSettings({}), warning: `Could not read ${file} (${err.code ?? err.message}); using default settings.` };
  }
  try {
    const raw = JSON.parse(text);
    if (!isPlainObject(raw)) throw new Error('not an object');
    return { settings: mergeSettings(raw), warning: null };
  } catch {
    return { settings: mergeSettings({}), warning: `${file} is not valid JSON; using default settings (saving replaces it).` };
  }
}

/**
 * Write settings.json atomically (temp file + rename), readable only by the user.
 * @param {object} settings
 * @param {string} file
 */
export function saveSettings(settings, file) {
  const body = JSON.stringify(mergeSettings(settings), null, 2) + '\n';
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  try {
    fs.writeFileSync(tmp, body, { mode: 0o600 });
    fs.renameSync(tmp, file);
    // rename keeps the temp file's mode, but an older file could have been wider
    fs.chmodSync(file, 0o600);
  } catch (err) {
    try { fs.rmSync(tmp, { force: true }); } catch { /* best effort */ }
    throw err;
  }
}

/**
 * Parse a value for `zerobox settings set <key> <value>`.
 * @returns {{key: string, value: boolean|number}}
 * @throws {Error} with a message fit for the user
 */
export function parseSettingValue(key, value) {
  const known = Object.keys(DEFAULT_PROTECT);
  const k = known.find((n) => n.toLowerCase() === String(key ?? '').replace(/^protect\./i, '').toLowerCase());
  if (!k) throw new Error(`Unknown setting "${key}". Known settings: ${known.join(', ')}.`);
  const v = String(value ?? '').trim().toLowerCase();
  if (k === 'openedMin') {
    const n = Number(v);
    const [lo, hi] = OPENED_MIN_RANGE;
    if (!/^\d+$/.test(v) || n < lo || n > hi) throw new Error(`openedMin must be a whole number from ${lo} to ${hi}.`);
    return { key: k, value: n };
  }
  if (['true', 'on', 'yes', '1'].includes(v)) return { key: k, value: true };
  if (['false', 'off', 'no', '0'].includes(v)) return { key: k, value: false };
  throw new Error(`${k} must be true or false (also on/off).`);
}
