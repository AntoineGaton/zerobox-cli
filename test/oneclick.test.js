import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkUrl, isPrivateAddress, oneClickUnsubscribe, USER_AGENT } from '../src/oneclick.js';
import { oneClickUrl } from '../src/analyzer.js';

const publicDns = async () => [{ address: '93.184.216.34', family: 4 }];

/** Fake fetch: answers from a list of responses and records the requests. */
function fakeFetch(responses) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, ...init });
    const r = responses[Math.min(calls.length - 1, responses.length - 1)];
    if (r instanceof Error) throw r;
    const headers = new Map(Object.entries(r.headers ?? {}));
    return { status: r.status, headers: { get: (k) => headers.get(k.toLowerCase()) ?? null }, body: null };
  };
  fn.calls = calls;
  return fn;
}

test('2xx is success; the POST is RFC 8058 shaped, without cookies', async () => {
  const fetch = fakeFetch([{ status: 202 }]);
  const r = await oneClickUnsubscribe('https://list.example/u?id=1', { fetch, lookup: publicDns });
  assert.deepEqual(r, { ok: true, status: 202, url: 'https://list.example/u?id=1' });
  const [call] = fetch.calls;
  assert.equal(call.method, 'POST');
  assert.equal(call.body, 'List-Unsubscribe=One-Click');
  assert.equal(call.headers['Content-Type'], 'application/x-www-form-urlencoded');
  assert.equal(call.headers['User-Agent'], USER_AGENT);
  assert.match(USER_AGENT, /^ZeroBox\/\S+ \(\+https:\/\/github\.com\/AntoineGaton\/zerobox-cli\)$/);
  assert.equal(call.redirect, 'manual');
  assert.equal(call.credentials, 'omit');
  assert.ok(!('Cookie' in call.headers));
});

test('non-2xx is a failure with the status', async () => {
  const r = await oneClickUnsubscribe('https://list.example/u', { fetch: fakeFetch([{ status: 404 }]), lookup: publicDns });
  assert.equal(r.ok, false);
  assert.equal(r.status, 404);
  assert.equal(r.error, 'HTTP 404');
});

test('a request that hangs times out', async () => {
  const fetch = (url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  });
  const r = await oneClickUnsubscribe('https://slow.example/u', { fetch, lookup: publicDns, timeoutMs: 30 });
  assert.equal(r.ok, false);
  assert.match(r.error, /timed out/);
});

test('plain http links are refused without any request', async () => {
  const fetch = fakeFetch([{ status: 200 }]);
  const r = await oneClickUnsubscribe('http://list.example/u', { fetch, lookup: publicDns });
  assert.equal(r.ok, false);
  assert.match(r.error, /only https/);
  assert.equal(fetch.calls.length, 0);
});

test('loopback, private and internal hosts are refused', async () => {
  const fetch = fakeFetch([{ status: 200 }]);
  for (const url of ['https://127.0.0.1/u', 'https://[::1]/u', 'https://localhost/u', 'https://10.1.2.3/u', 'https://192.168.1.1/u', 'https://169.254.169.254/latest', 'https://intranet/u']) {
    const r = await oneClickUnsubscribe(url, { fetch, lookup: publicDns });
    assert.equal(r.ok, false, url);
    assert.match(r.error, /refused/, url);
  }
  // A public-looking name that resolves to loopback
  const r = await oneClickUnsubscribe('https://sneaky.example/u', { fetch, lookup: async () => [{ address: '127.0.0.1' }] });
  assert.match(r.error, /resolves to private address 127\.0\.0\.1/);
  assert.equal(fetch.calls.length, 0);
});

test('redirects are followed at most 3 times and each hop is re-checked', async () => {
  // 307 keeps the POST, then a 303 turns it into a GET
  let fetch = fakeFetch([{ status: 307, headers: { location: '/step2' } }, { status: 303, headers: { location: 'https://other.example/done' } }, { status: 200 }]);
  let r = await oneClickUnsubscribe('https://list.example/u', { fetch, lookup: publicDns });
  assert.equal(r.ok, true);
  assert.deepEqual(fetch.calls.map((c) => [c.method, c.url]), [['POST', 'https://list.example/u'], ['POST', 'https://list.example/step2'], ['GET', 'https://other.example/done']]);

  fetch = fakeFetch([{ status: 302, headers: { location: '/again' } }]);
  r = await oneClickUnsubscribe('https://list.example/u', { fetch, lookup: publicDns });
  assert.equal(r.ok, false);
  assert.match(r.error, /more than 3 redirects/);
  assert.equal(fetch.calls.length, 4);

  fetch = fakeFetch([{ status: 302, headers: { location: 'https://127.0.0.1/admin' } }]);
  r = await oneClickUnsubscribe('https://list.example/u', { fetch, lookup: publicDns });
  assert.match(r.error, /refused private address/);
  assert.equal(fetch.calls.length, 1);
});

test('isPrivateAddress and checkUrl edge cases', async () => {
  for (const ip of ['127.0.0.1', '10.0.0.1', '172.16.0.1', '172.31.255.255', '192.168.0.1', '169.254.1.1', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
  for (const ip of ['8.8.8.8', '172.32.0.1', '2606:4700::1111']) assert.equal(isPrivateAddress(ip), false, ip);
  await assert.rejects(checkUrl('https://user:pw@list.example/u', publicDns), /credentials/);
  await assert.rejects(checkUrl('not a url', publicDns), /valid URL/);
});

test('oneClickUrl needs the One-Click POST header and an https link', () => {
  const lu = '<mailto:u@list.example>, <https://list.example/u>';
  assert.equal(oneClickUrl(lu, 'List-Unsubscribe=One-Click'), 'https://list.example/u');
  assert.equal(oneClickUrl(lu, null), null);
  assert.equal(oneClickUrl('<http://list.example/u>', 'List-Unsubscribe=One-Click'), null);
  assert.equal(oneClickUrl('<mailto:u@list.example>', 'List-Unsubscribe=One-Click'), null);
});
