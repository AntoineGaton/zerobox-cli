/**
 * @module oauth-code
 * Helpers for signing in when no browser can reach this machine
 * (SSH, mosh, a server). Pure functions so they can be unit-tested.
 */

/**
 * True when the OAuth redirect to http://localhost can't come back to us:
 * an SSH session, Linux with no display, or ZEROBOX_NO_BROWSER=1.
 * ZEROBOX_NO_BROWSER=0 forces the browser flow (e.g. SSH with port forwarding).
 * @param {NodeJS.ProcessEnv} [env]
 * @param {string} [platform]
 */
export function isHeadless(env = process.env, platform = process.platform) {
  if (env.ZEROBOX_NO_BROWSER === '1') return true;
  if (env.ZEROBOX_NO_BROWSER === '0') return false;
  if (env.SSH_CONNECTION || env.SSH_TTY) return true;
  return platform === 'linux' && !env.DISPLAY && !env.WAYLAND_DISPLAY;
}

/**
 * Pull the authorization code out of what the user pasted: either the full
 * localhost URL Google redirected to (which fails to load on their phone)
 * or just the code itself.
 * @param {string} input
 * @returns {string} the code
 * @throws {Error} if Google returned an error or nothing usable was pasted
 */
export function codeFromPaste(input) {
  const text = (input ?? '').trim();
  if (!text) throw new Error('Nothing pasted.');

  // Mobile browsers often copy the address without its scheme
  // ("localhost:35651/?code=..."), so treat anything URL-shaped as a URL.
  if (/^https?:\/\//i.test(text) || /^localhost[:/]/i.test(text) || /[?&](code|error)=/.test(text)) {
    const url = new URL(/^https?:\/\//i.test(text) ? text : `http://${text}`);
    const error = url.searchParams.get('error');
    if (error) throw new Error(`Google returned an error: ${error}`);
    const code = url.searchParams.get('code');
    if (!code) throw new Error('That URL has no ?code= in it. Copy the address after approving access.');
    return code;
  }

  if (/\s/.test(text)) throw new Error('That does not look like a code or a URL.');
  return text;
}
