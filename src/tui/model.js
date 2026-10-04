/**
 * @module tui/model
 * Pure data logic for the full-screen UI: sender rows, filtering,
 * marks → plan, and screen geometry. No I/O, no React.
 */

import { analyzeSenders, getHeader, parseFrom } from '../analyzer.js';
import { RULES, builtinReason, looksLikeMarketing, parseProtectList, protectReason, protectSettings } from '../protect.js';
import { clean, num } from './text.js';
import { FILTERS_PER_SECOND, MAILTO_GAP_MS, MAILTO_MAX_PER_RUN, ONE_CLICK_PER_SECOND, TRASH_PER_SECOND } from '../limits.js';

export const VERDICTS = ['Nuke', 'Review', 'Keep', 'Protect'];
export const VERDICT_FILTERS = ['All', 'Nuke', 'Review', 'Keep', 'Protect'];
const VERDICT_RANK = { Nuke: 0, Review: 1, Keep: 2, Protect: 3 };

/** Terminals narrower than this get the single-column layout. */
export const WIDE_MIN = 90;

/**
 * @typedef {object} Row
 * @property {string} email
 * @property {string} name        display name, cleaned of emoji/control chars
 * @property {number} count
 * @property {number} replyPct
 * @property {number|null} openedPct  share of messages without UNREAD (null if unknown)
 * @property {number} starred
 * @property {string[]} messageIds
 * @property {string[]} trashIds  messageIds minus starred ones
 * @property {'Nuke'|'Review'|'Keep'|'Protect'} verdict
 * @property {'Nuke'|'Review'|'Keep'} baseVerdict  verdict before protection
 * @property {string|null} builtinProtect  why the built-in rules protect it
 * @property {string|null} protectReason   why it is protected now (null: not protected)
 * @property {number} oldest      epoch ms
 * @property {number} newest      epoch ms
 * @property {{mailto: string|null, http: string|null, oneClick: string|null}} unsubscribe
 * @property {'one-click'|'email'|'web'|'none'} method
 * @property {boolean} unsubDone  already unsubscribed in a past run
 */

/**
 * Build sorted sender rows from a scan cache.
 *
 * @param {{inboxMessages?: object[], sentThreadIds?: string[]}|null} cache
 * @param {Record<string, {done?: boolean}>} [unsubStatus]
 * @param {{protectText?: string, own?: string[], settings?: object}} [opts]  protected.txt, the user's own addresses, settings.json
 * @returns {Row[]}
 */
export function buildRows(cache, unsubStatus = {}, { protectText = '', own = [], settings } = {}) {
  const messages = cache?.inboxMessages ?? [];
  if (!messages.length) return [];

  const senders = analyzeSenders(messages, new Set(cache.sentThreadIds ?? []));

  /** @type {Map<string, {known: number, read: number, starredIds: Set<string>}>} */
  const extra = new Map();
  for (const msg of messages) {
    if (!msg?.payload) continue;
    const { email } = parseFrom(getHeader(msg, 'From'));
    if (!email) continue;
    let e = extra.get(email);
    if (!e) extra.set(email, (e = { known: 0, read: 0, starredIds: new Set() }));
    if (Array.isArray(msg.labelIds)) {
      e.known++;
      if (!msg.labelIds.includes('UNREAD')) e.read++;
      if (msg.labelIds.includes('STARRED')) e.starredIds.add(msg.id);
    }
  }

  const rows = senders.map((s) => {
    const e = extra.get(s.email) ?? { known: 0, read: 0, starredIds: new Set() };
    const { mailto, http, oneClick = null } = s.unsubscribe;
    // Preference when applying: one-click POST, then email, then a web page
    const method = oneClick ? 'one-click' : mailto ? 'email' : http ? 'web' : 'none';
    const openedPct = e.known ? (e.read / e.known) * 100 : null;
    const starred = e.starredIds.size;
    return {
      email: s.email,
      name: clean(s.name) || s.email,
      count: s.count,
      replyPct: s.replyPct,
      openedPct,
      starred,
      messageIds: s.messageIds,
      trashIds: s.messageIds.filter((id) => !e.starredIds.has(id)),
      verdict: s.verdict.label,
      baseVerdict: s.verdict.label,
      builtinProtect: builtinReason({ email: s.email, starred, replyPct: s.replyPct, openedPct }, { own, settings }),
      protectReason: null,
      oldest: s.oldestDate.getTime(),
      newest: s.newestDate.getTime(),
      unsubscribe: { mailto, http, oneClick },
      method,
      unsubDone: Boolean(unsubStatus?.[s.email]?.done),
    };
  });

  return applyProtection(rows, protectText);
}

/**
 * Apply protected.txt on top of the built-in protection: protected rows get
 * the Protect verdict (their original is kept in baseVerdict). Cheap, so the
 * UI can re-run it after every `p` without rebuilding rows from the cache.
 * @param {Row[]} rows
 * @param {string} protectText
 */
export function applyProtection(rows, protectText = '') {
  const entries = parseProtectList(protectText);
  return sortRows(rows.map((r) => {
    const reason = protectReason(r.email, r.builtinProtect, entries);
    return { ...r, protectReason: reason, verdict: reason ? 'Protect' : r.baseVerdict };
  }));
}

/**
 * Re-run the built-in rules with new settings (and protected.txt on top),
 * without rebuilding rows from the cache.
 * @param {Row[]} rows
 * @param {string} protectText
 * @param {{own?: string[], settings?: object}} opts
 */
export function recomputeProtection(rows, protectText, { own = [], settings } = {}) {
  return applyProtection(rows.map((r) => ({ ...r, builtinProtect: builtinReason(r, { own, settings }) })), protectText);
}

/**
 * How many senders each setting protects in this inbox, for the settings
 * screen. Each rule is counted on its own (a bank you also reply to counts
 * for both), and whether the rule is on or off, so an off rule shows what it
 * would protect. financeMarketing counts the finance senders that look like
 * marketing: the ones it decides about.
 * @param {Row[]} rows
 * @param {object} settings
 * @param {string[]} [own]
 * @returns {Record<string, number>}
 */
export function settingsCounts(rows, settings, own = []) {
  const p = protectSettings(settings);
  const ownSet = new Set(own.filter(Boolean).map((a) => a.toLowerCase()));
  const n = { own: 0, starred: 0, replied: 0, opened: 0, government: 0, health: 0, finance: 0, financeMarketing: 0, accountSecurity: 0, utilities: 0 };
  const key = { government: 'government', health: 'health', finance: 'finance', 'account security': 'accountSecurity', utilities: 'utilities' };
  for (const r of rows) {
    const email = r.email.toLowerCase();
    if (ownSet.has(email)) n.own++;
    if (r.starred > 0) n.starred++;
    if (r.replyPct > 0) n.replied++;
    if (r.openedPct != null && r.openedPct >= p.openedMin) n.opened++;
    const seen = new Set();
    for (const [category, re] of RULES) {
      if (seen.has(category) || !re.test(email)) continue;
      seen.add(category);
      if (category === 'finance' && looksLikeMarketing(email)) {
        n.financeMarketing++;
        if (!p.financeMarketing) continue;
      }
      n[key[category]]++;
    }
  }
  return n;
}

/**
 * The switches on the settings screen, in order. `about` is one short line;
 * `{min}` is replaced by the current openedMin.
 */
export const SETTING_ITEMS = [
  { key: 'replied', label: 'replied', about: 'senders you have replied to' },
  { key: 'opened', label: 'opened ≥ {min}%', about: 'you open at least {min}% of their mail (+/- adjusts)' },
  { key: 'government', label: 'government', about: 'tax, .gov and .mil agencies' },
  { key: 'health', label: 'health', about: 'medical, pharmacy, patient portals' },
  { key: 'finance', label: 'finance', about: 'banks, cards, payments, insurance' },
  { key: 'financeMarketing', label: 'finance marketing', about: 'bank and card promo mail (m., info.)' },
  { key: 'accountSecurity', label: 'account security', about: 'sign-in, codes, passwords, calendar invites' },
  { key: 'utilities', label: 'utilities', about: 'power, internet and phone carriers' },
];

/**
 * Map of protected address → reason for a scan cache, for the older
 * prompt-based commands that work from analyzeSenders().
 * @param {object} cache
 * @param {string} [protectText]
 * @param {object} [settings]  settings.json
 * @returns {Map<string, string>}
 */
export function protectedSenders(cache, protectText = '', settings) {
  const own = [cache?.account].filter(Boolean);
  const rows = buildRows(cache, {}, { protectText, own, settings });
  return new Map(rows.filter((r) => r.protectReason).map((r) => [r.email, r.protectReason]));
}

/** Nuke, Review, Keep, Protect, then by count descending, then address. */
export function sortRows(rows) {
  return [...rows].sort(
    (a, b) =>
      VERDICT_RANK[a.verdict] - VERDICT_RANK[b.verdict] ||
      b.count - a.count ||
      a.email.localeCompare(b.email)
  );
}

/**
 * Rows matching a text query (name or address, case-insensitive) and a verdict.
 * A verdict view also lists the protected senders that would otherwise have
 * that verdict (they sort last), so you can see what a bulk mark skips.
 * @param {Row[]} rows
 * @param {{text?: string, verdict?: string}} f
 */
export function filterRows(rows, { text = '', verdict = 'All' } = {}) {
  const q = text.trim().toLowerCase();
  return rows.filter(
    (r) =>
      (verdict === 'All' || r.verdict === verdict || (r.protectReason && r.baseVerdict === verdict)) &&
      (!q || r.email.includes(q) || r.name.toLowerCase().includes(q))
  );
}

export function nextVerdictFilter(current, step = 1) {
  const i = VERDICT_FILTERS.indexOf(current);
  const n = VERDICT_FILTERS.length;
  return VERDICT_FILTERS[(((i < 0 ? 0 : i) + step) % n + n) % n];
}

// ── Marks ───────────────────────────────────────────────────────────────────

/** @typedef {{trash?: boolean, unsub?: boolean, filter?: boolean}} Mark */

/** Toggle one kind of mark, dropping empty entries. Returns a new marks object. */
export function toggleMark(marks, email, kind) {
  const cur = { ...(marks[email] ?? {}) };
  cur[kind] = !cur[kind];
  if (!cur[kind]) delete cur[kind];
  const next = { ...marks };
  if (Object.keys(cur).length) next[email] = cur;
  else delete next[email];
  return next;
}

export function clearMarks(marks, email) {
  const next = { ...marks };
  delete next[email];
  return next;
}

/** "duf" style mark column, with '·' for nothing. */
export function markGlyph(mark) {
  if (!mark) return '·';
  return `${mark.trash ? 'd' : ''}${mark.unsub ? 'u' : ''}${mark.filter ? 'f' : ''}` || '·';
}

/**
 * Turn marks into an ordered action plan. Starred mail is never trashed.
 * @param {Row[]} rows
 * @param {Record<string, Mark>} marks
 */
export function buildPlan(rows, marks) {
  const plan = { trash: [], unsub: [], filter: [], senders: 0, trashEmails: 0, starredSkipped: 0 };
  for (const r of rows) {
    const m = marks[r.email];
    if (!m) continue;
    let any = false;
    if (m.trash) {
      plan.trash.push({ email: r.email, name: r.name, verdict: r.verdict, count: r.count, ids: r.trashIds, starred: r.starred, protected: Boolean(r.protectReason) });
      plan.trashEmails += r.trashIds.length;
      plan.starredSkipped += r.starred;
      any = true;
    }
    if (m.unsub && r.method !== 'none') {
      plan.unsub.push({ email: r.email, method: r.method, oneClick: r.unsubscribe.oneClick, mailto: r.unsubscribe.mailto, http: r.unsubscribe.http });
      any = true;
    }
    if (m.filter) {
      plan.filter.push({ email: r.email });
      any = true;
    }
    if (any) plan.senders++;
  }
  return plan;
}

/**
 * Bulk mark: set one kind of mark on every eligible row of a view. Protected
 * rows are always skipped, and unsubscribe skips rows without a method or
 * already unsubscribed. When every eligible row already has the mark, it is
 * removed instead, so pressing the key twice undoes it.
 *
 * @param {Row[]} rows   the rows in the current view
 * @param {Record<string, Mark>} marks
 * @param {'trash'|'unsub'|'filter'} kind
 * @returns {{marks: Record<string, Mark>, on: boolean, senders: number, emails: number, protectedSkipped: number, otherSkipped: number}}
 */
export function bulkMark(rows, marks, kind) {
  let protectedSkipped = 0;
  let otherSkipped = 0;
  const eligible = [];
  for (const r of rows) {
    if (r.protectReason) protectedSkipped++;
    else if (kind === 'unsub' && (r.method === 'none' || r.unsubDone)) otherSkipped++;
    else eligible.push(r);
  }
  const on = !eligible.every((r) => marks[r.email]?.[kind]);
  const next = { ...marks };
  let emails = 0;
  for (const r of eligible) {
    const cur = { ...(next[r.email] ?? {}) };
    if (on) cur[kind] = true;
    else delete cur[kind];
    if (Object.keys(cur).length) next[r.email] = cur;
    else delete next[r.email];
    emails += r.trashIds.length;
  }
  return { marks: next, on, senders: eligible.length, emails, protectedSkipped, otherSkipped };
}

/**
 * What "cleanup" (Space, A) marks on a sender: trash, plus unsubscribe when
 * the sender has a method and was not unsubscribed in a past run.
 * @param {Row} row
 * @returns {Array<'trash'|'unsub'>}
 */
export function cleanupKinds(row) {
  return row.method !== 'none' && !row.unsubDone ? ['trash', 'unsub'] : ['trash'];
}

/** True when the sender already has every cleanup mark. */
export function isCleanup(row, mark) {
  return Boolean(mark) && cleanupKinds(row).every((k) => mark[k]);
}

/**
 * Toggle cleanup on one sender: set every cleanup mark, or, when they are all
 * set, remove trash and unsubscribe (a filter mark is kept).
 * @returns {{marks: Record<string, Mark>, on: boolean}}
 */
export function toggleCleanup(marks, row) {
  const on = !isCleanup(row, marks[row.email]);
  const cur = { ...(marks[row.email] ?? {}) };
  if (on) for (const k of cleanupKinds(row)) cur[k] = true;
  else { delete cur.trash; delete cur.unsub; }
  const next = { ...marks };
  if (Object.keys(cur).length) next[row.email] = cur;
  else delete next[row.email];
  return { marks: next, on };
}

/**
 * Select every unprotected sender in a view for cleanup (A). Protected rows
 * are skipped; unsubscribe is added only where it can run (same rules as
 * bulkMark). When every eligible row is already selected, it unselects them.
 *
 * @param {Row[]} rows   the rows in the current view
 * @param {Record<string, Mark>} marks
 * @returns {{marks: Record<string, Mark>, on: boolean, senders: number, emails: number, unsubs: number, protectedSkipped: number}}
 */
export function bulkCleanup(rows, marks) {
  let protectedSkipped = 0;
  const eligible = [];
  for (const r of rows) {
    if (r.protectReason) protectedSkipped++;
    else eligible.push(r);
  }
  const on = !eligible.every((r) => isCleanup(r, marks[r.email]));
  const next = { ...marks };
  let emails = 0;
  let unsubs = 0;
  for (const r of eligible) {
    const cur = { ...(next[r.email] ?? {}) };
    if (on) for (const k of cleanupKinds(r)) cur[k] = true;
    else { delete cur.trash; delete cur.unsub; }
    if (Object.keys(cur).length) next[r.email] = cur;
    else delete next[r.email];
    emails += r.trashIds.length;
    if (cleanupKinds(r).includes('unsub')) unsubs++;
  }
  return { marks: next, on, senders: eligible.length, emails, unsubs, protectedSkipped };
}

// ── Stages ──────────────────────────────────────────────────────────────────

/**
 * The plan is applied in stages, each confirmed on its own: unsubscribe first
 * (it acts from the user's account and cannot be undone), then filters, then
 * trash (recoverable for 30 days).
 */
export const STAGE_ORDER = ['unsub', 'filter', 'trash'];
export const STAGE_NAME = { unsub: 'Unsubscribe', filter: 'Filters', trash: 'Trash backlog' };

/** Stages with something to do, in order. */
export function planStages(plan) {
  return STAGE_ORDER.filter((k) => plan[k].length > 0);
}

/** Rough seconds a stage takes, from Gmail pacing. */
export function stageEstimate(plan, kind) {
  if (kind === 'trash') return plan.trashEmails / TRASH_PER_SECOND;
  if (kind === 'filter') return plan.filter.length / FILTERS_PER_SECOND;
  const oneClick = plan.unsub.filter((u) => u.method === 'one-click').length;
  const emails = Math.min(MAILTO_MAX_PER_RUN, plan.unsub.filter((u) => u.method === 'email').length);
  return oneClick / ONE_CLICK_PER_SECOND + (emails * MAILTO_GAP_MS) / 1000;
}

export function planIsEmpty(plan) {
  return !plan.trash.length && !plan.unsub.length && !plan.filter.length;
}

/**
 * "3 marked → trash 1,840 · unsub 2 · filter 1" or "nothing marked".
 * With `short`, a shorter form for narrow screens: "3 marked · trash 1,840"
 * (or "3 marked · unsub 2" when nothing is trashed).
 */
export function planSummary(plan, short = false) {
  if (planIsEmpty(plan)) return 'nothing marked';
  if (short) {
    const first = plan.trash.length ? `trash ${num(plan.trashEmails)}` : plan.unsub.length ? `unsub ${plan.unsub.length}` : `filter ${plan.filter.length}`;
    return `${num(plan.senders)} marked · ${first}`;
  }
  const parts = [];
  if (plan.trash.length) parts.push(`trash ${num(plan.trashEmails)}`);
  if (plan.unsub.length) parts.push(`unsub ${plan.unsub.length}`);
  if (plan.filter.length) parts.push(`filter ${plan.filter.length}`);
  return `${num(plan.senders)} marked → ${parts.join(' · ')}`;
}

// ── Geometry ────────────────────────────────────────────────────────────────

/**
 * Screen size with safe fallbacks: 0/undefined columns → 80, never below 40;
 * 0/undefined rows → 24, never below 10.
 */
export function screenSize(columns, rows) {
  return {
    cols: Math.max(40, columns || 80),
    rows: Math.max(10, rows || 24),
  };
}

/**
 * Column widths for the sender list.
 * Lines are: bar(1) mark(3) ' ' sender ' ' emails ' ' opened ' ' verdict ' '
 */
export function layout(cols) {
  const wide = cols >= WIDE_MIN;
  const detailW = wide ? Math.min(52, Math.max(36, Math.floor(cols * 0.36))) : 0;
  const listW = wide ? cols - detailW - 1 : cols; // 1 for the │ divider
  const emailsW = wide ? 6 : 5;
  const openedW = wide ? 6 : 4;
  const verdictW = 7;
  const fixed = 1 + 3 + 1 + 1 + emailsW + 1 + openedW + 1 + verdictW + 1;
  return { wide, listW, detailW, senderW: Math.max(8, listW - fixed), emailsW, openedW, verdictW };
}

/** Lines available to the list body: rows minus header, rules, column titles, message and status. */
export function bodyHeight(rows) {
  return Math.max(3, rows - 7);
}

/** Keep the cursor visible, moving the window as little as possible. */
export function clampTop(top, cursor, height, total) {
  const maxTop = Math.max(0, total - height);
  if (cursor < top) top = cursor;
  if (cursor >= top + height) top = cursor - height + 1;
  return Math.max(0, Math.min(top, maxTop));
}
