/**
 * @module tui/keys
 * Key → state reducer for the full-screen UI. Pure: it never touches Gmail,
 * the filesystem or the terminal. Side effects are returned as `effect`
 * ('quit' | 'apply' | 'rescan' | 'reload') for the Ink layer to run.
 */

import {
  SETTING_ITEMS, applyProtection, buildPlan, bulkCleanup, bulkMark, clampTop, clearMarks, filterRows, isCleanup, nextVerdictFilter, planIsEmpty, planStages, recomputeProtection, toggleCleanup, toggleMark,
} from './model.js';
import { protectSettings, toggleProtectText } from '../protect.js';
import { OPENED_MIN_RANGE, OPENED_STEP, mergeSettings } from '../settings.js';
import { num } from './text.js';

/**
 * @typedef {object} UiState
 * @property {import('./model.js').Row[]} rows
 * @property {Record<string, import('./model.js').Mark>} marks
 * @property {number} cursor   index into the visible rows
 * @property {number} top      first visible row
 * @property {'normal'|'filter'|'command'|'review'|'help'|'confirm'|'applying'|'result'|'settings'} mode
 * @property {string} filterText
 * @property {string} filterDraft
 * @property {string} verdictFilter
 * @property {string} command
 * @property {boolean} pendingG
 * @property {boolean} detail   narrow layout: detail pane open
 * @property {string} flash
 * @property {number} scroll    scroll offset for review/help/result
 * @property {'quit'|'rescan'|null} confirm
 * @property {object|null} progress
 * @property {object|null} result
 * @property {string} protectText  contents of protected.txt
 * @property {string|null} armed   "kind:address" whose protection a second press of the same action overrides
 * @property {boolean} cancelling  Ctrl-C pressed while applying
 * @property {Array<'unsub'|'filter'|'trash'>} stages  review stages, in order
 * @property {number} stageIndex   the stage being reviewed or applied
 * @property {Record<string, object>} stageResults  per stage: apply result, or {skipped: true}
 * @property {object} settings      settings.json as saved
 * @property {object|null} settingsDraft  being edited on the settings screen
 * @property {number} settingsCursor     index into SETTING_ITEMS
 * @property {string[]} own         the user's own addresses
 */

/**
 * @param {import('./model.js').Row[]} [rows]
 * @param {object} [marks]
 * @param {string} [protectText]
 * @param {{settings?: object, own?: string[]}} [opts]  settings.json and own addresses the rows were built with
 * @returns {UiState}
 */
export function initialState(rows = [], marks = {}, protectText = '', { settings, own = [] } = {}) {
  return {
    rows, marks, cursor: 0, top: 0, mode: 'normal',
    filterText: '', filterDraft: '', verdictFilter: 'All', command: '',
    pendingG: false, detail: false, flash: '', scroll: 0, confirm: null,
    progress: null, result: null, protectText, armed: null, cancelling: false,
    stages: [], stageIndex: 0, stageResults: {},
    settings: mergeSettings(settings), settingsDraft: null, settingsCursor: 0, own,
  };
}

let memo = { rows: null, text: null, verdict: null, out: [] };

/** Rows currently shown, after the text and verdict filters. */
export function visibleRows(state) {
  const text = state.mode === 'filter' ? state.filterDraft : state.filterText;
  if (memo.rows !== state.rows || memo.text !== text || memo.verdict !== state.verdictFilter) {
    memo = { rows: state.rows, text, verdict: state.verdictFilter, out: filterRows(state.rows, { text, verdict: state.verdictFilter }) };
  }
  return memo.out;
}

export function currentRow(state) {
  return visibleRows(state)[state.cursor] ?? null;
}

const isBack = (key) => key.backspace || key.delete;

/** Ink reports some printable keys with ctrl/meta; this keeps only real text. */
const printable = (input, key) =>
  !key.ctrl && !key.meta && !key.return && !key.tab && !key.escape && input && !/[\x00-\x1f\x7f]/.test(input);

function moveTo(state, cursor, ctx) {
  const total = visibleRows(state).length;
  const c = Math.max(0, Math.min(total - 1, cursor));
  const cur = Math.max(0, c);
  return { ...state, cursor: cur, top: clampTop(state.top, cur, ctx.height, total), pendingG: false, flash: '' };
}

function resetCursor(state) {
  return { ...state, cursor: 0, top: 0 };
}

function hasMarks(state) {
  return Object.keys(state.marks).length > 0;
}

function openReview(state) {
  const plan = buildPlan(state.rows, state.marks);
  if (planIsEmpty(plan)) return { ...state, flash: 'Nothing selected yet. Press Space on a sender, or A for everyone in view.', mode: 'normal' };
  return { ...state, mode: 'review', scroll: 0, flash: '', stages: planStages(plan), stageIndex: 0, stageResults: {} };
}

/** The stage under review or being applied. */
export function currentStage(state) {
  return state.stages[state.stageIndex] ?? null;
}

const KIND_RESULT = { unsub: 'unsub', filter: 'filter', trash: 'trash' };

/**
 * Merge per-stage results into one result for the result screen.
 * Skipped stages are listed; seconds add up.
 */
export function combineResults(stages, stageResults) {
  const out = { trash: null, unsub: null, filter: null, logPath: null, seconds: 0, stopped: false, error: null, stages: [] };
  for (const kind of stages) {
    const r = stageResults[kind];
    if (!r) { out.stages.push({ kind, status: 'not run' }); continue; }
    if (r.skipped) { out.stages.push({ kind, status: 'skipped' }); continue; }
    out[KIND_RESULT[kind]] = r[KIND_RESULT[kind]] ?? null;
    out.logPath = out.logPath ?? r.logPath ?? null;
    out.seconds = parseFloat((out.seconds + (r.seconds ?? 0)).toFixed(1));
    out.stopped = out.stopped || Boolean(r.stopped);
    out.error = out.error ?? r.error ?? null;
    out.stages.push({ kind, status: r.error && !r[kind] ? 'failed' : r.stopped ? 'stopped' : 'done', seconds: r.seconds ?? 0 });
  }
  return out;
}

/**
 * Leave the staged review: show the result screen if anything ran, else go
 * back to the list. Marks of applied stages are dropped; skipped stages keep
 * theirs so they can be applied later.
 */
function finishStages(state, flash = '') {
  const ran = state.stages.filter((k) => state.stageResults[k] && !state.stageResults[k].skipped);
  if (!ran.length) {
    return { ...state, mode: 'normal', scroll: 0, stages: [], stageIndex: 0, stageResults: {}, flash: flash || 'Nothing changed. Your marks are kept.' };
  }
  const result = combineResults(state.stages, state.stageResults);
  const applied = ran.filter((k) => result[KIND_RESULT[k]]);
  const marks = {};
  for (const [email, m] of Object.entries(state.marks)) {
    const left = { ...m };
    for (const k of applied) delete left[k];
    if (Object.keys(left).length) marks[email] = left;
  }
  return { ...state, mode: 'result', result, marks, scroll: 0, progress: null, cancelling: false };
}

function nextStage(state) {
  const i = state.stageIndex + 1;
  if (i >= state.stages.length) return finishStages(state);
  return { ...state, mode: 'review', stageIndex: i, scroll: 0, progress: null, cancelling: false };
}

/**
 * The app calls this when a stage finishes applying. Moves on to the next
 * stage's review, or to the result screen after the last one, after an
 * error, or when the user stopped with Ctrl-C.
 */
export function stageDone(state, kind, result) {
  const next = { ...state, stageResults: { ...state.stageResults, [kind]: result } };
  if (result.error || result.stopped) return finishStages(next);
  return nextStage(next);
}

function askOrDo(state, action) {
  if (hasMarks(state)) {
    return { state: { ...state, mode: 'confirm', confirm: action, flash: '' } };
  }
  return { state, effect: action };
}

function runCommand(state, cmd) {
  const base = { ...state, mode: 'normal', command: '' };
  switch (cmd.trim()) {
    case '':
      return { state: base };
    case 'w':
    case 'wq':
    case 'x':
    case 'review':
      return { state: openReview(base) };
    case 'scan':
    case 'rescan':
      return askOrDo(base, 'rescan');
    // Bulk marks for one kind; U and F keys now act on one sender
    case 'D':
      return { state: bulk(base, 'trash') };
    case 'U':
      return { state: bulk(base, 'unsub') };
    case 'F':
      return { state: bulk(base, 'filter') };
    case 'q':
    case 'quit':
      return askOrDo(base, 'quit');
    case 'q!':
    case 'qa!':
      return { state: base, effect: 'quit' };
    case 'help':
    case 'h':
      return { state: { ...base, mode: 'help', scroll: 0 } };
    case 'set':
    case 'settings':
      return { state: openSettings(base) };
    default:
      return { state: { ...base, flash: `Not a command: :${cmd.trim()}  (try :w, :q or ?)` } };
  }
}

/**
 * Keys that toggle a mark on the current sender. `label` is the key as the
 * user knows it, for the "press it again" message.
 * @returns {{kind: 'cleanup'|'trash'|'unsub'|'filter', label: string}|null}
 */
export function markKey(input, key) {
  if (key.ctrl) return null;
  if (input === ' ') return { kind: 'cleanup', label: 'Space' };
  if (key.delete || key.backspace) return { kind: 'trash', label: 'Delete' };
  if (input === 'd') return { kind: 'trash', label: 'd' };
  if (input === 'u' || input === 'U') return { kind: 'unsub', label: input };
  if (input === 'f' || input === 'F') return { kind: 'filter', label: input };
  return null;
}

const ANYWAY = { cleanup: 'select it', trash: 'trash it', unsub: 'unsubscribe', filter: 'filter it' };

/**
 * Space (cleanup), Delete/d (trash), U/u (unsubscribe), F/f (filter) on one
 * sender. A protected sender needs a second press of the same action: the
 * first only explains, so a stray key never trashes a bank.
 */
function toggle(state, kind, label = kind) {
  const row = currentRow(state);
  if (!row) return state;
  if (kind === 'unsub' && row.method === 'none') {
    return { ...state, flash: 'No unsubscribe link for this sender. Account mail usually has none.' };
  }
  const marking = kind === 'cleanup' ? !isCleanup(row, state.marks[row.email]) : !state.marks[row.email]?.[kind];
  const armKey = `${kind}:${row.email}`;
  if (marking && row.protectReason && state.armed !== armKey) {
    return {
      ...state,
      armed: armKey,
      flash: `${row.email} is protected (${row.protectReason}). Press ${label} again to ${ANYWAY[kind]} anyway, or P to unprotect.`,
    };
  }
  if (kind === 'cleanup') {
    const { marks, on } = toggleCleanup(state.marks, row);
    const why = row.method === 'none' ? ' (no unsubscribe link)' : row.unsubDone ? ' (already unsubscribed)' : '';
    const what = marks[row.email]?.unsub ? `unsubscribe + trash ${num(row.trashIds.length)}` : `trash ${num(row.trashIds.length)}${why}`;
    return { ...state, marks, armed: null, flash: on ? `Selected ${row.email}: ${what}` : `Unselected ${row.email}` };
  }
  const marks = toggleMark(state.marks, row.email, kind);
  const on = Boolean(marks[row.email]?.[kind]);
  const what = { trash: `trash ${num(row.trashIds.length)}`, unsub: 'unsubscribe', filter: 'filter' }[kind];
  return { ...state, marks, armed: null, flash: on ? `Marked ${row.email}: ${what}` : `Unmarked ${row.email}: ${what}` };
}

const plural = (n, word) => `${num(n)} ${word}${n === 1 ? '' : 's'}`;

/** D (and :D :U :F): mark every eligible sender in the current view for one kind. */
function bulk(state, kind) {
  const rows = visibleRows(state);
  if (!rows.length) return { ...state, flash: 'No senders in this view.' };
  const r = bulkMark(rows, state.marks, kind);
  const skipped = [];
  if (r.protectedSkipped) skipped.push(`${num(r.protectedSkipped)} protected`);
  if (r.otherSkipped) skipped.push(`${num(r.otherSkipped)} without a link or done`);
  const tail = skipped.length ? ` (${skipped.join(', ')} skipped)` : '';
  if (!r.senders) return { ...state, flash: `Nothing to mark here${tail}.` };
  const what = { trash: `trash ${plural(r.emails, 'email')}`, unsub: 'unsubscribe', filter: 'filter' }[kind];
  const verb = r.on ? 'Marked' : 'Unmarked';
  const flash = `${verb} ${plural(r.senders, 'sender')} → ${what}${tail}`;
  // Narrow screens: "366 marked: trash 18,757, 63 protected kept"
  const shortWhat = { trash: `trash ${num(r.emails)}`, unsub: 'unsub', filter: 'filter' }[kind];
  const short = `${num(r.senders)} ${verb.toLowerCase()}: ${shortWhat}${r.protectedSkipped ? `, ${num(r.protectedSkipped)} protected kept` : ''}`;
  return { ...state, marks: r.marks, flash, flashShort: { for: flash, text: short } };
}

/** A: select every unprotected sender in the view for cleanup. */
function selectAll(state) {
  const rows = visibleRows(state);
  if (!rows.length) return { ...state, flash: 'No senders in this view.' };
  const r = bulkCleanup(rows, state.marks);
  const tail = r.protectedSkipped ? ` (${num(r.protectedSkipped)} protected skipped)` : '';
  if (!r.senders) return { ...state, flash: `Nothing to select here${tail}.` };
  if (!r.on) {
    const flash = `Unselected ${plural(r.senders, 'sender')}${tail}`;
    return { ...state, marks: r.marks, flash, flashShort: { for: flash, text: `${num(r.senders)} unselected` } };
  }
  const flash = `Selected ${plural(r.senders, 'sender')} for cleanup → trash ${plural(r.emails, 'email')} · unsubscribe ${num(r.unsubs)}${tail}`;
  // Narrow screens: "366 selected: trash 18,757 · unsub 300, 63 protected kept"
  const short = `${num(r.senders)} selected: trash ${num(r.emails)} · unsub ${num(r.unsubs)}${r.protectedSkipped ? `, ${num(r.protectedSkipped)} protected kept` : ''}`;
  // Narrower still: drop unsubscribe, then the email count
  const kept = r.protectedSkipped ? `, ${num(r.protectedSkipped)} protected kept` : '';
  const shorter = [`${num(r.senders)} selected: trash ${num(r.emails)}${kept}`, `${num(r.senders)} selected${kept}`];
  return { ...state, marks: r.marks, flash, flashShort: { for: flash, text: short, shorter } };
}

/** P: toggle the current sender in protected.txt and re-apply protection. */
function protect(state) {
  const row = currentRow(state);
  if (!row) return { state };
  const { text, protected: on } = toggleProtectText(state.protectText, row.email, row.builtinProtect);
  const rows = applyProtection(state.rows, text);
  // Protecting drops its marks: a protected sender is never in a bulk plan
  const marks = on ? clearMarks(state.marks, row.email) : state.marks;
  const dropped = on && state.marks[row.email] ? ' Its marks were cleared.' : '';
  const now = rows.find((r) => r.email === row.email);
  const flash = on
    ? `Protected ${row.email}.${dropped}`
    : now?.protectReason ? `${row.email} is still protected (${now.protectReason}).` : `Unprotected ${row.email}: now ${now?.verdict ?? row.baseVerdict}.`;
  const next = { ...state, rows, marks, protectText: text, armed: null, flash };
  const total = visibleRows(next).length;
  return { state: { ...next, cursor: Math.min(next.cursor, Math.max(0, total - 1)) }, effect: 'save-protect' };
}

// ── Settings ────────────────────────────────────────────────────────────────

function openSettings(state) {
  return { ...state, mode: 'settings', settingsDraft: mergeSettings(state.settings), settingsCursor: 0, scroll: 0, flash: '', armed: null };
}

const sameProtect = (a, b) => {
  const pa = protectSettings(a);
  const pb = protectSettings(b);
  return Object.keys(pa).every((k) => pa[k] === pb[k]);
};

/**
 * Leave the settings screen: re-run the rules so verdicts update now, drop
 * marks on senders that just became protected, and ask the app to save.
 */
export function closeSettings(state) {
  const draft = state.settingsDraft ?? state.settings;
  const base = { ...state, mode: 'normal', settingsDraft: null, scroll: 0 };
  if (sameProtect(draft, state.settings)) return { state: { ...base, flash: 'Settings unchanged.' } };

  const rows = recomputeProtection(state.rows, state.protectText, { own: state.own, settings: draft });
  const was = new Map(state.rows.map((r) => [r.email, Boolean(r.protectReason)]));
  let nowProtected = 0;
  let nowUnprotected = 0;
  let cleared = 0;
  const marks = { ...state.marks };
  for (const r of rows) {
    const before = was.get(r.email);
    const after = Boolean(r.protectReason);
    if (after && !before) {
      nowProtected++;
      if (marks[r.email]) { delete marks[r.email]; cleared++; }
    } else if (before && !after) nowUnprotected++;
  }
  const tail = cleared ? ` (${plural(cleared, 'mark')} cleared)` : '';
  const flash = `Settings saved: ${plural(nowProtected, 'sender')} now protected, ${num(nowUnprotected)} unprotected${tail}`;
  const short = `Saved: +${num(nowProtected)} protected, -${num(nowUnprotected)}${cleared ? `, ${num(cleared)} marks cleared` : ''}`;
  const next = { ...base, rows, marks, settings: mergeSettings(draft), flash, flashShort: { for: flash, text: short } };
  const total = visibleRows(next).length;
  return { state: { ...next, cursor: Math.min(next.cursor, Math.max(0, total - 1)) }, effect: 'save-settings' };
}

function settingsKeys(state, input, key) {
  const draft = state.settingsDraft ?? mergeSettings(state.settings);
  const n = SETTING_ITEMS.length;
  if (key.escape || input === 'q' || input === ',' || input === 's' || input === 'S') return closeSettings(state);
  if (input === 'j' || key.downArrow) return { state: { ...state, settingsCursor: Math.min(n - 1, state.settingsCursor + 1), flash: '' } };
  if (input === 'k' || key.upArrow) return { state: { ...state, settingsCursor: Math.max(0, state.settingsCursor - 1), flash: '' } };
  if (input === 'g') return { state: { ...state, settingsCursor: 0 } };
  if (input === 'G') return { state: { ...state, settingsCursor: n - 1 } };
  if (input === ' ' || key.return) {
    const item = SETTING_ITEMS[state.settingsCursor];
    const protect = { ...draft.protect, [item.key]: !draft.protect[item.key] };
    const note = item.key === 'financeMarketing' && !protect.finance ? ' (finance is off, so this has no effect)' : '';
    return { state: { ...state, settingsDraft: { ...draft, protect }, flash: note ? `finance marketing ${protect.financeMarketing ? 'on' : 'off'}${note}` : '' } };
  }
  if (input === '+' || input === '=' || input === '-' || input === '_') {
    const [lo, hi] = OPENED_MIN_RANGE;
    const step = input === '+' || input === '=' ? OPENED_STEP : -OPENED_STEP;
    const min = Math.max(lo, Math.min(hi, draft.protect.openedMin + step));
    if (min === draft.protect.openedMin) {
      return { state: { ...state, flash: `Opened threshold stays between ${lo}% and ${hi}%.` } };
    }
    return { state: { ...state, settingsDraft: { ...draft, protect: { ...draft.protect, openedMin: min } }, flash: '' } };
  }
  return { state };
}

/**
 * @param {UiState} state
 * @param {{input: string, key: object}} ev  Ink useInput arguments
 * @param {{height: number, wide: boolean}} ctx  list height and layout
 * @returns {{state: UiState, effect?: 'quit'|'apply'|'rescan'|'reload'}}
 */
export function reduce(state, { input = '', key = {} }, ctx) {
  if (key.ctrl && input === 'c') {
    // First Ctrl-C while applying stops after the current batch; work done is kept
    if (state.mode === 'applying' && !state.cancelling) {
      return { state: { ...state, cancelling: true }, effect: 'cancel' };
    }
    return { state, effect: 'quit' };
  }

  switch (state.mode) {
    case 'applying':
      return { state };

    case 'result':
      if (input === 'q') return { state, effect: 'quit' };
      if (input === 'j' || key.downArrow) return { state: { ...state, scroll: state.scroll + 1 } };
      if (input === 'k' || key.upArrow) return { state: { ...state, scroll: Math.max(0, state.scroll - 1) } };
      return { state: { ...state, mode: 'normal', result: null, scroll: 0 }, effect: 'reload' };

    case 'settings':
      return settingsKeys(state, input, key);

    case 'help':
      if (input === 'j' || key.downArrow) return { state: { ...state, scroll: state.scroll + 1 } };
      if (input === 'k' || key.upArrow) return { state: { ...state, scroll: Math.max(0, state.scroll - 1) } };
      if (key.pageDown) return { state: { ...state, scroll: state.scroll + ctx.height } };
      if (key.pageUp) return { state: { ...state, scroll: Math.max(0, state.scroll - ctx.height) } };
      return { state: { ...state, mode: 'normal', scroll: 0 } };

    case 'confirm': {
      // Enter or y: yes. Anything else (Esc, n): no
      if (input === 'y' || input === 'Y' || key.return) {
        return { state: { ...state, mode: 'normal', confirm: null }, effect: state.confirm };
      }
      return { state: { ...state, mode: 'normal', confirm: null, flash: 'Kept your marks.' } };
    }

    case 'review':
      // One stage at a time: Enter (y) does it, S skips it, Esc (n, q) stops here
      if (input === 'y' || input === 'Y' || key.return) return { state: { ...state, mode: 'applying', scroll: 0 }, effect: 'apply' };
      if (input === 's' || input === 'S') {
        const kind = currentStage(state);
        return { state: nextStage({ ...state, stageResults: { ...state.stageResults, [kind]: { skipped: true } } }) };
      }
      if (input === 'n' || input === 'N' || input === 'q' || key.escape) return { state: finishStages(state) };
      if (input === 'j' || key.downArrow) return { state: { ...state, scroll: state.scroll + 1 } };
      if (input === 'k' || key.upArrow) return { state: { ...state, scroll: Math.max(0, state.scroll - 1) } };
      if (key.ctrl && input === 'd') return { state: { ...state, scroll: state.scroll + Math.floor(ctx.height / 2) } };
      if (key.ctrl && input === 'u') return { state: { ...state, scroll: Math.max(0, state.scroll - Math.floor(ctx.height / 2)) } };
      return { state };

    case 'filter':
      if (key.escape) return { state: resetCursor({ ...state, mode: 'normal', filterText: '', filterDraft: '', flash: '' }) };
      if (key.return) return { state: resetCursor({ ...state, mode: 'normal', filterText: state.filterDraft.trim() }) };
      if (isBack(key)) {
        if (!state.filterDraft) return { state: { ...state, mode: 'normal', filterText: '' } };
        return { state: resetCursor({ ...state, filterDraft: [...state.filterDraft].slice(0, -1).join('') }) };
      }
      if (key.upArrow || key.downArrow) {
        const s = { ...state };
        return { state: moveTo(s, s.cursor + (key.downArrow ? 1 : -1), ctx) };
      }
      if (printable(input, key)) return { state: resetCursor({ ...state, filterDraft: state.filterDraft + input }) };
      return { state };

    case 'command':
      if (key.escape) return { state: { ...state, mode: 'normal', command: '' } };
      if (key.return) return runCommand(state, state.command);
      if (isBack(key)) {
        if (!state.command) return { state: { ...state, mode: 'normal' } };
        return { state: { ...state, command: state.command.slice(0, -1) } };
      }
      if (printable(input, key)) return { state: { ...state, command: state.command + input } };
      return { state };

    default:
      return normal(state, input, key, ctx);
  }
}

/*
 * Normal mode. Familiar keys first (shown on screen), Vim keys as aliases:
 *   ↑ ↓ PgUp PgDn Home End (j k gg G Ctrl-d Ctrl-u)   move
 *   Space        select for cleanup: unsubscribe + trash
 *   A            select every unprotected sender in view for cleanup
 *   Delete (d)   trash · U (u) unsubscribe · F (f) filter · x X clear
 *   R (w :w)     review and apply · Enter → (Tab l) details on narrow
 *   / search · V (v, Tab) verdict view · S (, :set) settings · P (p) protect
 *   Ctrl-R (:scan) rescan · ? help · Esc back · q quit
 *   D            mark every sender in view for trash (:U :F for unsubscribe, filter)
 */
function normal(state, input, key, ctx) {
  const mk = markKey(input, key);
  // A protected sender's second press must come right after the first
  if (state.armed && !mk) state = { ...state, armed: null };
  const total = visibleRows(state).length;
  const half = Math.max(1, Math.floor(ctx.height / 2));

  if (state.pendingG) {
    state = { ...state, pendingG: false };
    if (input === 'g') return { state: moveTo(state, 0, ctx) };
  }

  if (key.ctrl) {
    if (input === 'd') return { state: moveTo(state, state.cursor + half, ctx) };
    if (input === 'u') return { state: moveTo(state, state.cursor - half, ctx) };
    if (input === 'f') return { state: moveTo(state, state.cursor + ctx.height, ctx) };
    if (input === 'b') return { state: moveTo(state, state.cursor - ctx.height, ctx) };
    if (input === 'r') return askOrDo(state, 'rescan');
    return { state };
  }

  if (input === 'j' || key.downArrow) return { state: moveTo(state, state.cursor + 1, ctx) };
  if (input === 'k' || key.upArrow) return { state: moveTo(state, state.cursor - 1, ctx) };
  if (key.pageDown) return { state: moveTo(state, state.cursor + ctx.height, ctx) };
  if (key.pageUp) return { state: moveTo(state, state.cursor - ctx.height, ctx) };
  if (key.home) return { state: moveTo(state, 0, ctx) };
  if (key.end) return { state: moveTo(state, total - 1, ctx) };
  if (input === 'g') return { state: { ...state, pendingG: true } };
  if (input === 'G') return { state: moveTo(state, total - 1, ctx) };

  // Narrow layout: Enter/→ (Tab, l) open the detail pane, Esc/←/Enter (Tab, h) close it
  if (!ctx.wide) {
    if (state.detail && (key.escape || key.return || key.tab || key.leftArrow || input === 'h')) {
      return { state: { ...state, detail: false, flash: '' } };
    }
    if (!state.detail && (key.return || (key.tab && !key.shift) || key.rightArrow || input === 'l')) {
      return { state: total ? { ...state, detail: true, flash: '' } : state };
    }
  }

  if ((key.tab && ctx.wide) || input === 'v' || input === 'V') {
    return { state: resetCursor({ ...state, verdictFilter: nextVerdictFilter(state.verdictFilter, key.tab && key.shift ? -1 : 1), flash: '' }) };
  }
  if (key.tab && key.shift) {
    return { state: resetCursor({ ...state, verdictFilter: nextVerdictFilter(state.verdictFilter, -1), flash: '' }) };
  }

  if (key.escape) {
    if (state.filterText) return { state: resetCursor({ ...state, filterText: '', flash: '' }) };
    return { state: { ...state, flash: '' } };
  }

  if (mk) return { state: toggle(state, mk.kind, mk.label) };

  switch (input) {
    case '/':
      return { state: { ...state, mode: 'filter', filterDraft: state.filterText, flash: '' } };
    case ':':
      return { state: { ...state, mode: 'command', command: '', flash: '' } };
    case 'a':
    case 'A':
      return { state: selectAll(state) };
    case 'D':
      return { state: bulk(state, 'trash') };
    case 'p':
    case 'P':
      return protect(state);
    case 'x': {
      const row = currentRow(state);
      if (!row || !state.marks[row.email]) return { state };
      return { state: { ...state, marks: clearMarks(state.marks, row.email), flash: `Cleared marks on ${row.email}` } };
    }
    case 'X': {
      const n = Object.keys(state.marks).length;
      return { state: { ...state, marks: {}, flash: n ? `Cleared marks on ${n} sender${n === 1 ? '' : 's'}` : 'Nothing marked.' } };
    }
    case 'r':
    case 'R':
    case 'w':
      return { state: openReview(state) };
    case 'q':
      return askOrDo(state, 'quit');
    case 's':
    case 'S':
    case ',':
      return { state: openSettings(state) };
    case '?':
      return { state: { ...state, mode: 'help', scroll: 0, flash: '' } };
    default:
      return { state };
  }
}
