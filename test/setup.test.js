import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SETUP_STEPS, buildCredentials, checkClientId, checkClientSecret, cleanPath, parseClientJson } from '../src/setup.js';

const ID = '1234567890-abcdefg.apps.googleusercontent.com';
const SECRET = 'GOCSPX-example-secret-value';

test('setup lists the four Google Cloud steps with their links', () => {
  assert.deepEqual(SETUP_STEPS.map((s) => s.url), [
    'https://console.cloud.google.com/projectcreate',
    'https://console.cloud.google.com/apis/library/gmail.googleapis.com',
    'https://console.cloud.google.com/auth/audience',
    'https://console.cloud.google.com/auth/clients/create',
  ]);
  assert.match(SETUP_STEPS[3].title, /Desktop app/);
});

test('a downloaded Desktop app client is accepted', () => {
  const r = parseClientJson(JSON.stringify({ installed: { client_id: ID, client_secret: SECRET, redirect_uris: ['http://localhost'] } }));
  assert.deepEqual(r, { ok: true, clientId: ID, clientSecret: SECRET });
});

test('a Web application client is refused with a clear reason', () => {
  const r = parseClientJson(JSON.stringify({ web: { client_id: ID, client_secret: SECRET } }));
  assert.equal(r.ok, false);
  assert.equal(r.kind, 'web');
  assert.match(r.message, /Web application/);
  assert.match(r.message, /Desktop app/);
  assert.ok(!r.message.includes(SECRET));
});

test('bad JSON and incomplete clients are refused', () => {
  assert.equal(parseClientJson('not json').kind, 'invalid');
  assert.equal(parseClientJson('{}').kind, 'invalid');
  assert.match(parseClientJson(JSON.stringify({ installed: { client_id: 'nope', client_secret: SECRET } })).message, /apps\.googleusercontent\.com/);
  assert.match(parseClientJson(JSON.stringify({ installed: { client_id: ID } })).message, /secret is empty/);
});

test('typed Client ID and secret are checked without echoing the secret', () => {
  assert.equal(checkClientId(` ${ID} `), null);
  assert.ok(checkClientId(''));
  assert.ok(checkClientId('my-client'));
  assert.equal(checkClientSecret(SECRET), null);
  for (const bad of ['', 'abc123', 'has a space in it']) {
    const msg = checkClientSecret(bad);
    assert.ok(msg);
    if (bad) assert.ok(!msg.includes(bad));
  }
});

test('credentials.json has the installed-client shape with a localhost redirect', () => {
  const body = buildCredentials({ clientId: ` ${ID}`, clientSecret: `${SECRET} ` });
  assert.deepEqual(Object.keys(body), ['installed']);
  assert.equal(body.installed.client_id, ID);
  assert.equal(body.installed.client_secret, SECRET);
  assert.deepEqual(body.installed.redirect_uris, ['http://localhost']);
  assert.equal(body.installed.token_uri, 'https://oauth2.googleapis.com/token');
  // What ZeroBox writes, it can read back
  assert.deepEqual(parseClientJson(JSON.stringify(body)), { ok: true, clientId: ID, clientSecret: SECRET });
});

test('cleanPath handles dragged-in and typed paths', () => {
  assert.equal(cleanPath("'/Users/me/Downloads/client secret.json'", '/Users/me'), '/Users/me/Downloads/client secret.json');
  assert.equal(cleanPath('"C:\\Users\\me\\Downloads\\client.json"', 'C:\\Users\\me'), 'C:\\Users\\me\\Downloads\\client.json');
  assert.equal(cleanPath('/home/me/My\\ Files/c.json', '/home/me'), '/home/me/My Files/c.json');
  assert.equal(cleanPath('~/Downloads/c.json', '/home/me'), '/home/me/Downloads/c.json');
  assert.equal(cleanPath('  C:\\Users\\me\\c.json ', 'C:\\Users\\me'), 'C:\\Users\\me\\c.json');
});

test('saveCredentials writes a file only the user can read', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'zerobox-setup-'));
  process.env.ZEROBOX_HOME = dir;
  const { saveCredentials } = await import('../src/commands/setup.js');
  const file = path.join(dir, 'credentials.json');
  saveCredentials({ clientId: ID, clientSecret: SECRET }, file);
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).installed.client_id, ID);
  if (process.platform !== 'win32') assert.equal(statSync(file).mode & 0o777, 0o600);
});
