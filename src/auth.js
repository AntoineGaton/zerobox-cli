/**
 * @module auth
 * OAuth2 authentication flow for Gmail API.
 * Caches tokens in ZEROBOX_HOME/token.json for reuse across sessions.
 */

import { google } from 'googleapis';
import fs from 'fs/promises';
import http from 'http';
import net from 'net';
import { URL } from 'url';
import { existsSync } from 'fs';
import chalk from 'chalk';
import open from 'open';
import readline from 'readline';

import { credentialsPath, TOKEN_PATH } from './paths.js';
import { isHeadless, codeFromPaste } from './oauth-code.js';

// https://mail.google.com/ is required for messages.batchDelete (permanent delete).
// gmail.modify alone only covers read/trash/send — NOT hard-delete.
// gmail.settings.basic is needed for filter creation.
const SCOPES = [
  'https://mail.google.com/',
  'https://www.googleapis.com/auth/gmail.settings.basic',
];

const NO_CLIENT = 'ZeroBox is not connected to a Google client yet. Run `zerobox setup` (about 5 minutes, once).';

/**
 * With no credentials.json, offer the setup wizard in an interactive
 * terminal; elsewhere fail with a pointer to `zerobox setup`.
 * @throws {Error} when there is still no client afterwards
 */
async function ensureCredentials() {
  if (existsSync(credentialsPath())) return;
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error(NO_CLIENT);
  console.log(chalk.bold('\n  ZeroBox needs your own Google client before it can read Gmail.'));
  console.log('  The guided setup takes about 5 minutes, once.\n');
  const { runSetup } = await import('./commands/setup.js');
  await runSetup({ signIn: false });
  if (!existsSync(credentialsPath())) throw new Error(NO_CLIENT);
  console.log('');
}

/**
 * Load OAuth2 client credentials from credentials.json.
 * @returns {Promise<{clientId: string, clientSecret: string, redirectUri: string}>}
 * @throws {Error} if credentials.json is missing
 */
async function loadCredentials() {
  await ensureCredentials();
  let raw;
  try {
    raw = await fs.readFile(credentialsPath(), 'utf8');
  } catch (err) {
    throw new Error(`Could not read ${credentialsPath()}: ${err.message}. Run \`zerobox setup\` to set it up again.`);
  }

  const parsed = JSON.parse(raw);
  // Support both "installed" app and "web" credential types
  const creds = parsed.installed || parsed.web;
  if (!creds) {
    throw new Error('credentials.json is malformed — expected an "installed" or "web" key.');
  }
  if (!parsed.installed) {
    // Web clients reject ZeroBox's http://localhost:<port> redirect unless it is registered
    console.log(chalk.yellow(
      '  ⚠️  credentials.json is a "Web application" client. ZeroBox needs a "Desktop app" client:\n' +
      '     Run `zerobox setup` to replace it.\n'
    ));
  }

  const { client_id, client_secret, redirect_uris } = creds;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || redirect_uris?.[0] || 'http://localhost:3000/oauth2callback';

  return {
    clientId: process.env.GOOGLE_CLIENT_ID || client_id,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || client_secret,
    redirectUri,
  };
}

/**
 * Ask the OS for a free TCP port by binding to port 0.
 * Guaranteed not to collide with any running service.
 * @returns {Promise<number>}
 */
function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

/**
 * Spin up a temporary HTTP server to capture the OAuth2 authorization code.
 * Opens the auth URL in the user's browser, then waits for the callback.
 *
 * @param {string} authUrl - Google OAuth2 authorization URL
 * @param {number} port - local port to listen on
 * @returns {Promise<string>} authorization code
 */
function waitForAuthCode(authUrl, port) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let parsed;
      try {
        parsed = new URL(req.url, `http://localhost:${port}`);
      } catch {
        res.writeHead(400);
        res.end('Bad request.');
        return;
      }

      const code = parsed.searchParams.get('code');
      const error = parsed.searchParams.get('error');

      if (error) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end(`<html><body><h2>❌ Authorization denied: ${error}</h2></body></html>`);
        server.close();
        reject(new Error(`OAuth authorization denied: ${error}`));
        return;
      }

      if (!code) {
        res.writeHead(400);
        res.end('No code received.');
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`
        <!DOCTYPE html>
        <html>
          <head><title>ZeroBox — Authorized</title></head>
          <body style="font-family:system-ui,sans-serif;text-align:center;padding:80px;background:#f9fafb">
            <div style="max-width:480px;margin:0 auto">
              <h1 style="font-size:48px;margin:0">✅</h1>
              <h2 style="color:#16a34a">ZeroBox authorized!</h2>
              <p style="color:#6b7280">You can close this tab and return to your terminal.</p>
            </div>
          </body>
        </html>
      `);

      server.close();
      resolve(code);
    });

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        reject(new Error(`Port ${port} is in use. Close whatever is running on it and try again.`));
      } else {
        reject(err);
      }
    });

    server.listen(port, async () => {
      console.log(chalk.dim(`  Listening for OAuth callback on http://localhost:${port} ...`));
      try {
        await open(authUrl);
        console.log(chalk.dim('  Browser opened. Complete the Google sign-in to continue.\n'));
      } catch {
        console.log(chalk.yellow(`\n  Could not open browser automatically. Visit this URL:\n`));
        console.log(chalk.cyan(`  ${authUrl}\n`));
      }
    });

    // 5-minute timeout
    const timeout = setTimeout(() => {
      server.close();
      reject(new Error('OAuth timeout — no response received within 5 minutes.'));
    }, 5 * 60 * 1000);

    server.on('close', () => clearTimeout(timeout));
  });
}

/**
 * Sign in without a local browser: print the auth URL, let the user approve on
 * any device, then read back the localhost URL Google redirected them to.
 * That page fails to load on their device, but its address holds the code.
 *
 * @param {string} authUrl
 * @returns {Promise<string>} authorization code
 */
async function waitForPastedCode(authUrl) {
  console.log(chalk.bold('  No browser on this machine, so sign in from any device:\n'));
  console.log(`  1. Open this link on your phone or laptop:\n\n  ${chalk.cyan(authUrl)}\n`);
  console.log('  2. Approve access. You will land on a page that fails to load (localhost).');
  console.log('  3. Copy that page\'s full address from the address bar and paste it below.\n');

  // Iterate lines rather than rl.question(): lines that arrive before the
  // prompt (a pasted block, piped input) are buffered instead of dropped.
  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  const lines = rl[Symbol.asyncIterator]();
  try {
    for (let attempt = 1; attempt <= 3; attempt++) {
      process.stdout.write(chalk.cyan('  Paste the URL (or code): '));
      const { value, done } = await lines.next();
      if (done) throw new Error('Sign-in cancelled: no input received.');
      try {
        return codeFromPaste(value);
      } catch (err) {
        console.log(chalk.yellow(`\n  ${err.message}`));
      }
    }
    throw new Error('Sign-in cancelled after 3 attempts. Run `zerobox auth --no-browser` to try again.');
  } finally {
    rl.close();
  }
}

/**
 * Run the interactive OAuth2 authorization flow.
 * Picks a free port at runtime so it works regardless of what redirect_uri
 * is stored in credentials.json. Google allows any http://localhost:{port}
 * for Desktop/installed app credentials without pre-registration.
 *
 * @param {import('googleapis').Auth.OAuth2Client} oauth2Client
 * @returns {Promise<import('googleapis').Auth.OAuth2Client>}
 */
async function authorizeInteractive(oauth2Client) {
  // Grab a free port — avoids the credentials.json port mismatch entirely
  const port = await getFreePort();
  const dynamicRedirectUri = `http://localhost:${port}`;

  // Override the client's redirect URI so generateAuthUrl and getToken agree
  oauth2Client.redirectUri = dynamicRedirectUri;

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent', // force refresh_token to be returned
    redirect_uri: dynamicRedirectUri,
  });

  console.log(chalk.cyan('\n🔐 First-time setup: authorizing ZeroBox with your Google account...\n'));

  const code = isHeadless() ? await waitForPastedCode(authUrl) : await waitForAuthCode(authUrl, port);

  // getToken must use the exact same redirect_uri used in the auth URL
  const { tokens } = await oauth2Client.getToken({ code, redirect_uri: dynamicRedirectUri });
  oauth2Client.setCredentials(tokens);

  await fs.writeFile(TOKEN_PATH, JSON.stringify(tokens, null, 2), { mode: 0o600 });
  console.log(chalk.green(`✅ Authentication successful! Token saved to ${TOKEN_PATH}\n`));

  return oauth2Client;
}

/**
 * Create and return an authorized Gmail OAuth2 client.
 * Uses cached token.json if available; otherwise triggers the interactive OAuth flow.
 *
 * This function is a pure factory — it accepts no state and can be called from
 * any context (CLI, Next.js API route, etc.).
 *
 * @returns {Promise<import('googleapis').Auth.OAuth2Client>}
 */
export async function getAuthClient() {
  const { clientId, clientSecret, redirectUri } = await loadCredentials();
  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

  // Try loading a cached token
  try {
    const tokenRaw = await fs.readFile(TOKEN_PATH, 'utf8');
    const tokens = JSON.parse(tokenRaw);
    oauth2Client.setCredentials(tokens);

    // Proactively refresh if the access token expires within 60 seconds
    if (tokens.expiry_date && Date.now() > tokens.expiry_date - 60_000) {
      const { credentials } = await oauth2Client.refreshAccessToken();
      oauth2Client.setCredentials(credentials);
      await fs.writeFile(TOKEN_PATH, JSON.stringify(credentials, null, 2), { mode: 0o600 });
    }

    return oauth2Client;
  } catch {
    // No valid cached token — run the interactive flow
    return authorizeInteractive(oauth2Client);
  }
}

/**
 * Remove the cached token, forcing re-authentication on the next run.
 * @returns {Promise<void>}
 */
export async function revokeToken() {
  try {
    await fs.unlink(TOKEN_PATH);
  } catch {
    // Already gone
  }
}

/**
 * getAuthClient for commands that show a spinner: runs setup or sign-in
 * (which read the keyboard) before the spinner starts, so the spinner
 * neither draws over the prompts nor swallows the typed input.
 * @param {import('ora').Ora} spinner
 * @returns {Promise<import('googleapis').Auth.OAuth2Client>}
 */
export async function authorize(spinner) {
  await ensureCredentials();
  if (!existsSync(TOKEN_PATH)) return getAuthClient();
  spinner.start('Authenticating…');
  try {
    const auth = await getAuthClient();
    spinner.succeed('Authenticated');
    return auth;
  } catch (err) {
    spinner.fail('Authentication failed');
    throw err;
  }
}
