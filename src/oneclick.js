/**
 * @module oneclick
 * RFC 8058 one-click unsubscribe: an HTTPS POST with the body
 * `List-Unsubscribe=One-Click`. Network access goes through injected
 * `fetch` and `lookup` so this is unit-testable without a network.
 *
 * Safety: https only, no cookies or credentials, a 10 s budget for the whole
 * request chain, at most 3 redirects (each re-checked), and hosts that are
 * or resolve to private, loopback, link-local or otherwise internal
 * addresses are refused.
 */

import dns from 'dns';
import net from 'net';
import { VERSION } from './version.js';

export const USER_AGENT = `ZeroBox/${VERSION} (+https://github.com/AntoineGaton/zerobox-cli)`;
export const TIMEOUT_MS = 10_000;
export const MAX_REDIRECTS = 3;

/** True for IPv4/IPv6 literals that are not on the public internet. */
export function isPrivateAddress(ip) {
  ip = String(ip).replace(/^\[|\]$/g, '').toLowerCase();
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19));
  }
  if (net.isIPv6(ip)) {
    if (ip === '::' || ip === '::1') return true;
    const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    if (/^::ffff:/.test(ip)) return true; // hex-form mapped addresses: refuse rather than decode
    const first = parseInt(ip.split(':')[0] || '0', 16);
    return (first & 0xfe00) === 0xfc00 || // fc00::/7 unique local
      (first & 0xffc0) === 0xfe80 ||      // fe80::/10 link-local
      (first & 0xff00) === 0xff00;        // ff00::/8 multicast
  }
  return false;
}

/** Hostnames that only make sense inside a network. */
function isInternalName(host) {
  return host === 'localhost' || /\.(localhost|local|internal|home\.arpa)$/.test(host) || !host.includes('.');
}

const defaultLookup = (host) => dns.promises.lookup(host, { all: true, verbatim: true });

/**
 * Check a URL is safe to POST to. Throws with a readable message if not.
 * @param {string} raw
 * @param {(host: string) => Promise<{address: string}[]>} lookup
 * @returns {Promise<URL>}
 */
export async function checkUrl(raw, lookup = defaultLookup) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('not a valid URL');
  }
  if (url.protocol !== 'https:') throw new Error(`refused ${url.protocol.replace(':', '')} link: only https is used`);
  if (url.username || url.password) throw new Error('refused a link with embedded credentials');
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (net.isIP(host)) {
    if (isPrivateAddress(host)) throw new Error(`refused private address ${host}`);
    return url;
  }
  if (isInternalName(host)) throw new Error(`refused internal host ${host}`);
  let addrs;
  try {
    addrs = await lookup(host);
  } catch (err) {
    throw new Error(`could not resolve ${host}: ${err.code ?? err.message}`);
  }
  if (!addrs?.length) throw new Error(`could not resolve ${host}`);
  const bad = addrs.find((a) => isPrivateAddress(a.address));
  if (bad) throw new Error(`refused ${host}: resolves to private address ${bad.address}`);
  return url;
}

/**
 * POST a one-click unsubscribe.
 *
 * @param {string} url  the https link from List-Unsubscribe
 * @param {object} [deps]
 * @param {typeof fetch} [deps.fetch]
 * @param {(host: string) => Promise<{address: string}[]>} [deps.lookup]
 * @param {number} [deps.timeoutMs]
 * @returns {Promise<{ok: boolean, status?: number, url: string, error?: string}>}
 *   ok is true for a final 2xx. Never throws.
 */
export async function oneClickUnsubscribe(url, deps = {}) {
  const { fetch: doFetch = globalThis.fetch, lookup = defaultLookup, timeoutMs = TIMEOUT_MS } = deps;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let current = url;
  let method = 'POST';
  try {
    for (let hop = 0; ; hop++) {
      const target = await checkUrl(current, lookup);
      const res = await doFetch(target.href, {
        method,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': USER_AGENT,
        },
        body: method === 'POST' ? 'List-Unsubscribe=One-Click' : undefined,
        redirect: 'manual',
        credentials: 'omit',
        signal: controller.signal,
      });
      // We never read the page; release the connection
      try { await res.body?.cancel?.(); } catch { /* ignore */ }

      if (res.status >= 300 && res.status < 400 && res.headers?.get?.('location')) {
        if (hop >= MAX_REDIRECTS) return { ok: false, status: res.status, url, error: `more than ${MAX_REDIRECTS} redirects` };
        current = new URL(res.headers.get('location'), target).href;
        // Like browsers: 307/308 keep the POST, 301/302/303 become a GET
        if (![307, 308].includes(res.status)) method = 'GET';
        continue;
      }
      if (res.status >= 200 && res.status < 300) return { ok: true, status: res.status, url };
      return { ok: false, status: res.status, url, error: `HTTP ${res.status}` };
    }
  } catch (err) {
    const timedOut = controller.signal.aborted || err?.name === 'AbortError' || err?.name === 'TimeoutError';
    return { ok: false, url, error: timedOut ? `timed out after ${Math.round(timeoutMs / 1000)}s` : err.message };
  } finally {
    clearTimeout(timer);
  }
}
