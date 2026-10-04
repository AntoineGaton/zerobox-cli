/**
 * @module paths
 * Where ZeroBox keeps its files, so it works from any directory once installed.
 *
 *   Linux    $XDG_CONFIG_HOME/zerobox  (default ~/.config/zerobox)
 *   macOS    ~/Library/Application Support/zerobox
 *   Windows  %APPDATA%\zerobox
 *
 * Set ZEROBOX_HOME to override.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

function resolveHome() {
  if (process.env.ZEROBOX_HOME) return path.resolve(process.env.ZEROBOX_HOME);
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'zerobox');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'zerobox');
  }
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'zerobox');
}

export const ZEROBOX_HOME = resolveHome();

// Holds an OAuth token and mailbox metadata: keep it private to the user
fs.mkdirSync(ZEROBOX_HOME, { recursive: true, mode: 0o700 });

const inHome = (name) => path.join(ZEROBOX_HOME, name);

/**
 * credentials.json lives in ZEROBOX_HOME, but one in the current directory is
 * still honoured so running from a repo checkout keeps working.
 * Checked on each call: `zerobox setup` can create it while ZeroBox runs.
 */
export function credentialsPath() {
  const home = HOME_CREDENTIALS_PATH;
  const local = path.join(process.cwd(), 'credentials.json');
  if (!fs.existsSync(home) && fs.existsSync(local)) return local;
  return home;
}

/** Where `zerobox setup` writes the client. */
export const HOME_CREDENTIALS_PATH = inHome('credentials.json');
/** Resolved at startup; use credentialsPath() after `zerobox setup` may have run. */
export const CREDENTIALS_PATH = credentialsPath();
export const TOKEN_PATH = inHome('token.json');
export const CACHE_PATH = inHome('scan-cache.json');
export const UNSUB_STATUS_PATH = inHome('unsubscribe-status.json');
export const PROTECTED_PATH = inHome('protected.txt');
export const SETTINGS_PATH = inHome('settings.json');
export const LOG_PATH = inHome(process.env.LOG_FILE ?? 'cleanup-log.json');
