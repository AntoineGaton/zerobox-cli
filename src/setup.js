/**
 * @module setup
 * Pure helpers for `zerobox setup`: check a Google OAuth client the user
 * downloaded or typed, and build the credentials.json ZeroBox reads.
 * No I/O here so it can be unit-tested; the wizard is commands/setup.js.
 */

export const SETUP_STEPS = [
  { title: 'Create a Google Cloud project, or pick one you already have', url: 'https://console.cloud.google.com/projectcreate' },
  { title: 'Enable the Gmail API for that project', url: 'https://console.cloud.google.com/apis/library/gmail.googleapis.com' },
  { title: 'Audience: choose External, then add your Gmail address as a test user', url: 'https://console.cloud.google.com/auth/audience' },
  { title: 'Create a client: Application type "Desktop app", then Download JSON', url: 'https://console.cloud.google.com/auth/clients/create' },
];

const CLIENT_ID_RE = /^[\w.-]+\.apps\.googleusercontent\.com$/;

/**
 * @param {string} id
 * @returns {string|null} a problem to show, or null when it looks right
 */
export function checkClientId(id) {
  const text = (id ?? '').trim();
  if (!text) return 'The Client ID is empty.';
  if (!CLIENT_ID_RE.test(text)) return 'A Client ID ends with .apps.googleusercontent.com. Copy it from the client page.';
  return null;
}

/**
 * @param {string} secret
 * @returns {string|null} a problem to show, or null when it looks right
 */
export function checkClientSecret(secret) {
  const text = (secret ?? '').trim();
  if (!text) return 'The Client secret is empty.';
  if (/\s/.test(text)) return 'The Client secret has spaces in it. Copy it again from the client page.';
  if (text.length < 10) return 'That Client secret looks too short. Copy it again from the client page.';
  return null;
}

/**
 * Read a downloaded client JSON.
 * @param {string} text  file contents
 * @returns {{ok: true, clientId: string, clientSecret: string} | {ok: false, kind: 'web'|'invalid', message: string}}
 */
export function parseClientJson(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, kind: 'invalid', message: 'That file is not valid JSON. Use the file from "Download JSON" on the client page.' };
  }
  if (parsed?.web && !parsed?.installed) {
    return {
      ok: false,
      kind: 'web',
      message: 'This is a "Web application" client. ZeroBox needs a "Desktop app" client: '
        + 'Web clients reject the local sign-in address ZeroBox uses. '
        + 'Create a new client with Application type "Desktop app" and download its JSON.',
    };
  }
  const c = parsed?.installed;
  if (!c || typeof c !== 'object') {
    return { ok: false, kind: 'invalid', message: 'That JSON is not a Google OAuth client (no "installed" section).' };
  }
  const problem = checkClientId(c.client_id) ?? checkClientSecret(c.client_secret);
  if (problem) return { ok: false, kind: 'invalid', message: problem };
  return { ok: true, clientId: c.client_id.trim(), clientSecret: c.client_secret.trim() };
}

/**
 * The credentials.json body for a Desktop app client, the same shape Google
 * downloads. ZeroBox picks a free localhost port at sign-in.
 * @param {{clientId: string, clientSecret: string}} client
 * @returns {object}
 */
export function buildCredentials({ clientId, clientSecret }) {
  return {
    installed: {
      client_id: clientId.trim(),
      auth_uri: 'https://accounts.google.com/o/oauth2/auth',
      token_uri: 'https://oauth2.googleapis.com/token',
      auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
      client_secret: clientSecret.trim(),
      redirect_uris: ['http://localhost'],
    },
  };
}

/**
 * Turn what the user pasted as a file path into a path: strips the quotes
 * terminals add when a file is dragged in, unescapes "\ ", expands ~.
 * @param {string} input
 * @param {string} home  the user's home directory
 * @returns {string}
 */
export function cleanPath(input, home) {
  let text = (input ?? '').trim();
  if (/^(['"]).*\1$/.test(text) && text.length >= 2) text = text.slice(1, -1);
  else if (!/^[A-Za-z]:\\/.test(text)) text = text.replace(/\\ /g, ' ');
  if (text === '~') return home;
  if (text.startsWith('~/') || text.startsWith('~\\')) return home + text.slice(1);
  return text;
}
