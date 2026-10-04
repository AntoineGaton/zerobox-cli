/**
 * @module actions
 * Gmail cleanup actions and their bookkeeping files, shared by the
 * `clean` / `unsubscribe` commands and the full-screen UI.
 */

import fs from 'fs/promises';
import { CACHE_PATH, LOG_PATH, PROTECTED_PATH, SETTINGS_PATH, UNSUB_STATUS_PATH } from './paths.js';
import { loadSettings } from './settings.js';
import { oneClickUnsubscribe } from './oneclick.js';
import { protectFileBody } from './protect.js';
import { MAILTO_GAP_MS, MAILTO_MAX_PER_RUN } from './limits.js';

// ── Cleanup log ─────────────────────────────────────────────────────────────

/** @returns {Promise<{runs: object[]}>} */
export async function loadLog(file = LOG_PATH) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return { runs: [] };
  }
}

/** Append one run to the cleanup log. */
export async function appendLog(run, file = LOG_PATH) {
  const log = await loadLog(file);
  log.runs.push(run);
  await fs.writeFile(file, JSON.stringify(log, null, 2));
}

/** Insert or replace a run (matched by `id`), so a long run can be saved as it goes. */
export async function saveRun(run, file = LOG_PATH) {
  const log = await loadLog(file);
  const i = log.runs.findIndex((r) => r.id && r.id === run.id);
  if (i >= 0) log.runs[i] = run;
  else log.runs.push(run);
  await fs.writeFile(file, JSON.stringify(log, null, 2));
}

// ── Protected senders ───────────────────────────────────────────────────────

/** Contents of protected.txt, or '' when there is none. */
export async function loadProtectText(file = PROTECTED_PATH) {
  try {
    return await fs.readFile(file, 'utf8');
  } catch {
    return '';
  }
}

/**
 * settings.json from the data folder. A corrupt file prints a one-line
 * warning to stderr and falls back to the defaults.
 */
export function loadUserSettings(file = SETTINGS_PATH) {
  const { settings, warning } = loadSettings(file);
  if (warning) console.warn(`  Warning: ${warning}`);
  return settings;
}

/** Write protected.txt, adding the explanatory header to a new file. */
export async function saveProtectText(text, file = PROTECTED_PATH) {
  await fs.writeFile(file, protectFileBody(text));
}

// ── Scan cache ──────────────────────────────────────────────────────────────

/**
 * Remove processed message IDs from the scan cache (best-effort), so later
 * commands stay accurate without a rescan.
 * @param {Set<string>} ids
 */
export async function pruneCacheMessages(ids, file = CACHE_PATH) {
  try {
    const cache = JSON.parse(await fs.readFile(file, 'utf8'));
    cache.inboxMessages = (cache.inboxMessages ?? []).filter((m) => !ids.has(m.id));
    await fs.writeFile(file, JSON.stringify(cache, null, 2));
  } catch {
    // Non-fatal: the user can rescan
  }
}

// ── Unsubscribe status ──────────────────────────────────────────────────────

/** @returns {Promise<Record<string, object>>} */
export async function loadUnsubStatus(file = UNSUB_STATUS_PATH) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return {};
  }
}

export async function saveUnsubStatus(status, file = UNSUB_STATUS_PATH) {
  await fs.writeFile(file, JSON.stringify(status, null, 2));
}

/**
 * Parse a raw mailto: unsubscribe string (may include query params).
 * e.g. "user@example.com?subject=Unsubscribe&body=please+remove+me"
 *
 * @param {string} mailtoStr - the value after "mailto:"
 * @returns {{ to: string, subject: string, body: string }}
 */
export function parseMailto(mailtoStr) {
  const [addrPart, query] = mailtoStr.split('?');
  const to = addrPart.trim();
  let subject = 'unsubscribe';
  let body = 'Please remove me from this mailing list.';

  if (query) {
    const params = new URLSearchParams(query);
    if (params.get('subject')) subject = params.get('subject');
    if (params.get('body')) body = params.get('body');
  }

  return { to, subject, body };
}

// ── Browser ─────────────────────────────────────────────────────────────────

/**
 * True when opening a URL would reach a browser the user can see: not over
 * SSH, and on Linux only with a graphical display.
 */
export function canOpenBrowser(env = process.env, platform = process.platform) {
  if (env.SSH_CONNECTION || env.SSH_TTY || env.SSH_CLIENT) return false;
  if (platform === 'linux' && !env.DISPLAY && !env.WAYLAND_DISPLAY) return false;
  return true;
}

// ── Apply a plan ────────────────────────────────────────────────────────────

/** Trash runs in slices this big, so a stop request is honoured quickly. */
export const TRASH_SLICE = 100;
/** Save progress (prune the cache, update the log) at least this often. */
export const CHECKPOINT_EVERY = 1000;
/** One-click POSTs in flight at once. */
const ONE_CLICK_CONCURRENCY = 4;

const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** True when Gmail refused a send because the daily sending limit is reached. */
export function isSendLimitError(err) {
  const reason = err?.errors?.[0]?.reason ?? err?.response?.data?.error?.errors?.[0]?.reason;
  if (reason === 'dailyLimitExceeded' || reason === 'quotaExceeded') return true;
  return /sending limit|daily limit|daily user sending|quota exceeded|limit exceeded for sending/i.test(err?.message ?? '');
}

/**
 * Apply a cleanup plan built by tui/model buildPlan(). Steps run in order
 * (trash, unsubscribe, filters); one failing item never aborts the others.
 *
 * Trash runs in paced slices. Every CHECKPOINT_EVERY messages the trashed IDs
 * are pruned from the scan cache and the log entry is updated, so stopping
 * (deps.shouldStop) or a crash keeps a correct record of what was done.
 *
 * Unsubscribe prefers RFC 8058 one-click POSTs, then a paced unsubscribe
 * email, then lists the web page for the user to finish.
 *
 * @param {ReturnType<import('./tui/model.js').buildPlan>} plan
 * @param {object} deps
 * @param {object} deps.auth                      Gmail OAuth client
 * @param {Function} deps.trashMessages           (auth, ids, onProgress) => {trashedIds, failedIds}
 * @param {Function} deps.sendEmail               (auth, to, subject, body)
 * @param {Function} deps.createSenderFilter      (auth, email, opts)
 * @param {(url: string) => Promise<{ok: boolean, status?: number, error?: string}>} [deps.oneClick]
 * @param {(url: string) => Promise<unknown>} [deps.openUrl]  only called when allowed
 * @param {(p: object) => void} [deps.onProgress] {label, done, total, rate?, etaSeconds?}
 * @param {() => boolean} [deps.shouldStop]       checked between slices and items
 * @param {(ms: number) => Promise<void>} [deps.sleep]
 * @param {() => number} [deps.now]
 * @param {Array<'trash'|'unsub'|'filter'>} [deps.steps]  run only these steps (the UI runs one stage at a time)
 * @param {object} [deps.files]                   override paths (tests)
 */
export async function applyPlan(plan, deps) {
  const {
    auth, onProgress = () => {}, openUrl, files = {},
    shouldStop = () => false, sleep = realSleep, now = Date.now,
    oneClick = (url) => oneClickUnsubscribe(url),
    mailtoGapMs = MAILTO_GAP_MS, mailtoMax = MAILTO_MAX_PER_RUN,
    steps = ['trash', 'unsub', 'filter'],
  } = deps;
  const started = now();
  const result = { trash: null, unsub: null, filter: null, logPath: null, seconds: 0, stopped: false };

  if (plan.trash.length && steps.includes('trash')) {
    result.trash = await applyTrash(plan, deps, { onProgress, files, shouldStop, now });
    result.logPath = files.log ?? LOG_PATH;
    if (result.trash.stopped) result.stopped = true;
  }

  if (plan.unsub.length && steps.includes('unsub') && !result.stopped) {
    result.unsub = await applyUnsub(plan, deps, { onProgress, files, shouldStop, sleep, now, oneClick, openUrl, mailtoGapMs, mailtoMax });
    if (result.unsub.stopped) result.stopped = true;
  }

  if (plan.filter.length && steps.includes('filter') && !result.stopped) {
    result.filter = { created: 0, existed: 0, failed: [] };
    let i = 0;
    for (const f of plan.filter) {
      if (shouldStop()) { result.stopped = true; break; }
      onProgress({ label: 'Creating filters', done: i++, total: plan.filter.length });
      try {
        await deps.createSenderFilter(auth, f.email, { skipInbox: true, trash: true });
        result.filter.created++;
      } catch (err) {
        // 409 means the filter already exists
        if (err.code === 409 || err.status === 409) result.filter.existed++;
        else result.filter.failed.push({ email: f.email, error: err.message });
      }
    }
    onProgress({ label: 'Creating filters', done: i, total: plan.filter.length });
  }

  result.seconds = parseFloat(((now() - started) / 1000).toFixed(1));
  return result;
}

async function applyTrash(plan, deps, { onProgress, files, shouldStop, now }) {
  const ids = plan.trash.flatMap((t) => t.ids);
  const total = ids.length;
  const t0 = now();
  const run = {
    id: `trash-${new Date(t0).toISOString()}`,
    timestamp: new Date(t0).toISOString(),
    action: 'trash',
    senders: plan.trash.map((s) => ({ email: s.email, count: s.count, verdict: s.verdict })),
    totalEmails: 0,
    failedEmails: 0,
    durationSeconds: 0,
    complete: false,
  };
  let trashed = 0;
  let failed = 0;
  let unsaved = [];
  let stopped = false;

  const progress = (done) => {
    const secs = (now() - t0) / 1000;
    const rate = secs > 0 ? done / secs : 0;
    onProgress({ label: 'Moving to Trash', done, total, rate, etaSeconds: rate > 0 ? (total - done) / rate : null });
  };
  // Prune what moved from the cache and bring the log entry up to date
  const checkpoint = async (complete) => {
    if (unsaved.length) await pruneCacheMessages(new Set(unsaved), files.cache);
    unsaved = [];
    Object.assign(run, {
      totalEmails: trashed,
      failedEmails: failed,
      durationSeconds: parseFloat(((now() - t0) / 1000).toFixed(1)),
      complete,
    });
    if (stopped) run.stopped = true;
    await saveRun(run, files.log);
  };

  progress(0);
  let sinceCheckpoint = 0;
  for (let i = 0; i < total; i += TRASH_SLICE) {
    if (shouldStop()) { stopped = true; break; }
    const slice = ids.slice(i, i + TRASH_SLICE);
    const { trashedIds, failedIds } = await deps.trashMessages(deps.auth, slice, (d) => progress(i + d));
    trashed += trashedIds.length;
    failed += failedIds.length;
    unsaved.push(...trashedIds);
    sinceCheckpoint += slice.length;
    progress(i + slice.length);
    if (sinceCheckpoint >= CHECKPOINT_EVERY) {
      sinceCheckpoint = 0;
      await checkpoint(false);
    }
  }
  await checkpoint(!stopped);

  return {
    trashed,
    failed,
    starredSkipped: plan.starredSkipped,
    ...(stopped ? { stopped: true, notAttempted: total - trashed - failed } : {}),
  };
}

async function applyUnsub(plan, deps, ctx) {
  const { onProgress, files, shouldStop, sleep, now, oneClick, openUrl, mailtoGapMs, mailtoMax } = ctx;
  const status = await loadUnsubStatus(files.unsub);
  const browser = Boolean(openUrl) && canOpenBrowser(deps.env, deps.platform);
  const out = { oneClick: 0, sent: 0, failed: [], links: [], opened: browser, notSent: [], sendStopped: null };
  const total = plan.unsub.length;
  let done = 0;
  const t0 = now();
  const tick = () => {
    const secs = (now() - t0) / 1000;
    const rate = secs > 0 && done > 0 ? done / secs : 0;
    onProgress({ label: 'Unsubscribing', done, total, rate, etaSeconds: rate > 0 ? (total - done) / rate : null });
  };
  const stamp = () => new Date(now()).toISOString();

  // 1. One-click POSTs, a few at a time
  const rest = [];
  const queue = plan.unsub.filter((u) => {
    if (u.oneClick) return true;
    rest.push({ u, note: null });
    return false;
  });
  tick();
  const worker = async () => {
    while (queue.length) {
      if (shouldStop()) return;
      const u = queue.shift();
      const r = await oneClick(u.oneClick).catch((err) => ({ ok: false, error: err.message }));
      if (r.ok) {
        out.oneClick++;
        status[u.email] = { done: true, method: 'one-click', url: u.oneClick, httpStatus: r.status, timestamp: stamp() };
        done++;
        tick();
      } else {
        rest.push({ u, note: `one-click failed: ${r.error}` });
      }
    }
  };
  await Promise.all(Array.from({ length: ONE_CLICK_CONCURRENCY }, worker));
  if (shouldStop()) {
    await saveUnsubStatus(status, files.unsub);
    return { ...out, stopped: true };
  }

  // 2. Unsubscribe emails, paced; 3. web pages listed for the user
  let lastSend = -Infinity;
  for (const { u, note } of rest) {
    if (shouldStop()) { out.stopped = true; break; }
    const timestamp = stamp();
    let handled = false;
    if (u.mailto && !out.sendStopped && out.sent >= mailtoMax) {
      out.sendStopped = `stopped at ${mailtoMax} unsubscribe emails this run (Gmail allows about 500 sends a day)`;
    }
    if (u.mailto && !out.sendStopped) {
      const { to, subject, body } = parseMailto(u.mailto);
      const wait = lastSend + mailtoGapMs - now();
      if (wait > 0) await sleep(wait);
      lastSend = now();
      try {
        await deps.sendEmail(deps.auth, to, subject, body);
        out.sent++;
        status[u.email] = { done: true, method: 'mailto', to, subject, timestamp };
        handled = true;
      } catch (err) {
        if (isSendLimitError(err)) out.sendStopped = `Gmail's daily sending limit was reached: ${err.message}`;
        else {
          out.failed.push({ email: u.email, error: err.message });
          status[u.email] = { done: false, method: 'mailto', error: err.message, timestamp };
          handled = !u.http;
        }
      }
    }
    if (!handled && u.mailto && out.sendStopped && !u.http) {
      out.notSent.push(u.email);
      handled = true;
    }
    if (!handled && u.http) {
      out.links.push({ email: u.email, url: u.http });
      if (browser) await openUrl(u.http).catch(() => {});
      // The user still has to finish on the page, so it is not done yet
      status[u.email] = { done: Boolean(status[u.email]?.done), method: 'web', url: u.http, ...(note ? { error: note } : {}), timestamp };
      handled = true;
    }
    if (!handled) {
      out.failed.push({ email: u.email, error: note ?? 'no usable unsubscribe link' });
      status[u.email] = { done: false, method: u.oneClick ? 'one-click' : 'none', error: note, timestamp };
    }
    done++;
    tick();
    if (done % 20 === 0) await saveUnsubStatus(status, files.unsub);
  }
  await saveUnsubStatus(status, files.unsub);
  return out;
}
