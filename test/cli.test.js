// Smoke-tests the built bundle the way an installed user runs it.
// Run `npm run build` first; CI does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const BIN = path.resolve('dist/zerobox.js');
const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
const home = mkdtempSync(path.join(tmpdir(), 'zerobox-test-'));
const run = (...args) => spawnSync(process.execPath, [BIN, ...args], {
  encoding: 'utf8',
  env: { ...process.env, ZEROBOX_HOME: home },
});

test('--version prints the package version', () => {
  const r = run('--version');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), version);
});

test('--help shows the data folder from ZEROBOX_HOME', () => {
  const r = run('--help');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Data folder:/);
  assert.ok(r.stdout.includes(home));
});

test('commands that need a scan fail loudly with a clear message', () => {
  const r = run('clean', '--dry-run');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /No scan cache found/);
  assert.ok(statSync(home).isDirectory());
});

test('help lists the full-screen view and the older menu', () => {
  const r = run('--help');
  assert.match(r.stdout, /full-screen view/);
  assert.match(r.stdout, /zerobox menu/);
});

test('with no arguments and no terminal, it explains and exits instead of hanging', () => {
  const r = spawnSync(process.execPath, [BIN], {
    encoding: 'utf8',
    env: { ...process.env, ZEROBOX_HOME: home },
    input: '',
    timeout: 10_000,
  });
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /interactive terminal/);
});

test('protect and unprotect edit protected.txt in the data folder', () => {
  let r = run('protect', 'Boss@Work.example');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Protected boss@work\.example/);
  r = run('unprotect', 'service@venmo.example');
  assert.equal(r.status, 0, r.stderr);
  const text = readFileSync(path.join(home, 'protected.txt'), 'utf8');
  assert.match(text, /^# ZeroBox protected senders/);
  assert.match(text, /^boss@work\.example$/m);
  assert.match(text, /^!service@venmo\.example$/m);
  r = run('protect', '--list');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /boss@work\.example/);
  r = run('protect', 'nonsense');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /not a pattern/);
});

test('settings prints the file and set validates keys and values', () => {
  let r = run('settings');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /financeMarketing +true/);
  assert.ok(r.stdout.includes(path.join(home, 'settings.json')));
  r = run('settings', 'set', 'financeMarketing', 'false');
  assert.equal(r.status, 0, r.stderr);
  r = run('settings', 'set', 'openedMin', '55');
  assert.equal(r.status, 0, r.stderr);
  const saved = JSON.parse(readFileSync(path.join(home, 'settings.json'), 'utf8'));
  assert.equal(saved.protect.financeMarketing, false);
  assert.equal(saved.protect.openedMin, 55);
  assert.equal(saved.protect.finance, true);
  if (process.platform !== 'win32') assert.equal(statSync(path.join(home, 'settings.json')).mode & 0o777, 0o600);
  r = run('settings');
  assert.match(r.stdout, /financeMarketing +false/);
  assert.match(r.stdout, /openedMin +55/);
  r = run('settings', 'set', 'starred', 'false');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Unknown setting "starred"/);
  r = run('settings', 'set', 'openedMin', '500');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /10 to 100/);
  r = run('settings', 'bogus');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Unknown settings action/);
});

test('a corrupt settings.json warns and falls back instead of crashing', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'zerobox-test-'));
  writeFileSync(path.join(dir, 'settings.json'), '{ broken');
  const r = spawnSync(process.execPath, [BIN, 'settings'], { encoding: 'utf8', env: { ...process.env, ZEROBOX_HOME: dir } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /not valid JSON; using default settings/);
  assert.match(r.stdout, /financeMarketing +true/);
});

test('commands that need Gmail point to zerobox setup when there is no client', () => {
  const fresh = mkdtempSync(path.join(tmpdir(), 'zerobox-nocreds-'));
  const r = spawnSync(process.execPath, [BIN, 'stats'], {
    encoding: 'utf8', input: '', cwd: fresh, env: { ...process.env, ZEROBOX_HOME: fresh },
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /zerobox setup/);
});

test('setup needs an interactive terminal and says so', () => {
  const r = spawnSync(process.execPath, [BIN, 'setup'], {
    encoding: 'utf8', input: '', env: { ...process.env, ZEROBOX_HOME: home },
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /interactive terminal/);
});
