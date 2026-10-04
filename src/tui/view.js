/**
 * @module tui/view
 * Turns UI state into screen lines. Pure: each line is a list of styled
 * segments whose text adds up to exactly `cols` columns, so the Ink layer
 * only maps segments to <Text>, and tests can snapshot the plain text.
 */

import { SETTING_ITEMS, STAGE_NAME, buildPlan, bodyHeight, clampTop, layout, markGlyph, planIsEmpty, planStages, planSummary, settingsCounts, stageEstimate } from './model.js';
import { currentRow, visibleRows } from './keys.js';
import { age, cut, num, padEnd, padStart, pct, width } from './text.js';
import { MAILTO_MAX_PER_RUN, ONE_CLICK_PER_SECOND as ONE_CLICK_RATE, TRASH_PER_SECOND as TRASH_RATE } from '../limits.js';

/** Seconds → "40s", "12 min", "1 h 5 min". */
export function duration(sec) {
  if (!Number.isFinite(sec) || sec < 0) return '–';
  if (sec < 60) return `${Math.max(1, Math.round(sec))}s`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${min % 60} min`;
}

export const COLOR = {
  accent: '#28EAEC',
  text: '#ECEEF0',
  soft: '#AEB6BF',
  muted: '#8A939D',
  chrome: '#4A525C',
  selBg: '#10262C',
  Nuke: '#FF8A7A',
  Review: '#F5C451',
  Keep: '#6FDC9C',
  Protect: '#8FB8FF',
  ink: '#08090B',
};

/** @typedef {{t: string, fg?: string, bg?: string, bold?: boolean}} Seg */

const seg = (t, fg, extra = {}) => ({ t, fg, ...extra });

/** Fit segments to exactly `w` columns: cut overflow, pad the rest. */
export function fit(segs, w, padBg) {
  const out = [];
  let used = 0;
  for (const s of segs) {
    if (used >= w) break;
    const room = w - used;
    const t = width(s.t) > room ? cut(s.t, room) : s.t;
    out.push({ ...s, t });
    used += width(t);
  }
  if (used < w) out.push({ t: ' '.repeat(w - used), bg: padBg });
  return out;
}

/** Plain text of a screen, for tests and snapshots. */
export function toText(lines) {
  return lines.map((l) => l.map((s) => s.t).join('').replace(/\s+$/, '')).join('\n');
}

const rule = (w) => [seg('─'.repeat(w), COLOR.chrome)];

// ── Header ──────────────────────────────────────────────────────────────────

function header(cols, meta, wide) {
  const facts = [];
  if (meta.account && wide) facts.push(meta.account);
  if (meta.totalEmails) {
    facts.push(`${num(meta.totalEmails)} emails`);
    facts.push(`${num(meta.senderCount)} senders`);
  }
  if (meta.scannedAt) {
    const ago = age(meta.now - meta.scannedAt);
    const when = ago === 'just now' ? 'scanned just now' : `scanned ${ago} ago`;
    facts.push(wide ? (meta.complete === false ? `${when} (partial scan)` : when) : ago === 'just now' ? ago : `${ago} ago`);
  }
  // Narrow: drop the trailing "ago" rather than cutting the line
  let text = facts.join(' · ');
  if (!wide && width(text) > cols - 10) text = text.replace(/ ago$/, '');
  return fit([
    seg(' Zero', COLOR.text, { bold: true }),
    seg('Box', COLOR.accent, { bold: true }),
    seg(wide && meta.version ? ` v${meta.version}` : '', COLOR.chrome),
    seg('  '),
    seg(text, COLOR.muted),
  ], cols);
}

// ── Sender list ─────────────────────────────────────────────────────────────

function listTitles(L) {
  return [
    seg(' '),
    seg(padEnd('', 3), COLOR.muted),
    seg(' '),
    seg(padEnd('SENDER', L.senderW), COLOR.muted),
    seg(' '),
    seg(padStart(L.wide ? 'EMAILS' : 'MAIL', L.emailsW), COLOR.muted),
    seg(' '),
    seg(padStart(L.wide ? 'OPENED' : 'OPEN', L.openedW), COLOR.muted),
    seg(' '),
    seg(padEnd('VERDICT', L.verdictW), COLOR.muted),
    seg(' '),
  ];
}

function listRow(row, L, selected, mark) {
  const bg = selected ? COLOR.selBg : undefined;
  const glyph = markGlyph(mark);
  const markColor = mark?.trash ? COLOR.Nuke : mark ? COLOR.accent : COLOR.chrome;
  // Wide: display name, then the address in grey when there is room
  const showName = L.senderW >= 44 && row.name && row.name !== row.email;
  const nameW = showName ? Math.max(12, Math.floor(L.senderW * 0.42)) : 0;
  const sender = showName
    ? [seg(padEnd(row.name, nameW), selected ? COLOR.text : COLOR.soft, { bg, bold: selected }), seg(padEnd(L.senderW - nameW > 6 ? '  ' + row.email : '', L.senderW - nameW), COLOR.muted, { bg })]
    : [seg(padEnd(row.email, L.senderW), selected ? COLOR.text : COLOR.soft, { bg, bold: selected })];
  return fit([
    seg(selected ? '▌' : ' ', COLOR.accent, { bg }),
    seg(padEnd(glyph, 3), markColor, { bg, bold: Boolean(mark) }),
    seg(' ', undefined, { bg }),
    ...sender,
    seg(' ', undefined, { bg }),
    seg(padStart(num(row.count), L.emailsW), COLOR.text, { bg }),
    seg(' ', undefined, { bg }),
    seg(padStart(pct(row.openedPct), L.openedW), COLOR.soft, { bg }),
    seg(' ', undefined, { bg }),
    seg(padEnd(row.verdict, L.verdictW), COLOR[row.verdict], { bg }),
    seg(' ', undefined, { bg }),
  ], L.listW, bg);
}

function listBody(state, L, height) {
  const rows = visibleRows(state);
  const top = clampTop(state.top, state.cursor, height, rows.length);
  const lines = [listTitles(L)];
  if (!rows.length) {
    const why = state.rows.length ? 'No senders match this filter. Esc clears it.' : 'No senders in this scan.';
    lines.push(fit([seg('  '), seg(why, COLOR.muted)], L.listW));
  }
  for (let i = top; i < Math.min(rows.length, top + height); i++) {
    lines.push(listRow(rows[i], L, i === state.cursor, state.marks[rows[i].email]));
  }
  while (lines.length < height + 1) lines.push(fit([], L.listW));
  return lines.slice(0, height + 1);
}

// ── Detail pane ─────────────────────────────────────────────────────────────

const METHOD_TEXT = {
  'one-click': 'one-click link',
  email: 'by email',
  web: 'web page',
  none: 'none',
};

function detailLines(row, mark, w, now) {
  if (!row) return [fit([seg('  Nothing selected.', COLOR.muted)], w)];
  const kv = (k, v, fg = COLOR.text) => [seg('  '), seg(padEnd(k, 13), COLOR.muted), seg(v, fg)];
  const marks = [];
  if (mark?.trash) marks.push(seg('trash', COLOR.Nuke));
  if (mark?.unsub) marks.push(seg('unsubscribe', COLOR.accent));
  if (mark?.filter) marks.push(seg('filter', COLOR.accent));
  const markSegs = marks.length
    ? marks.flatMap((m, i) => (i ? [seg(' · ', COLOR.chrome), m] : [m]))
    : [seg('none', COLOR.chrome)];
  const trashNote = row.starred ? `${num(row.trashIds.length)} (${num(row.starred)} starred kept)` : num(row.trashIds.length);

  const lines = [
    [seg('  '), seg(row.name, COLOR.text, { bold: true })],
    row.name !== row.email ? [seg('  '), seg(row.email, COLOR.muted)] : [],
    [],
    kv('emails', num(row.count)),
    kv('opened', pct(row.openedPct)),
    kv('replied', pct(row.replyPct)),
    kv('starred', num(row.starred)),
    kv('oldest', `${age(now - row.oldest)} ago`),
    kv('newest', `${age(now - row.newest)} ago`),
    kv('verdict', row.verdict, COLOR[row.verdict]),
    ...(row.protectReason ? [kv('protected', row.protectReason, COLOR.Protect), kv('otherwise', row.baseVerdict, COLOR[row.baseVerdict])] : []),
    kv('unsubscribe', METHOD_TEXT[row.method] + (row.unsubDone ? ', done before' : ''), row.method === 'none' ? COLOR.chrome : COLOR.text),
    [],
    [seg('  '), seg(padEnd('marks', 13), COLOR.muted), ...markSegs],
  ];
  if (mark?.trash) lines.push(kv('to trash', trashNote, COLOR.Nuke));
  lines.push([]);
  lines.push([seg('  '), seg('Space', COLOR.Nuke), seg(' select: unsubscribe + trash', COLOR.muted)]);
  lines.push([
    seg('  '), seg('Del', COLOR.Nuke), seg(' trash · ', COLOR.muted),
    seg('U', COLOR.accent), seg(' unsub · ', COLOR.muted),
    seg('F', COLOR.accent), seg(' filter', COLOR.muted),
  ]);
  lines.push([
    seg('  '), seg('P', COLOR.Protect), seg(row.protectReason ? ' unprotect · ' : ' protect · ', COLOR.muted),
    seg('x', COLOR.text), seg(' clear · ', COLOR.muted),
    seg('A', COLOR.text), seg(' all', COLOR.muted),
  ]);
  return lines.map((l) => fit(l, w));
}

// ── Full-width screens ──────────────────────────────────────────────────────

const STAGE_COLOR = { unsub: COLOR.accent, filter: COLOR.accent, trash: COLOR.Nuke };

/** One line summing up a finished stage, for the banner and the result screen. */
export function stageSummary(kind, r) {
  if (!r) return 'not run';
  if (r.skipped) return 'skipped';
  if (r.error && !r[kind]) return `failed: ${r.error}`;
  const secs = r.seconds ? ` in ${duration(r.seconds)}` : '';
  if (kind === 'unsub') {
    const u = r.unsub;
    const parts = [`${num(u.oneClick ?? 0)} one-click`, `${num(u.sent)} email${u.sent === 1 ? '' : 's'} sent`];
    if (u.links.length) parts.push(`${num(u.links.length)} to finish on the web`);
    if (u.failed.length) parts.push(`${num(u.failed.length)} failed`);
    return parts.join(', ') + secs;
  }
  if (kind === 'filter') {
    const f = r.filter;
    return `${num(f.created)} filter${f.created === 1 ? '' : 's'} created` + (f.existed ? `, ${num(f.existed)} existed` : '') + (f.failed.length ? `, ${num(f.failed.length)} failed` : '') + secs;
  }
  const t = r.trash;
  return `${num(t.trashed)} emails moved to Trash` + (t.failed ? `, ${num(t.failed)} failed` : '') + (t.stopped ? ', stopped by you' : '') + secs;
}

/** "1 Unsubscribe ✓  2 Filters ▸  3 Trash backlog" */
function stageTrack(state) {
  const out = [seg('  ')];
  state.stages.forEach((k, i) => {
    const r = state.stageResults[k];
    const now = i === state.stageIndex;
    const mark = r ? (r.skipped ? ' skipped' : ' ✓') : now ? ' ◂' : '';
    if (i) out.push(seg('   ', COLOR.chrome));
    out.push(seg(`${i + 1} ${STAGE_NAME[k]}${mark}`, now ? STAGE_COLOR[k] : r ? COLOR.muted : COLOR.soft, { bold: now }));
  });
  return out;
}

function reviewLines(state, cols, applying = false) {
  const plan = buildPlan(state.rows, state.marks);
  const kind = state.stages[state.stageIndex] ?? planStages(plan)[0];
  const L = [];
  const addrW = Math.max(16, Math.min(44, cols - 22));
  const n = state.stages.length || 1;
  const step = `Step ${state.stageIndex + 1} of ${n}: ${STAGE_NAME[kind]}`;
  L.push(applying
    ? [seg('  '), seg(step, COLOR.text, { bold: true }), seg('   applying, progress below', COLOR.muted)]
    : [seg('  '), seg(step, COLOR.text, { bold: true }), seg(`   about ${duration(stageEstimate(plan, kind))}`, COLOR.muted)]);
  if (state.stages.length > 1) L.push(stageTrack(state));
  // What the previous stage did
  const prev = state.stages[state.stageIndex - 1];
  if (prev && state.stageResults[prev]) {
    L.push([seg('  '), seg(`${STAGE_NAME[prev]}: `, COLOR.Keep, { bold: true }), seg(stageSummary(prev, state.stageResults[prev]), COLOR.text)]);
  }
  if (!applying) {
    // The question and its keys come first, so a long sender list never hides them
    L.push([]);
    const question = stageQuestion(plan, kind);
    const keys = [seg('Enter', COLOR.accent, { bold: true }), seg(' do it · ', COLOR.muted), seg('S', COLOR.text, { bold: true }), seg(' skip · ', COLOR.muted), seg('Esc', COLOR.text, { bold: true }), seg(' stop', COLOR.muted)];
    const keysW = keys.reduce((n, k) => n + width(k.t), 0);
    if (2 + width(question) + 2 + keysW <= cols) L.push([seg('  '), seg(question, COLOR.text, { bold: true }), seg('  '), ...keys]);
    else L.push([seg('  '), seg(question, COLOR.text, { bold: true })], [seg('  '), ...keys]);
  }
  L.push([]);

  if (kind === 'unsub') {
    const by = { 'one-click': 0, email: 0, web: 0 };
    for (const u of plan.unsub) by[u.method]++;
    const parts = [by['one-click'] && `${num(by['one-click'])} one-click`, by.email && `${num(by.email)} by email`, by.web && `${num(by.web)} web page${by.web === 1 ? '' : 's'}`].filter(Boolean);
    L.push([seg('  '), seg('UNSUBSCRIBE', COLOR.accent, { bold: true }), seg(`  ${num(plan.unsub.length)} sender${plan.unsub.length === 1 ? '' : 's'}: ${parts.join(' · ')}`, COLOR.text)]);
    const acts = [];
    if (by['one-click']) acts.push(`${num(by['one-click'])} one-click request${by['one-click'] === 1 ? '' : 's'}`);
    if (by.email) acts.push(`${num(Math.min(by.email, MAILTO_MAX_PER_RUN))} email${by.email === 1 ? '' : 's'} from your Gmail`);
    if (acts.length) L.push([seg('    '), seg(`Sends ${acts.join(' and ')} on your behalf. ZeroBox cannot undo this.`, COLOR.Review)]);
    L.push([seg('    '), seg('It stops new mail; your existing mail stays where it is.', COLOR.muted)]);
    if (by['one-click']) L.push([seg('    '), seg(`One-click: an https POST to the sender's link (RFC 8058), about ${ONE_CLICK_RATE} a second. If it fails, ZeroBox falls back to email or the web page.`, COLOR.muted)]);
    if (by.email) L.push([seg('    '), seg(`Emails go out one per second. Gmail allows about 500 sends a day; ZeroBox stops at ${MAILTO_MAX_PER_RUN} per run and lists the rest.`, COLOR.muted)]);
    if (by.web) L.push([seg('    '), seg('Web pages are listed for you to open; nothing is sent for them.', COLOR.muted)]);
    L.push([]);
    for (const u of plan.unsub) {
      const how = { 'one-click': 'one-click request', email: 'sends an unsubscribe email', web: 'link listed for you to open' }[u.method];
      if (cols >= 72) L.push([seg('    '), seg(padEnd(u.email, addrW), COLOR.soft), seg(` ${how}`, COLOR.muted)]);
      else L.push([seg('    '), seg(u.email, COLOR.soft)], [seg('      '), seg(how, COLOR.muted)]);
    }
  } else if (kind === 'filter') {
    L.push([seg('  '), seg('FILTERS', COLOR.accent, { bold: true }), seg(`  ${num(plan.filter.length)} sender${plan.filter.length === 1 ? '' : 's'}`, COLOR.text)]);
    L.push([seg('    '), seg('Creates Gmail filters: future mail from these senders skips the inbox and goes to Trash.', COLOR.muted)]);
    L.push([seg('    '), seg('You can delete them later in Gmail settings, Filters and blocked addresses.', COLOR.muted)]);
    L.push([]);
    for (const f of plan.filter) L.push([seg('    '), seg(f.email, COLOR.soft)]);
  } else {
    L.push([seg('  '), seg('TRASH', COLOR.Nuke, { bold: true }), seg(`  ${num(plan.trashEmails)} emails from ${num(plan.trash.length)} sender${plan.trash.length === 1 ? '' : 's'}`, COLOR.text)]);
    L.push([seg('    '), seg('Trash is recoverable in Gmail for 30 days.', COLOR.muted)]);
    L.push([seg('    '), seg(plan.starredSkipped
      ? `${num(plan.starredSkipped)} starred email${plan.starredSkipped === 1 ? ' is' : 's are'} skipped. Starred mail is never trashed.`
      : 'Starred mail is skipped and never trashed.', COLOR.muted)]);
    if (plan.trashEmails > 1000) {
      L.push([seg('    '), seg(`Takes about ${duration(plan.trashEmails / TRASH_RATE)} at ${TRASH_RATE}/s. Ctrl-C stops after the current batch and keeps what was done.`, COLOR.muted)]);
    }
    const forced = plan.trash.filter((t) => t.protected).length;
    if (forced) L.push([seg('    '), seg(`${forced} protected sender${forced === 1 ? ' is' : 's are'} included because you pressed twice to select ${forced === 1 ? 'it' : 'them'}.`, COLOR.Protect)]);
    L.push([]);
    for (const t of plan.trash) {
      L.push([seg('    '), seg(padEnd(t.email, addrW), COLOR.soft), seg(padStart(num(t.ids.length), 8), COLOR.text)]);
    }
  }
  if (!applying && state.stages.length - state.stageIndex - 1 > 0) {
    L.push([]);
    L.push([seg('  '), seg('S skips this step and moves on. Esc stops here: later steps do not run.', COLOR.muted)]);
  }
  return L;
}

const many = (n, word) => `${num(n)} ${word}${n === 1 ? '' : 's'}`;

/** The plain-words question a review step asks. */
export function stageQuestion(plan, kind) {
  if (kind === 'unsub') {
    const sends = plan.unsub.some((u) => u.method !== 'web');
    return `Unsubscribe from ${many(plan.unsub.length, 'sender')}? ${sends ? 'This sends requests from your account.' : 'The pages are listed for you to open.'}`;
  }
  if (kind === 'filter') return `Create filters for ${many(plan.filter.length, 'sender')}? Their future mail skips the inbox.`;
  return `Move ${many(plan.trashEmails, 'email')} from ${many(plan.trash.length, 'sender')} to Trash? You can restore them for 30 days.`;
}

/** Familiar keys, shown first in the help. */
export const HELP = [
  ['↑ ↓  PgUp PgDn', 'move (Home, End: top, bottom)'],
  ['Space', 'select this sender for cleanup: unsubscribe + trash'],
  ['A', 'select every sender in this view (skips protected)'],
  ['Delete', 'trash only'],
  ['U', 'unsubscribe only'],
  ['F', 'filter: future mail skips the inbox'],
  ['x  X', 'clear this sender, clear all'],
  ['R', 'review and apply, one step at a time'],
  ['Enter  →', 'narrow screens: details (Esc goes back)'],
  ['/', 'search by name or address (Esc clears)'],
  ['V  Tab', 'show All, Nuke, Review, Keep or Protect'],
  ['P', 'protect or unprotect this sender'],
  ['S', 'settings: which senders are protected'],
  ['Ctrl-R', 'rescan your inbox'],
  ['Esc', 'back, close, clear the search'],
  ['q  ?', 'quit, this help'],
  ['Ctrl-C', 'while applying: stop after this batch'],
];

/** Vim keys and commands: they keep working, the screen does not show them. */
export const POWER_KEYS = [
  ['j k  gg G', 'move, top, bottom'],
  ['Ctrl-d  Ctrl-u', 'half page down, up'],
  ['d  u  f', 'trash, unsubscribe, filter this sender'],
  ['D', 'mark every sender in view for trash'],
  [':U  :F', 'mark every sender in view to unsubscribe, filter'],
  ['w  :w', 'review'],
  ['Tab l  h', 'narrow screens: open, close details'],
  ['v  p  ,', 'verdict view, protect, settings'],
  [':set  :scan', 'settings, rescan'],
  [':q  :q!', 'quit, quit without asking'],
  ['y  n', 'in a review step: do it, stop'],
];

function helpLines() {
  const row = ([k, v]) => [seg('  '), seg(padEnd(k, 16), COLOR.accent), seg(v, COLOR.soft)];
  return [
    [seg('  '), seg('Basics', COLOR.text, { bold: true }), seg('   any key closes', COLOR.muted)],
    [],
    ...HELP.map(row),
    [],
    [seg('  '), seg('In a review step: ', COLOR.text), seg('Enter does it, S skips it, Esc stops.', COLOR.soft)],
    [seg('  '), seg('Nothing changes in Gmail until you press R and confirm.', COLOR.muted)],
    [seg('  '), seg('Trashed mail can be restored from Gmail Trash for 30 days.', COLOR.muted)],
    [],
    [seg('  '), seg('Quick cleanup: ', COLOR.text), seg('V to the Nuke view, A to select all, R to review.', COLOR.soft)],
    [seg('  '), seg('Protected senders (banks, government, health, account security, starred,', COLOR.muted)],
    [seg('  '), seg('replied or often opened) are skipped by A; selecting one asks twice.', COLOR.muted)],
    [seg('  '), seg('Press S to choose which of these rules apply.', COLOR.muted)],
    [],
    [seg('  '), seg('Power keys (Vim)', COLOR.text, { bold: true })],
    [],
    ...POWER_KEYS.map(row),
  ];
}

// ── Settings screen ─────────────────────────────────────────────────────────

/** Split text into lines of at most `w` columns at spaces. */
function wrapText(text, w) {
  const out = [];
  let cur = '';
  for (const word of text.split(' ')) {
    if (cur && width(cur + ' ' + word) > w) { out.push(cur); cur = word; } else cur = cur ? `${cur} ${word}` : word;
  }
  if (cur) out.push(cur);
  return out;
}

const senders = (n) => `${num(n)} sender${n === 1 ? '' : 's'}`;

/** What one switch does in this inbox right now, long and short. */
function settingCount(key, p, counts) {
  if (key === 'financeMarketing') {
    const n = counts.financeMarketing;
    if (!p.finance) return { long: 'finance is off', short: 'n/a' };
    return p.financeMarketing
      ? { long: `keeps ${senders(n)} protected`, short: `keeps ${num(n)}` }
      : { long: `${senders(n)} left unprotected`, short: `${num(n)} unprotected` };
  }
  const n = counts[key];
  return p[key]
    ? { long: `protects ${senders(n)}`, short: senders(n) }
    : { long: `off · would protect ${num(n)}`, short: `off (${num(n)})` };
}

/**
 * The settings screen: one entry per switch with what it covers and how many
 * senders it protects in this inbox. Returns the lines and the line range of
 * the selected entry, so the caller can keep it on screen.
 */
export function settingsLines(state, cols) {
  const draft = state.settingsDraft ?? state.settings;
  const p = { ...draft.protect };
  const counts = settingsCounts(state.rows, draft, state.own);
  const wide = cols >= 80;
  const labelW = wide ? 20 : 18;
  const L = [];
  L.push([seg('  '), seg('Settings', COLOR.text, { bold: true }), seg(wide ? '   what ZeroBox protects from bulk marks' : '   protection rules', COLOR.muted)]);
  for (const t of wrapText('Protected senders get the Protect verdict, and A (select all) skips them.', cols - 4)) L.push([seg('  '), seg(t, COLOR.muted)]);
  L.push([]);

  let sel = [0, 0];
  SETTING_ITEMS.forEach((item, i) => {
    const on = Boolean(p[item.key]);
    const selected = i === state.settingsCursor;
    const bg = selected ? COLOR.selBg : undefined;
    const label = item.label.replace('{min}', p.openedMin);
    const about = item.about.replace(/\{min\}/g, p.openedMin);
    const moot = item.key === 'financeMarketing' && !p.finance;
    const count = settingCount(item.key, p, counts);
    const box = seg(on ? '[x]' : '[ ]', moot ? COLOR.chrome : on ? COLOR.Keep : COLOR.muted, { bg, bold: on && !moot });
    const head = [
      seg(selected ? '▌ ' : '  ', COLOR.accent, { bg }),
      box,
      seg(' ', undefined, { bg }),
      seg(padEnd(label, labelW), moot ? COLOR.muted : selected ? COLOR.text : COLOR.soft, { bg, bold: selected }),
    ];
    const start = L.length;
    const one = `${about} · ${count.long}`;
    if (wide && 2 + 3 + 1 + labelW + width(one) <= cols) {
      L.push(fit([...head, seg(about, COLOR.muted, { bg }), seg(' · ', COLOR.chrome, { bg }), seg(count.long, on && !moot ? COLOR.Protect : COLOR.muted, { bg })], cols, bg));
    } else {
      // Narrow: the count on the first line, the explanation wrapped below
      const room = cols - (2 + 3 + 1 + labelW) - 1;
      const c = width(count.long) <= room ? count.long : count.short;
      L.push(fit([...head, seg(padStart(c, Math.max(0, room)), on && !moot ? COLOR.Protect : COLOR.muted, { bg }), seg(' ', undefined, { bg })], cols, bg));
      for (const t of wrapText(about, cols - 7)) L.push(fit([seg('      '), seg(t, COLOR.muted)], cols));
    }
    sel = selected ? [start, L.length - 1] : sel;
  });

  L.push([]);
  L.push([seg('  '), seg('Always on', COLOR.text, { bold: true })]);
  const locked = [
    ['your address', counts.own, 'mail from yourself'],
    ['starred', counts.starred, 'starred mail is never trashed'],
  ];
  for (const [label, n, about] of locked) {
    const head = [seg('  '), seg('[•]', COLOR.chrome), seg(' '), seg(padEnd(label, labelW), COLOR.muted)];
    if (wide) L.push([...head, seg(about, COLOR.muted), seg(' · ', COLOR.chrome), seg(senders(n), COLOR.muted)]);
    else L.push([...head, seg(padStart(senders(n), Math.max(0, cols - (6 + labelW) - 1)), COLOR.muted)]);
  }
  L.push([]);
  for (const t of wrapText('Your protected.txt (P) wins over these rules.', cols - 4)) L.push([seg('  '), seg(t, COLOR.muted)]);
  const keys = wide
    ? [seg('  '), seg('↑ ↓', COLOR.accent), seg(' move   ', COLOR.muted), seg('Space', COLOR.accent), seg(' toggles   ', COLOR.muted), seg('+ -', COLOR.accent), seg(' opened %   ', COLOR.muted), seg('Esc', COLOR.accent), seg(' saves and closes', COLOR.muted)]
    : [seg('  '), seg('Space', COLOR.accent), seg(' toggle  ', COLOR.muted), seg('+ -', COLOR.accent), seg(' opened  ', COLOR.muted), seg('Esc', COLOR.accent), seg(' save', COLOR.muted)];
  L.push(keys);
  return { lines: L, sel };
}

function resultLines(result, cols) {
  const nothing = result.error && !result.trash && !result.unsub && !result.filter;
  const L = [[seg('  '), seg(nothing ? 'Nothing was changed' : 'Done', COLOR.text, { bold: true }), seg(nothing ? '' : `   ${result.seconds}s`, COLOR.muted)], []];
  const line = (label, fg, text) => L.push([seg('  '), seg(padEnd(label, 13), fg, { bold: true }), seg(text, COLOR.text)]);
  // Staged runs: one line per stage, in the order they ran, then the details
  if (result.stages?.length) {
    for (const st of result.stages) {
      const text = st.status === 'done' || st.status === 'stopped' ? `${st.status}${st.seconds ? ` in ${duration(st.seconds)}` : ''}` : st.status;
      L.push([seg('  '), seg(padEnd(STAGE_NAME[st.kind], 15), STAGE_COLOR[st.kind], { bold: true }), seg(text, st.status === 'done' ? COLOR.Keep : COLOR.muted)]);
    }
    L.push([]);
  }
  if (result.unsub) {
    const oc = result.unsub.oneClick ?? 0;
    line('unsubscribe', COLOR.accent, `${num(oc)} one-click, ${num(result.unsub.sent)} email${result.unsub.sent === 1 ? '' : 's'} sent`);
    if (result.unsub.sendStopped) L.push([seg('               '), seg(`Emails ${result.unsub.sendStopped}.`, COLOR.Review)]);
    if (result.unsub.notSent?.length) L.push([seg('               '), seg(`${num(result.unsub.notSent.length)} not sent yet; mark them again tomorrow: ${result.unsub.notSent.join(', ')}`, COLOR.Review)]);
    for (const f of result.unsub.failed) L.push([seg('               '), seg(`failed  ${f.email}: ${f.error}`, COLOR.Review)]);
    if (result.unsub.links.length) {
      L.push([seg('               '), seg(result.unsub.opened ? 'Opened in your browser. Finish these yourself:' : 'Open these yourself to finish (also printed when you quit):', COLOR.muted)]);
      for (const l of result.unsub.links) {
        L.push([seg('               '), seg(l.email, COLOR.soft)]);
        // URLs are printed whole on their own line so they stay copyable
        L.push([seg('                 '), seg(l.url, COLOR.accent)]);
      }
    }
  }
  if (result.filter) {
    line('filter', COLOR.accent, `${result.filter.created} filter${result.filter.created === 1 ? '' : 's'} created` + (result.filter.existed ? `, ${result.filter.existed} already existed` : ''));
    for (const f of result.filter.failed) L.push([seg('               '), seg(`failed  ${f.email}: ${f.error}`, COLOR.Review)]);
  }
  if (result.trash) {
    line('trash', COLOR.Nuke, `${num(result.trash.trashed)} emails moved to Trash`);
    if (result.trash.failed) L.push([seg('               '), seg(`${num(result.trash.failed)} could not be moved and are still in your inbox.`, COLOR.Review)]);
    if (result.trash.stopped) L.push([seg('               '), seg(`Stopped by you: ${num(result.trash.notAttempted)} were not attempted and are still in your inbox.`, COLOR.Review)]);
    if (result.trash.starredSkipped) L.push([seg('               '), seg(`${num(result.trash.starredSkipped)} starred emails were kept.`, COLOR.muted)]);
    L.push([seg('               '), seg('Restore any of it from Gmail Trash in the next 30 days.', COLOR.muted)]);
  }
  if (result.stopped && !result.trash?.stopped) L.push([], [seg('  '), seg('Stopped by you before every step finished. What was done is saved.', COLOR.Review)]);
  if (result.error) L.push([], [seg('  '), seg(`Stopped: ${result.error}`, COLOR.Nuke)]);
  if (result.logPath) L.push([], [seg('  '), seg(`Logged to ${result.logPath}`, COLOR.muted)]);
  L.push([], [seg('  '), seg('Any key returns to the list. q quits.', COLOR.muted)]);
  return L;
}

/**
 * Wrap a line that is too wide: the last segment flows onto extra lines,
 * indented under where it started. Words wrap at spaces; long tokens such
 * as URLs are split so they are never cut off.
 */
export function wrapLine(line, cols) {
  const total = line.reduce((n, s) => n + width(s.t), 0);
  if (total <= cols || !line.length) return [line];
  const head = line.slice(0, -1);
  const last = line[line.length - 1];
  const indent = head.reduce((n, s) => n + width(s.t), 0);
  const room = cols - indent;
  if (room < 10) return [line];
  const out = [];
  let cur = '';
  const push = () => { out.push(cur); cur = ''; };
  for (const word of last.t.split(/(?<= )/)) {
    if (width(cur + word) <= room) { cur += word; continue; }
    if (cur) push();
    let w = word;
    while (width(w) > room) { out.push(w.slice(0, room)); w = w.slice(room); }
    cur = w;
  }
  if (cur) push();
  return out.map((t, i) => (i === 0 ? [...head, { ...last, t }] : [seg(' '.repeat(indent)), { ...last, t }]));
}

function scrolled(lines, scroll, height, cols) {
  lines = lines.flatMap((l) => wrapLine(l, cols));
  // The last row holds the scroll tag: add a spare line so it never hides content
  if (lines.length > height) lines.push([]);
  const max = Math.max(0, lines.length - height);
  const s = Math.min(scroll, max);
  const out = lines.slice(s, s + height).map((l) => fit(l, cols));
  while (out.length < height) out.push(fit([], cols));
  if (max > 0) {
    const tag = s < max ? ` more below (↓) ` : ' end ';
    out[height - 1] = fit([seg(' '.repeat(Math.max(0, cols - tag.length - 1))), seg(tag, COLOR.muted)], cols);
  }
  return out;
}

// ── Message line and status line ────────────────────────────────────────────

const MODE = {
  normal: ['NORMAL', COLOR.accent],
  filter: ['FILTER', COLOR.Review],
  command: ['COMMAND', COLOR.soft],
  review: ['REVIEW', COLOR.Nuke],
  confirm: ['NORMAL', COLOR.accent],
  help: ['HELP', COLOR.soft],
  settings: ['SETTINGS', COLOR.Protect],
  applying: ['APPLYING', COLOR.Review],
  result: ['DONE', COLOR.Keep],
};

function messageLine(state, cols, hasData) {
  if (state.mode === 'filter') {
    return fit([seg(' /', COLOR.Review, { bold: true }), seg(state.filterDraft, COLOR.text), seg('▏', COLOR.accent), seg('   Enter keeps · Esc clears', COLOR.muted)], cols);
  }
  if (state.mode === 'command') {
    return fit([seg(' :', COLOR.accent, { bold: true }), seg(state.command, COLOR.text), seg('▏', COLOR.accent)], cols);
  }
  if (state.mode === 'confirm') {
    const what = state.confirm === 'rescan' ? 'Rescan and drop your marks?' : 'Quit and drop your marks?';
    return fit([seg(` ${what} `, COLOR.Review, { bold: true }), seg('Enter', COLOR.text, { bold: true }), seg(' yes · ', COLOR.muted), seg('Esc', COLOR.text, { bold: true }), seg(' no', COLOR.muted)], cols);
  }
  if (state.mode === 'applying' && state.progress) {
    const p = state.progress;
    const extra = [];
    if (p.rate) extra.push(`${Math.round(p.rate)}/s`);
    if (p.etaSeconds != null && p.done < p.total && p.done > 0) extra.push(`ETA ${duration(p.etaSeconds)}`);
    if (state.cancelling) extra.push('stopping after this batch');
    const tail = (p.total ? ` ${num(p.done)}/${num(p.total)}` : '') + (extra.length ? ` · ${extra.join(' · ')}` : '');
    // Narrow screens: shorten the label ("Moving to Trash" → "Trash") and drop the bar
    const label = width(p.label) + width(tail) + 3 > cols ? p.label.split(' ').pop() : p.label;
    let barW = Math.min(30, cols - width(label) - width(tail) - 3);
    if (barW < 6) barW = 0;
    const done = p.total ? Math.round((p.done / p.total) * barW) : 0;
    return fit([
      seg(` ${label} `, COLOR.text),
      seg('━'.repeat(done), COLOR.accent),
      seg('━'.repeat(barW - done), COLOR.chrome),
      seg(tail, state.cancelling ? COLOR.Review : COLOR.muted),
    ], cols);
  }
  if (state.flash) {
    // Too wide: the short form, then shorter ones, so the end is not cut off
    const short = state.flashShort?.for === state.flash ? [state.flashShort.text, ...(state.flashShort.shorter ?? [])] : [];
    const options = [state.flash, ...short];
    const text = options.find((t) => width(t) + 1 <= cols) ?? options[options.length - 1];
    return fit([seg(` ${text}`, COLOR.accent)], cols);
  }
  if (!hasData) return fit([], cols);
  const f = [];
  if (state.filterText) f.push(`/${state.filterText}`);
  if (state.verdictFilter !== 'All') f.push(state.verdictFilter);
  return fit([seg(f.length ? ` showing ${f.join(' · ')}` : '', COLOR.muted)], cols);
}

/** Hints for the status line, longest first; the widest that fits is shown. */
function statusHints(state, wide, marked) {
  switch (state.mode) {
    case 'normal':
      if (!wide && state.detail) return ['Esc back · Space select · ? help', 'Esc back · Space · ?', 'Esc back'];
      if (marked) return ['R review · Space select · A all · ? help', 'R review · ? help', 'R review'];
      return ['↑↓ move · Space select · A select all · R review · ? help', 'Space select · A all · R review · ?', 'Space · A · R · ?'];
    case 'filter': return ['type to search · Enter keep · Esc clear', 'Enter keep · Esc clear'];
    case 'command': return ['w review · q quit · set settings', 'w review · q quit'];
    case 'review': return ['Enter do it · S skip · Esc stop', 'Enter · S skip · Esc', 'Enter · S · Esc'];
    case 'confirm': return ['Enter yes · Esc no'];
    case 'help': return ['↑↓ scroll · any other key closes', 'any key closes'];
    case 'settings': return ['Space toggle · + - opened % · Esc save', 'Esc save'];
    case 'applying': return [state.cancelling ? 'stopping…' : 'Ctrl-C stops'];
    case 'result': return ['any key returns · q quit', 'any key returns'];
    default: return [];
  }
}

/**
 * Pick the longest summary and hint that fit: the summary may shrink so a
 * hint still shows, and the position gives way before the hint gets shorter.
 */
function pickStatus(room, posW, sums, hints) {
  for (const s of sums) {
    const sw = width(s);
    for (const h of hints.length ? hints : ['']) {
      const need = sw + (s && h ? 3 : 0) + width(h);
      if (need <= room - posW) return { sum: s, hint: h, withPos: true };
      if (need <= room) return { sum: s, hint: h, withPos: false };
    }
  }
  const last = sums[sums.length - 1] ?? '';
  return { sum: cut(last, room - posW), hint: '', withPos: true };
}

function statusLine(state, cols, wide) {
  const [label, color] = MODE[state.mode] ?? MODE.normal;
  const badge = seg(` ${label} `, COLOR.ink, { bg: color, bold: true });
  const total = visibleRows(state).length;
  const pos = total ? ` ${state.cursor + 1}/${num(total)} ` : ' 0/0 ';
  const plan = buildPlan(state.rows, state.marks);
  const marked = !planIsEmpty(plan);
  // Nothing marked: the hints are the whole message
  let sums = marked ? [planSummary(plan), planSummary(plan, true), `${num(plan.senders)} marked`] : [''];
  const stage = state.stages?.[state.stageIndex];
  if ((state.mode === 'review' || state.mode === 'applying') && stage) {
    const pl = (n, w) => `${num(n)} ${w}${n === 1 ? '' : 's'}`;
    const what = { unsub: pl(plan.unsub.length, 'sender'), filter: pl(plan.filter.length, 'filter'), trash: pl(plan.trashEmails, 'email') }[stage];
    const est = duration(stageEstimate(plan, stage));
    sums = [
      `step ${state.stageIndex + 1}/${state.stages.length} ${STAGE_NAME[stage].toLowerCase()}: ${what}, about ${est}`,
      `step ${state.stageIndex + 1}/${state.stages.length} ${{ unsub: 'unsub', filter: 'filters', trash: 'trash' }[stage]} ~${est}`,
      `step ${state.stageIndex + 1}/${state.stages.length}`,
    ];
  }
  const { sum, hint, withPos } = pickStatus(cols - width(badge.t) - 1, width(pos), sums, statusHints(state, wide, marked));
  const segs = [badge, seg(' ')];
  if (sum) segs.push(seg(sum, COLOR.text));
  if (sum && hint) segs.push(seg(' │ ', COLOR.chrome));
  if (hint) segs.push(seg(hint, COLOR.muted));
  const used = segs.reduce((n, s) => n + width(s.t), 0);
  if (withPos) segs.push(seg(' '.repeat(Math.max(0, cols - used - width(pos)))), seg(pos, COLOR.muted));
  return fit(segs, cols);
}

// ── Screens ─────────────────────────────────────────────────────────────────

function emptyScreen(cols, rows, meta) {
  const lines = [header(cols, meta, cols >= 90), rule(cols), []];
  const body = meta.cacheError ? [
    [seg('  '), seg('The scan cache could not be read.', COLOR.text, { bold: true })],
    [],
    [seg('  '), seg('A scan may be writing it right now. Try again in a moment,', COLOR.soft)],
    [seg('  '), seg('or press ', COLOR.soft), seg('Ctrl-R', COLOR.accent, { bold: true }), seg(' to run a fresh scan.', COLOR.soft)],
    [],
    [seg('  '), seg(String(meta.cacheError), COLOR.muted)],
  ] : meta.needsSetup ? [
    [seg('  '), seg('Welcome to ZeroBox. First, connect it to Gmail.', COLOR.text, { bold: true })],
    [],
    [seg('  '), seg('During the beta, ZeroBox signs in with your own Google client.', COLOR.soft)],
    [],
    [seg('  '), seg('Press ', COLOR.soft), seg('Enter', COLOR.accent, { bold: true }), seg(' to start the guided setup.', COLOR.soft)],
    [seg('  '), seg('It takes about 5 minutes, once.', COLOR.soft)],
    [seg('  '), seg('Or run ', COLOR.soft), seg('zerobox setup', COLOR.accent), seg(' any time.', COLOR.soft)],
    [],
    [seg('  '), seg('Your mail goes only between this computer and Google.', COLOR.muted)],
    [seg('  '), seg(`Scans stay on this machine in ${meta.home ?? 'your ZeroBox folder'}.`, COLOR.muted)],
  ] : [
    [seg('  '), seg('No scan yet.', COLOR.text, { bold: true })],
    [],
    [seg('  '), seg('ZeroBox needs one pass over your inbox to rank senders.', COLOR.soft)],
    [seg('  '), seg('Run ', COLOR.soft), seg('zerobox scan', COLOR.accent), seg(' in your terminal, or press ', COLOR.soft), seg('Ctrl-R', COLOR.accent, { bold: true }), seg(' to start it now.', COLOR.soft)],
    [],
    [seg('  '), seg('It reads headers only (sender, date, unsubscribe links) and keeps', COLOR.muted)],
    [seg('  '), seg(`them on this machine in ${meta.home ?? 'your ZeroBox folder'}.`, COLOR.muted)],
  ];
  const keys = meta.needsSetup && !meta.cacheError
    ? [seg('  '), seg('Enter', COLOR.accent, { bold: true }), seg(' setup   ', COLOR.muted), seg('q', COLOR.text, { bold: true }), seg(' quit', COLOR.muted)]
    : [seg('  '), seg('Ctrl-R', COLOR.accent, { bold: true }), seg(' scan   ', COLOR.muted), seg('q', COLOR.text, { bold: true }), seg(' quit', COLOR.muted)];
  body.push([], keys);
  lines.push(...body.flatMap((l) => wrapLine(l, cols)));
  const out = lines.map((l) => fit(l, cols));
  while (out.length < rows - 1) out.push(fit([], cols));
  return out.slice(0, rows - 1);
}

/**
 * Render the whole screen.
 * @param {import('./keys.js').UiState} state
 * @param {{cols: number, rows: number}} size  already clamped by screenSize()
 * @param {object} meta  version, account, totalEmails, senderCount, scannedAt, complete, now, home, hasCache, needsSetup
 * @returns {Seg[][]} rows - 1 lines, each exactly `cols` wide
 */
export function renderScreen(state, size, meta) {
  const { cols, rows } = size;
  if (!meta.hasCache) {
    const out = emptyScreen(cols, rows, meta);
    const hint = meta.needsSetup && !meta.cacheError ? ' Enter setup · q quit' : ' Ctrl-R scan · q quit';
    out[out.length - 1] = fit([seg(' NORMAL ', COLOR.ink, { bg: COLOR.accent, bold: true }), seg(hint, COLOR.muted)], cols);
    return out;
  }

  const L = layout(cols);
  const height = bodyHeight(rows);
  const lines = [header(cols, meta, L.wide), rule(cols)];

  const fullScreen = { review: () => reviewLines(state, cols), help: helpLines, result: () => resultLines(state.result, cols) }[state.mode]
    ?? (state.mode === 'applying' ? () => reviewLines(state, cols, true) : null);

  if (state.mode === 'settings') {
    const { lines: body, sel } = settingsLines(state, cols);
    const h = height + 1;
    // Keep the selected entry (and the line after it) on screen
    const scroll = Math.max(0, Math.min(sel[0], sel[1] + 2 - h));
    lines.push(...scrolled(body, scroll, h, cols));
  } else if (fullScreen) {
    lines.push(...scrolled(fullScreen(), state.scroll, height + 1, cols));
  } else if (L.wide) {
    const list = listBody(state, L, height);
    const row = currentRow(state);
    const detail = [fit([seg('  DETAIL', COLOR.muted)], L.detailW), ...detailLines(row, row && state.marks[row.email], L.detailW, meta.now)];
    for (let i = 0; i < list.length; i++) {
      lines.push([...list[i], seg('│', COLOR.chrome), ...(detail[i] ?? fit([], L.detailW))]);
    }
  } else if (state.detail) {
    const row = currentRow(state);
    const detail = [fit([seg('  DETAIL', COLOR.muted), seg('   Esc back', COLOR.chrome)], cols), ...detailLines(row, row && state.marks[row.email], cols, meta.now)];
    lines.push(...scrolled(detail, 0, height + 1, cols));
  } else {
    lines.push(...listBody(state, { ...L, listW: cols }, height));
  }

  lines.push(rule(cols));
  lines.push(messageLine(state, cols, true));
  lines.push(statusLine(state, cols, L.wide));
  return lines;
}
