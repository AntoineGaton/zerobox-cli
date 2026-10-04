import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// paths.js creates ZEROBOX_HOME on import: point it at a temp folder first
const home = mkdtempSync(path.join(tmpdir(), 'zerobox-actions-'));
process.env.ZEROBOX_HOME = home;
const { applyPlan, canOpenBrowser, parseMailto } = await import('../src/actions.js');
const { buildPlan, buildRows, toggleMark } = await import('../src/tui/model.js');
const { fixtureCache } = await import('./tui-fixtures.js');

function setup() {
  const dir = mkdtempSync(path.join(home, 'run-'));
  const files = { cache: path.join(dir, 'cache.json'), log: path.join(dir, 'log.json'), unsub: path.join(dir, 'unsub.json') };
  const cache = fixtureCache({ starred: true });
  writeFileSync(files.cache, JSON.stringify(cache));
  return { files, rows: buildRows(cache, {}, { protectText: '!deals@shop.example' }) };
}

function fakes() {
  const calls = { trash: [], send: [], filter: [], open: [], post: [] };
  return {
    calls,
    deps: {
      auth: { fake: true },
      trashMessages: async (auth, ids, onProgress) => {
        calls.trash.push(ids);
        onProgress?.(ids.length, ids.length);
        // The last id fails, to check partial failures are reported
        return { trashedIds: ids.slice(0, -1), failedIds: ids.slice(-1) };
      },
      sendEmail: async (auth, to, subject, body) => { calls.send.push({ to, subject, body }); },
      createSenderFilter: async (auth, email, opts) => {
        calls.filter.push({ email, opts });
        if (email === 'news@saas.example') { const e = new Error('exists'); e.code = 409; throw e; }
      },
      openUrl: async (url) => { calls.open.push(url); },
      oneClick: async (url) => { calls.post.push(url); return { ok: true, status: 200, url }; },
      sleep: async () => {},
      env: { SSH_CONNECTION: '1 2 3 4' },
      platform: 'linux',
    },
  };
}

test('applyPlan trashes non-starred mail, unsubscribes, filters and keeps the books', async () => {
  const { files, rows } = setup();
  let marks = toggleMark({}, 'deals@shop.example', 'trash');
  marks = toggleMark(marks, 'deals@shop.example', 'unsub');
  marks = toggleMark(marks, 'news@saas.example', 'unsub');
  marks = toggleMark(marks, 'news@saas.example', 'filter');
  marks = toggleMark(marks, 'alerts@bank.example', 'filter');
  const plan = buildPlan(rows, marks);
  const { calls, deps } = fakes();
  const progress = [];

  const result = await applyPlan(plan, { ...deps, files, onProgress: (p) => progress.push(p.label) });

  // Trash: 11 ids (the starred d0 never sent), one failed
  assert.equal(calls.trash.length, 1);
  assert.equal(calls.trash[0].length, 11);
  assert.ok(!calls.trash[0].includes('d0'));
  assert.deepEqual(result.trash, { trashed: 10, failed: 1, starredSkipped: 1 });

  // Unsubscribe: one-click POST for deals, mailto sent with its subject for news
  assert.deepEqual(calls.post, ['https://shop.example/u']);
  assert.equal(result.unsub.oneClick, 1);
  assert.deepEqual(calls.send, [{ to: 'unsub@saas.example', subject: 'stop', body: 'Please remove me from this mailing list.' }]);
  assert.equal(result.unsub.sent, 1);
  assert.deepEqual(result.unsub.links, []);
  assert.equal(result.unsub.opened, false);
  assert.deepEqual(calls.open, []);

  // Filters: 409 counts as already existing
  assert.deepEqual(result.filter, { created: 1, existed: 1, failed: [] });
  assert.deepEqual(calls.filter[0].opts, { skipInbox: true, trash: true });

  // Log has the same shape as `zerobox clean`
  const log = JSON.parse(readFileSync(files.log, 'utf8'));
  assert.equal(log.runs.length, 1);
  const run = log.runs[0];
  assert.equal(run.action, 'trash');
  assert.deepEqual(run.senders, [{ email: 'deals@shop.example', count: 12, verdict: 'Nuke' }]);
  assert.equal(run.totalEmails, 10);
  assert.equal(run.failedEmails, 1);
  assert.equal(typeof run.durationSeconds, 'number');
  assert.ok(run.timestamp);

  // Cache pruned of trashed messages only (failed and starred stay)
  const cache = JSON.parse(readFileSync(files.cache, 'utf8'));
  const left = cache.inboxMessages.filter((m) => m.id.startsWith('d')).map((m) => m.id).sort();
  assert.deepEqual(left, ['d0', 'd11']);

  // Unsubscribe status like `zerobox unsubscribe`
  const status = JSON.parse(readFileSync(files.unsub, 'utf8'));
  assert.equal(status['news@saas.example'].done, true);
  assert.equal(status['news@saas.example'].method, 'mailto');
  assert.equal(status['deals@shop.example'].done, true);
  assert.equal(status['deals@shop.example'].method, 'one-click');
  assert.equal(status['deals@shop.example'].httpStatus, 200);

  assert.ok(progress.includes('Moving to Trash') && progress.includes('Unsubscribing') && progress.includes('Creating filters'));
});

test('a failed one-click falls back to the web page, opened only when a local browser is available', async () => {
  const { files, rows } = setup();
  const plan = buildPlan(rows, toggleMark({}, 'deals@shop.example', 'unsub'));
  const { calls, deps } = fakes();
  deps.oneClick = async (url) => ({ ok: false, status: 500, url, error: 'HTTP 500' });
  const result = await applyPlan(plan, { ...deps, files, env: { DISPLAY: ':0' }, platform: 'linux' });
  assert.equal(result.unsub.oneClick, 0);
  assert.deepEqual(result.unsub.links, [{ email: 'deals@shop.example', url: 'https://shop.example/u' }]);
  const status = JSON.parse(readFileSync(files.unsub, 'utf8'));
  assert.equal(status['deals@shop.example'].method, 'web');
  assert.equal(status['deals@shop.example'].done, false);
  assert.match(status['deals@shop.example'].error, /one-click failed: HTTP 500/);
  assert.deepEqual(calls.open, ['https://shop.example/u']);
  assert.equal(result.unsub.opened, true);
  assert.equal(result.trash, null);
});

test('a failed unsubscribe email is reported and recorded, others continue', async () => {
  const { files, rows } = setup();
  const plan = buildPlan(rows, toggleMark({}, 'news@saas.example', 'unsub'));
  const { deps } = fakes();
  deps.sendEmail = async () => { throw new Error('quota'); };
  const result = await applyPlan(plan, { ...deps, files });
  assert.deepEqual(result.unsub.failed, [{ email: 'news@saas.example', error: 'quota' }]);
  const status = JSON.parse(readFileSync(files.unsub, 'utf8'));
  assert.equal(status['news@saas.example'].done, false);
  assert.equal(status['news@saas.example'].error, 'quota');
});

test('canOpenBrowser refuses over SSH and on Linux without a display', () => {
  assert.equal(canOpenBrowser({ SSH_TTY: '/dev/pts/1', DISPLAY: ':0' }, 'linux'), false);
  assert.equal(canOpenBrowser({ SSH_CONNECTION: 'x' }, 'darwin'), false);
  assert.equal(canOpenBrowser({}, 'linux'), false);
  assert.equal(canOpenBrowser({ WAYLAND_DISPLAY: 'wayland-0' }, 'linux'), true);
  assert.equal(canOpenBrowser({}, 'darwin'), true);
  assert.equal(canOpenBrowser({}, 'win32'), true);
});

test('parseMailto reads subject and body', () => {
  assert.deepEqual(parseMailto('a@b.c?subject=Stop&body=bye'), { to: 'a@b.c', subject: 'Stop', body: 'bye' });
  assert.deepEqual(parseMailto('a@b.c'), { to: 'a@b.c', subject: 'unsubscribe', body: 'Please remove me from this mailing list.' });
});

// ── Large runs: checkpoints, stopping, paced emails ─────────────────────────

const { CHECKPOINT_EVERY, TRASH_SLICE, isSendLimitError } = await import('../src/actions.js');

function bigSetup(n) {
  const dir = mkdtempSync(path.join(home, 'big-'));
  const files = { cache: path.join(dir, 'cache.json'), log: path.join(dir, 'log.json'), unsub: path.join(dir, 'unsub.json') };
  const ids = Array.from({ length: n }, (_, i) => `m${i}`);
  const inboxMessages = ids.map((id) => ({ id, threadId: id, labelIds: ['INBOX'], payload: { headers: [{ name: 'From', value: 'bulk@list.example' }] } }));
  writeFileSync(files.cache, JSON.stringify({ inboxMessages, sentThreadIds: [] }));
  const plan = { trash: [{ email: 'bulk@list.example', count: n, verdict: 'Nuke', ids, starred: 0 }], unsub: [], filter: [], senders: 1, trashEmails: n, starredSkipped: 0 };
  return { files, ids, plan };
}

const readJson = (f) => JSON.parse(readFileSync(f, 'utf8'));

test('trash runs in slices and checkpoints the cache and the log every 1,000', async () => {
  const { files, plan } = bigSetup(2_550);
  const seen = [];
  const progress = [];
  let clock = 0;
  const deps = {
    auth: {},
    now: () => clock,
    trashMessages: async (auth, ids, onProgress) => {
      // What is on disk before each slice
      seen.push({ cache: readJson(files.cache).inboxMessages.length, log: (() => { try { return readJson(files.log).runs[0]; } catch { return null; } })() });
      clock += ids.length * 33; // ~30/s
      onProgress(ids.length, ids.length);
      return { trashedIds: ids.filter((id) => id !== 'm5'), failedIds: ids.filter((id) => id === 'm5') };
    },
    onProgress: (p) => progress.push(p),
  };
  const result = await applyPlan(plan, { ...deps, files });

  assert.equal(TRASH_SLICE, 100);
  assert.equal(CHECKPOINT_EVERY, 1000);
  assert.equal(seen.length, 26);
  // Before slice 11 (after 1,000 attempted) the first checkpoint is on disk
  assert.equal(seen[10].cache, 2_550 - 999);
  assert.equal(seen[10].log.totalEmails, 999);
  assert.equal(seen[10].log.failedEmails, 1);
  assert.equal(seen[10].log.complete, false);
  assert.equal(seen[9].cache, 2_550);

  assert.deepEqual(result.trash, { trashed: 2_549, failed: 1, starredSkipped: 0 });
  const log = readJson(files.log);
  assert.equal(log.runs.length, 1, 'one run, updated in place');
  assert.equal(log.runs[0].complete, true);
  assert.equal(log.runs[0].totalEmails, 2_549);
  assert.deepEqual(readJson(files.cache).inboxMessages.map((m) => m.id), ['m5']);

  // Progress carries a rate and an ETA
  const mid = progress.find((p) => p.done === 1_000);
  assert.equal(mid.total, 2_550);
  assert.ok(Math.abs(mid.rate - 30.3) < 0.5, `rate ${mid.rate}`);
  assert.ok(Math.abs(mid.etaSeconds - 1_550 / mid.rate) < 0.01);
});

test('stopping mid-run keeps what was trashed and records the partial run', async () => {
  const { files, plan } = bigSetup(1_500);
  let calls = 0;
  const deps = {
    auth: {},
    shouldStop: () => calls >= 3,
    trashMessages: async (auth, ids) => { calls++; return { trashedIds: ids, failedIds: [] }; },
    sendEmail: async () => { throw new Error('should not run after a stop'); },
  };
  plan.unsub = [{ email: 'bulk@list.example', method: 'email', mailto: 'u@list.example' }];
  const result = await applyPlan(plan, { ...deps, files });
  assert.equal(result.stopped, true);
  assert.deepEqual(result.trash, { trashed: 300, failed: 0, starredSkipped: 0, stopped: true, notAttempted: 1_200 });
  assert.equal(result.unsub, null);
  assert.equal(readJson(files.cache).inboxMessages.length, 1_200);
  const [run] = readJson(files.log).runs;
  assert.equal(run.totalEmails, 300);
  assert.equal(run.complete, false);
  assert.equal(run.stopped, true);
});

test('unsubscribe emails are paced and stop at Gmail\'s sending limit', async () => {
  const { files } = setup();
  const unsub = Array.from({ length: 5 }, (_, i) => ({ email: `s${i}@list.example`, method: 'email', mailto: `u${i}@list.example`, http: i === 4 ? 'https://list.example/u4' : null }));
  const plan = { trash: [], unsub, filter: [], senders: 5, trashEmails: 0, starredSkipped: 0 };
  let clock = 0;
  const sleeps = [];
  const sent = [];
  const deps = {
    auth: {},
    now: () => clock,
    sleep: async (ms) => { sleeps.push(ms); clock += ms; },
    sendEmail: async (auth, to) => {
      if (sent.length === 2) throw Object.assign(new Error('Daily user sending limit exceeded'), { errors: [{ reason: 'dailyLimitExceeded' }] });
      sent.push(to);
      clock += 200;
    },
  };
  const result = await applyPlan(plan, { ...deps, files });
  assert.deepEqual(sent, ['u0@list.example', 'u1@list.example']);
  assert.deepEqual(sleeps, [800, 800], 'one send per second');
  assert.match(result.unsub.sendStopped, /daily sending limit/);
  // s3 has no web page: reported as not sent; s4 falls back to its web page
  assert.deepEqual(result.unsub.notSent, ['s2@list.example', 's3@list.example']);
  assert.deepEqual(result.unsub.links, [{ email: 's4@list.example', url: 'https://list.example/u4' }]);
  const status = readJson(files.unsub);
  assert.equal(status['s0@list.example'].done, true);
  assert.equal(status['s2@list.example'], undefined);
});

test('the per-run email cap stops sending before Gmail does', async () => {
  const { files } = setup();
  const unsub = Array.from({ length: 4 }, (_, i) => ({ email: `s${i}@list.example`, method: 'email', mailto: `u${i}@list.example` }));
  const plan = { trash: [], unsub, filter: [], senders: 4, trashEmails: 0, starredSkipped: 0 };
  const result = await applyPlan(plan, { auth: {}, files, sleep: async () => {}, mailtoMax: 2, sendEmail: async () => {} });
  assert.equal(result.unsub.sent, 2);
  assert.match(result.unsub.sendStopped, /stopped at 2/);
  assert.deepEqual(result.unsub.notSent, ['s2@list.example', 's3@list.example']);
});

test('isSendLimitError tells the daily limit from other failures', () => {
  assert.equal(isSendLimitError({ errors: [{ reason: 'dailyLimitExceeded' }] }), true);
  assert.equal(isSendLimitError(new Error('User-rate limit exceeded for sending mail')), true);
  assert.equal(isSendLimitError(new Error('Invalid To header')), false);
});

test('steps limits applyPlan to one stage', async () => {
  const { files, rows } = setup();
  let marks = toggleMark({}, 'deals@shop.example', 'trash');
  marks = toggleMark(marks, 'deals@shop.example', 'unsub');
  marks = toggleMark(marks, 'news@saas.example', 'filter');
  const plan = buildPlan(rows, marks);
  const { calls, deps } = fakes();
  const result = await applyPlan(plan, { ...deps, files, steps: ['unsub'] });
  assert.equal(result.unsub.oneClick, 1);
  assert.equal(result.trash, null);
  assert.equal(result.filter, null);
  assert.deepEqual(calls.trash, []);
  assert.deepEqual(calls.filter, []);
});
