import { test } from 'node:test';
import assert from 'node:assert/strict';
import { combineResults, currentStage, initialState, reduce, currentRow, stageDone, visibleRows } from '../src/tui/keys.js';
import { buildRows } from '../src/tui/model.js';
import { fixtureCache } from './tui-fixtures.js';

const WIDE = { height: 10, wide: true };
const NARROW = { height: 10, wide: false };
const k = (input, key = {}) => ({ input, key });

/** Feed a sequence of events, returning the final state and the effects seen. */
function press(state, events, ctx = WIDE) {
  const effects = [];
  for (const ev of events) {
    const r = reduce(state, typeof ev === 'string' ? k(ev) : ev, ctx);
    state = r.state;
    if (r.effect) effects.push(r.effect);
  }
  return { state, effects };
}

const fresh = () => initialState(buildRows(fixtureCache()));

test('j/k and arrows move, gg and G jump, Ctrl-d/u page', () => {
  let { state } = press(fresh(), ['j', k('', { downArrow: true })]);
  assert.equal(state.cursor, 2);
  ({ state } = press(state, ['j'])); // clamps at the end
  assert.equal(state.cursor, 2);
  ({ state } = press(state, ['k', k('', { upArrow: true })]));
  assert.equal(state.cursor, 0);
  ({ state } = press(state, ['G']));
  assert.equal(state.cursor, 2);
  ({ state } = press(state, ['g', 'g']));
  assert.equal(state.cursor, 0);
  ({ state } = press(state, [k('d', { ctrl: true })]));
  assert.equal(state.cursor, 2);
  ({ state } = press(state, [k('u', { ctrl: true })]));
  assert.equal(state.cursor, 0);
});

test('d, u, f (Vim aliases) toggle marks; x and X clear them', () => {
  let { state } = press(fresh(), ['d', 'u', 'f']);
  assert.deepEqual(state.marks['deals@shop.example'], { trash: true, unsub: true, filter: true });
  ({ state } = press(state, ['d']));
  assert.deepEqual(state.marks['deals@shop.example'], { unsub: true, filter: true });
  ({ state } = press(state, ['x']));
  assert.equal(state.marks['deals@shop.example'], undefined);
  ({ state } = press(state, ['d', 'j', 'd', 'X']));
  assert.deepEqual(state.marks, {});
});

test('u on a sender without an unsubscribe link flashes instead of marking', () => {
  const { state } = press(fresh(), ['G', 'u']);
  assert.equal(currentRow(state).email, 'alerts@bank.example');
  assert.equal(state.marks['alerts@bank.example'], undefined);
  assert.match(state.flash, /No unsubscribe link/);
});

test('/ filters live, Enter keeps, Esc clears', () => {
  let { state } = press(fresh(), ['/', 'b', 'a', 'n']);
  assert.equal(state.mode, 'filter');
  assert.equal(visibleRows(state).length, 1);
  ({ state } = press(state, [k('', { return: true })]));
  assert.equal(state.mode, 'normal');
  assert.equal(state.filterText, 'ban');
  assert.equal(visibleRows(state).length, 1);
  ({ state } = press(state, ['/', k('', { escape: true })]));
  assert.equal(state.filterText, '');
  assert.equal(visibleRows(state).length, 3);
  // Backspace edits the draft
  ({ state } = press(state, ['/', 'x', 'y', k('', { backspace: true })]));
  assert.equal(state.filterDraft, 'x');
});

test('Tab cycles the verdict filter on wide screens', () => {
  let { state } = press(fresh(), [k('', { tab: true })]);
  assert.equal(state.verdictFilter, 'Nuke');
  ({ state } = press(state, [k('', { tab: true }), k('', { tab: true })]));
  assert.equal(state.verdictFilter, 'Keep');
  assert.equal(visibleRows(state).length, 1);
  ({ state } = press(state, ['v']));
  assert.equal(state.verdictFilter, 'Protect');
  ({ state } = press(state, ['v']));
  assert.equal(state.verdictFilter, 'All');
});

test('narrow: Enter or Tab opens details, Esc returns, v still cycles verdicts', () => {
  let { state } = press(fresh(), [k('', { return: true })], NARROW);
  assert.equal(state.detail, true);
  ({ state } = press(state, [k('', { escape: true })], NARROW));
  assert.equal(state.detail, false);
  ({ state } = press(state, [k('', { tab: true })], NARROW));
  assert.equal(state.detail, true);
  ({ state } = press(state, [k('', { tab: true }), 'v'], NARROW));
  assert.equal(state.detail, false);
  assert.equal(state.verdictFilter, 'Nuke');
});

test(':w and w open review only when something is marked; y applies, Esc cancels', () => {
  let { state, effects } = press(fresh(), ['w']);
  assert.equal(state.mode, 'normal');
  assert.match(state.flash, /Nothing selected yet\. Press Space/);
  ({ state, effects } = press(state, ['d', ':', 'w', k('', { return: true })]));
  assert.equal(state.mode, 'review');
  assert.deepEqual(effects, []);
  ({ state, effects } = press(state, [k('', { escape: true })]));
  assert.equal(state.mode, 'normal');
  assert.ok(state.marks['deals@shop.example']);
  assert.deepEqual(effects, []);
  ({ state, effects } = press(state, ['w', 'y']));
  assert.equal(state.mode, 'applying');
  assert.deepEqual(effects, ['apply']);
  // Keys are ignored while applying
  ({ state, effects } = press(state, ['q', 'd']));
  assert.equal(state.mode, 'applying');
  assert.deepEqual(effects, []);
});

test('q quits at once without marks, asks once with marks', () => {
  assert.deepEqual(press(fresh(), ['q']).effects, ['quit']);
  assert.deepEqual(press(fresh(), [':', 'q', k('', { return: true })]).effects, ['quit']);
  let { state, effects } = press(fresh(), ['d', 'q']);
  assert.equal(state.mode, 'confirm');
  assert.deepEqual(effects, []);
  ({ state, effects } = press(state, ['n']));
  assert.equal(state.mode, 'normal');
  assert.deepEqual(effects, []);
  ({ effects } = press(state, ['q', 'y']));
  assert.deepEqual(effects, ['quit']);
  assert.deepEqual(press(fresh(), ['d', ':', 'q', '!', k('', { return: true })]).effects, ['quit']);
});

test('Ctrl-R and :scan ask for a rescan, ? opens help, unknown commands flash', () => {
  assert.deepEqual(press(fresh(), [k('r', { ctrl: true })]).effects, ['rescan']);
  assert.deepEqual(press(fresh(), [':', ...'scan', k('', { return: true })]).effects, ['rescan']);
  assert.equal(press(fresh(), ['d', k('r', { ctrl: true })]).state.mode, 'confirm', 'asks when marks exist');
  assert.deepEqual(press(fresh(), ['s']).effects, [], 's opens settings now, not a rescan');
  assert.equal(press(fresh(), ['?']).state.mode, 'help');
  assert.equal(press(fresh(), ['?', 'z']).state.mode, 'normal');
  assert.match(press(fresh(), [':', 'z', 'z', k('', { return: true })]).state.flash, /Not a command/);
});

test('result screen returns to the list with a reload', () => {
  const state = { ...fresh(), mode: 'result', result: { seconds: 1 } };
  const r = reduce(state, k('a'), WIDE);
  assert.equal(r.state.mode, 'normal');
  assert.equal(r.effect, 'reload');
});

test('Ctrl-C always quits', () => {
  assert.deepEqual(press({ ...fresh(), mode: 'review' }, [k('c', { ctrl: true })]).effects, ['quit']);
});

// ── Bulk marks and protection ───────────────────────────────────────────────

test('D marks trash on every unprotected sender in the view and reports counts', () => {
  // All view: deals (12) and news (7); the bank is protected
  let { state } = press(fresh(), ['D']);
  assert.deepEqual(Object.keys(state.marks).sort(), ['deals@shop.example', 'news@saas.example']);
  assert.equal(state.flash, 'Marked 2 senders → trash 19 emails (1 protected skipped)');
  // Pressing D again with everything marked unmarks the view
  ({ state } = press(state, ['D']));
  assert.deepEqual(state.marks, {});
  assert.match(state.flash, /^Unmarked 2 senders/);
});

test('bulk marks respect the verdict filter and the / text filter', () => {
  // Nuke view: only deals
  let { state } = press(fresh(), [k('', { tab: true }), 'D']);
  assert.equal(state.verdictFilter, 'Nuke');
  assert.deepEqual(Object.keys(state.marks), ['deals@shop.example']);
  assert.equal(state.flash, 'Marked 1 sender → trash 12 emails');
  // Text filter: only news
  ({ state } = press(fresh(), ['/', 'n', 'e', 'w', 's', k('', { return: true }), 'D', 'F']));
  assert.deepEqual(state.marks, { 'news@saas.example': { trash: true, filter: true } });
  // Keep view holds only the protected bank: nothing to mark
  ({ state } = press(fresh(), ['v', 'v', 'v', 'D']));
  assert.equal(state.verdictFilter, 'Keep');
  assert.deepEqual(state.marks, {});
  assert.equal(state.flash, 'Nothing to mark here (1 protected skipped).');
});

test(':U skips senders without a method and ones already unsubscribed', () => {
  const rows = buildRows(fixtureCache(), { 'news@saas.example': { done: true } });
  const { state } = press(initialState(rows), [':', 'U', k('', { return: true })]);
  assert.deepEqual(state.marks, { 'deals@shop.example': { unsub: true } });
  assert.equal(state.flash, 'Marked 1 sender → unsubscribe (1 protected, 1 without a link or done skipped)');
});

test('d on a protected sender needs a second press; moving away disarms it', () => {
  // Bank is last (protected)
  let { state } = press(fresh(), ['G', 'd']);
  assert.equal(currentRow(state).email, 'alerts@bank.example');
  assert.deepEqual(state.marks, {});
  assert.match(state.flash, /is protected \(opened 100%\)\. Press d again/);
  ({ state } = press(state, ['d']));
  assert.deepEqual(state.marks, { 'alerts@bank.example': { trash: true } });
  // Unmarking needs no confirmation
  ({ state } = press(state, ['d']));
  assert.deepEqual(state.marks, {});
  // d, move, come back, d: asks again
  ({ state } = press(state, ['d', 'k', 'j', 'd']));
  assert.deepEqual(state.marks, {});
  assert.match(state.flash, /Press d again/);
});

test('p toggles protection, saves protected.txt and re-sorts rows', () => {
  let { state, effects } = press(fresh(), ['d', 'p']);
  assert.deepEqual(effects, ['save-protect']);
  assert.equal(state.protectText, 'deals@shop.example\n');
  const deals = state.rows.find((r) => r.email === 'deals@shop.example');
  assert.equal(deals.verdict, 'Protect');
  assert.equal(deals.protectReason, 'your list');
  assert.deepEqual(state.marks, {}, 'protecting clears its marks');
  assert.match(state.flash, /Protected deals@shop\.example\. Its marks were cleared/);
  // Still listed in the Nuke view (at the end), and D skips it
  ({ state } = press(state, ['v', 'D']));
  assert.equal(visibleRows(state).length, 1);
  assert.match(state.flash, /Nothing to mark here \(1 protected skipped\)/);
  // p again unprotects
  ({ state, effects } = press(state, ['p']));
  assert.deepEqual(effects, ['save-protect']);
  assert.equal(state.protectText, '');
  assert.equal(state.rows.find((r) => r.email === 'deals@shop.example').verdict, 'Nuke');
  // A built-in protection is lifted with an exception line
  ({ state } = press(fresh(), ['G', 'p']));
  assert.equal(state.protectText, '!alerts@bank.example\n');
  assert.match(state.flash, /Unprotected alerts@bank\.example: now Keep/);
});

test('Ctrl-C while applying asks to stop once, then quits', () => {
  let { state, effects } = press({ ...fresh(), mode: 'applying' }, [k('c', { ctrl: true })]);
  assert.deepEqual(effects, ['cancel']);
  assert.equal(state.cancelling, true);
  assert.equal(state.mode, 'applying');
  ({ effects } = press(state, [k('c', { ctrl: true })]));
  assert.deepEqual(effects, ['quit']);
});

// ── Staged review: unsubscribe, filters, trash ──────────────────────────────

const unsubOk = { unsub: { oneClick: 1, sent: 1, failed: [], links: [], opened: false, notSent: [] }, seconds: 2 };
const filterOk = { filter: { created: 1, existed: 0, failed: [] }, seconds: 1 };
const trashOk = { trash: { trashed: 19, failed: 0, starredSkipped: 0 }, seconds: 1, logPath: '/tmp/log.json' };

/** Marks: deals trash+unsub, news unsub+filter+trash. */
function staged() {
  return press(fresh(), ['d', 'u', 'j', 'd', 'u', 'f', 'w']).state;
}

test('review opens on the unsubscribe stage, then filters, then trash', () => {
  const state = staged();
  assert.equal(state.mode, 'review');
  assert.deepEqual(state.stages, ['unsub', 'filter', 'trash']);
  assert.equal(currentStage(state), 'unsub');
  // Only marked kinds become stages
  const onlyTrash = press(fresh(), ['d', 'w']).state;
  assert.deepEqual(onlyTrash.stages, ['trash']);
});

test('y applies only the current stage; stageDone moves to the next review', () => {
  let { state, effects } = press(staged(), ['y']);
  assert.equal(state.mode, 'applying');
  assert.deepEqual(effects, ['apply']);
  assert.equal(currentStage(state), 'unsub');
  state = stageDone(state, 'unsub', unsubOk);
  assert.equal(state.mode, 'review');
  assert.equal(currentStage(state), 'filter');
  assert.deepEqual(state.stageResults.unsub, unsubOk);
  // Marks stay until the whole review ends, so later stages still see them
  assert.ok(state.marks['news@saas.example'].filter);
});

test('s skips a stage; the last stage ends on a combined result, dropping only applied marks', () => {
  let state = stageDone(press(staged(), ['y']).state, 'unsub', unsubOk);
  ({ state } = press(state, ['s']));
  assert.equal(currentStage(state), 'trash');
  assert.deepEqual(state.stageResults.filter, { skipped: true });
  ({ state } = press(state, ['y']));
  state = stageDone(state, 'trash', trashOk);
  assert.equal(state.mode, 'result');
  assert.deepEqual(state.result.stages.map((s) => [s.kind, s.status]), [['unsub', 'done'], ['filter', 'skipped'], ['trash', 'done']]);
  assert.equal(state.result.seconds, 3);
  assert.deepEqual(state.result.trash, trashOk.trash);
  assert.equal(state.result.filter, null);
  // Skipped filter mark kept, applied unsub/trash marks dropped
  assert.deepEqual(state.marks, { 'news@saas.example': { filter: true } });
});

test('Esc stops the remaining stages', () => {
  // Before anything ran: back to the list, marks kept
  let { state } = press(staged(), [k('', { escape: true })]);
  assert.equal(state.mode, 'normal');
  assert.match(state.flash, /Nothing changed/);
  assert.equal(Object.keys(state.marks).length, 2);
  // After the first stage: result screen; filters and trash not run
  state = stageDone(press(staged(), ['y']).state, 'unsub', unsubOk);
  ({ state } = press(state, [k('', { escape: true })]));
  assert.equal(state.mode, 'result');
  assert.deepEqual(state.result.stages.map((s) => s.status), ['done', 'not run', 'not run']);
  assert.deepEqual(state.marks['news@saas.example'], { trash: true, filter: true });
  assert.deepEqual(state.marks['deals@shop.example'], { trash: true });
});

test('an error or a Ctrl-C stop ends the review after that stage', () => {
  let state = stageDone(press(staged(), ['y']).state, 'unsub', { error: 'ZeroBox is not signed in.', seconds: 0 });
  assert.equal(state.mode, 'result');
  assert.equal(state.result.error, 'ZeroBox is not signed in.');
  assert.equal(state.result.stages[0].status, 'failed');
  assert.ok(state.marks['deals@shop.example'].unsub, 'nothing was sent, so unsubscribe marks stay');
  state = stageDone(press(staged(), ['y']).state, 'unsub', { ...unsubOk, stopped: true });
  assert.equal(state.mode, 'result');
  assert.deepEqual(state.result.stages.map((s) => s.status), ['stopped', 'not run', 'not run']);
});

test('combineResults lists every stage in order', () => {
  const r = combineResults(['unsub', 'trash'], { unsub: { skipped: true }, trash: trashOk });
  assert.deepEqual(r.stages, [{ kind: 'unsub', status: 'skipped' }, { kind: 'trash', status: 'done', seconds: 1 }]);
  assert.equal(r.logPath, '/tmp/log.json');
});

// ── Settings ────────────────────────────────────────────────────────────────

test(', and :set / :settings open the settings screen', () => {
  assert.equal(press(fresh(), [',']).state.mode, 'settings');
  assert.equal(press(fresh(), [':', 's', 'e', 't', k('', { return: true })]).state.mode, 'settings');
  assert.equal(press(fresh(), [':', ...'settings', k('', { return: true })]).state.mode, 'settings');
});

test('settings: j k move within the list, space and Enter toggle the draft only', () => {
  let { state } = press(fresh(), [',', 'k']);
  assert.equal(state.settingsCursor, 0);
  ({ state } = press(state, ['G', 'j']));
  assert.equal(state.settingsCursor, 7);
  ({ state } = press(state, ['g', ' ']));
  assert.equal(state.settingsDraft.protect.replied, false);
  assert.equal(state.settings.protect.replied, true, 'saved settings change only on close');
  ({ state } = press(state, [k('', { return: true })]));
  assert.equal(state.settingsDraft.protect.replied, true);
});

test('settings: + and - move openedMin by 5 between 10 and 100', () => {
  let { state } = press(fresh(), [',', '+', '=']);
  assert.equal(state.settingsDraft.protect.openedMin, 50);
  ({ state } = press(state, Array(30).fill('+')));
  assert.equal(state.settingsDraft.protect.openedMin, 100);
  assert.match(state.flash, /between 10% and 100%/);
  ({ state } = press(state, Array(30).fill('-')));
  assert.equal(state.settingsDraft.protect.openedMin, 10);
});

test('settings: closing unchanged saves nothing', () => {
  const { state, effects } = press(fresh(), [',', ' ', ' ', 'q']);
  assert.equal(state.mode, 'normal');
  assert.deepEqual(effects, []);
  assert.equal(state.flash, 'Settings unchanged.');
});

test('settings: close recomputes verdicts, saves, and drops marks on newly protected senders', () => {
  // deals is opened 25%: lowering the threshold to 25% protects it
  let { state } = press(fresh(), ['d', 'j', 'd']);
  assert.ok(state.marks['deals@shop.example'] && state.marks['news@saas.example']);
  assert.equal(state.rows.find((r) => r.email === 'deals@shop.example').verdict, 'Nuke');
  let effects;
  ({ state, effects } = press(state, [',', '-', '-', '-', k('', { escape: true })]));
  assert.deepEqual(effects, ['save-settings']);
  assert.equal(state.mode, 'normal');
  assert.equal(state.settings.protect.openedMin, 25);
  const deals = state.rows.find((r) => r.email === 'deals@shop.example');
  assert.equal(deals.verdict, 'Protect');
  assert.equal(deals.protectReason, 'opened 25%');
  assert.equal(state.marks['deals@shop.example'], undefined, 'marks on a newly protected sender are dropped');
  assert.ok(state.marks['news@saas.example'], 'other marks are kept');
  assert.equal(state.flash, 'Settings saved: 1 sender now protected, 0 unprotected (1 mark cleared)');
  assert.equal(state.flashShort.text, 'Saved: +1 protected, -0, 1 marks cleared');
});

test('settings: switching rules off unprotects at once; protected.txt still wins', () => {
  // The bank is protected by opened (100%) and by the finance word rule
  let { state } = press(fresh(), [',', 'j', ' ', 'j', 'j', 'j', ' ', 'q']);
  assert.equal(state.settings.protect.opened, false);
  assert.equal(state.settings.protect.finance, false);
  let bank = state.rows.find((r) => r.email === 'alerts@bank.example');
  assert.equal(bank.protectReason, null);
  assert.equal(bank.verdict, bank.baseVerdict);
  assert.match(state.flash, /0 senders now protected, 1 unprotected/);
  // With protected.txt listing it, it stays protected
  state = initialState(buildRows(fixtureCache(), {}, { protectText: 'alerts@bank.example\n' }), {}, 'alerts@bank.example\n');
  ({ state } = press(state, [',', 'j', ' ', 'j', 'j', 'j', ' ', 'q']));
  bank = state.rows.find((r) => r.email === 'alerts@bank.example');
  assert.equal(bank.protectReason, 'your list');
});

// ── Familiar keys ───────────────────────────────────────────────────────────

const ESC = k('', { escape: true });
const ENTER = k('', { return: true });
const DEL = k('', { delete: true });

test('PageUp/PageDown and Home/End move', () => {
  const ctx = { height: 1, wide: true };
  let { state } = press(fresh(), [k('', { pageDown: true })], ctx);
  assert.equal(state.cursor, 1);
  ({ state } = press(state, [k('', { end: true })], ctx));
  assert.equal(state.cursor, 2);
  ({ state } = press(state, [k('', { pageUp: true })], ctx));
  assert.equal(state.cursor, 1);
  ({ state } = press(state, [k('', { home: true })], ctx));
  assert.equal(state.cursor, 0);
});

test('Space selects for cleanup: unsubscribe + trash; a second Space unselects', () => {
  let { state } = press(fresh(), [' ']);
  assert.deepEqual(state.marks['deals@shop.example'], { trash: true, unsub: true });
  assert.equal(state.flash, 'Selected deals@shop.example: unsubscribe + trash 12');
  // A filter mark survives unselecting
  ({ state } = press(state, ['F', ' ']));
  assert.deepEqual(state.marks['deals@shop.example'], { filter: true });
  assert.equal(state.flash, 'Unselected deals@shop.example');
  // Trash only already set: Space completes the cleanup instead of unselecting
  ({ state } = press(fresh(), [DEL, ' ']));
  assert.deepEqual(state.marks['deals@shop.example'], { trash: true, unsub: true });
});

test('Space on a sender already unsubscribed selects trash only', () => {
  const rows = buildRows(fixtureCache(), { 'deals@shop.example': { done: true } });
  const { state } = press(initialState(rows), [' ']);
  assert.deepEqual(state.marks['deals@shop.example'], { trash: true });
  assert.match(state.flash, /trash 12 \(already unsubscribed\)/);
});

test('Delete and Backspace trash only; U and F act on one sender', () => {
  let { state } = press(fresh(), [DEL]);
  assert.deepEqual(state.marks, { 'deals@shop.example': { trash: true } });
  ({ state } = press(state, [k('', { backspace: true })]));
  assert.deepEqual(state.marks, {});
  ({ state } = press(fresh(), ['U', 'F']));
  assert.deepEqual(state.marks, { 'deals@shop.example': { unsub: true, filter: true } });
  ({ state } = press(state, ['u', 'f']));
  assert.deepEqual(state.marks, {});
});

test('protected senders need a second press of Space, Delete, U or F', () => {
  // The bank is last and protected; it has no unsubscribe link, so Space selects trash only
  let { state } = press(fresh(), ['G', ' ']);
  assert.deepEqual(state.marks, {});
  assert.match(state.flash, /is protected \(opened 100%\)\. Press Space again to select it anyway, or P to unprotect/);
  ({ state } = press(state, [' ']));
  assert.deepEqual(state.marks, { 'alerts@bank.example': { trash: true } });
  assert.match(state.flash, /no unsubscribe link/);
  ({ state } = press(fresh(), ['G', DEL]));
  assert.match(state.flash, /Press Delete again to trash it/);
  ({ state } = press(state, [DEL]));
  assert.deepEqual(state.marks, { 'alerts@bank.example': { trash: true } });
  // F asks, a different key in between disarms it
  ({ state } = press(fresh(), ['G', 'F', 'k', 'j', 'F']));
  assert.deepEqual(state.marks, {});
  assert.match(state.flash, /Press F again/);
  ({ state } = press(state, ['F']));
  assert.deepEqual(state.marks, { 'alerts@bank.example': { filter: true } });
});

test('A selects every unprotected sender in view for cleanup; again unselects', () => {
  let { state } = press(fresh(), ['A']);
  assert.deepEqual(state.marks, {
    'deals@shop.example': { trash: true, unsub: true },
    'news@saas.example': { trash: true, unsub: true },
  });
  assert.equal(state.flash, 'Selected 2 senders for cleanup → trash 19 emails · unsubscribe 2 (1 protected skipped)');
  assert.equal(state.flashShort.text, '2 selected: trash 19 · unsub 2, 1 protected kept');
  ({ state } = press(state, ['a']));
  assert.deepEqual(state.marks, {});
  assert.equal(state.flash, 'Unselected 2 senders (1 protected skipped)');
});

test('A respects the verdict view, the search and past unsubscribes', () => {
  // Nuke view: only deals
  let { state } = press(fresh(), ['V', 'A']);
  assert.equal(state.verdictFilter, 'Nuke');
  assert.deepEqual(Object.keys(state.marks), ['deals@shop.example']);
  // Search: only news
  ({ state } = press(fresh(), ['/', ...'news', ENTER, 'A']));
  assert.deepEqual(Object.keys(state.marks), ['news@saas.example']);
  // Keep view holds only the protected bank
  ({ state } = press(fresh(), ['v', 'v', 'v', 'A']));
  assert.deepEqual(state.marks, {});
  assert.equal(state.flash, 'Nothing to select here (1 protected skipped).');
  // Already unsubscribed: trash only, like U skips them
  const rows = buildRows(fixtureCache(), { 'news@saas.example': { done: true } });
  ({ state } = press(initialState(rows), ['A']));
  assert.deepEqual(state.marks['news@saas.example'], { trash: true });
  assert.match(state.flash, /unsubscribe 1 /);
});

test('D and :D :F still mark every sender in view for one kind', () => {
  let { state } = press(fresh(), ['D']);
  assert.deepEqual(Object.keys(state.marks).sort(), ['deals@shop.example', 'news@saas.example']);
  ({ state } = press(fresh(), [':', 'F', ENTER]));
  assert.deepEqual(state.marks, { 'deals@shop.example': { filter: true }, 'news@saas.example': { filter: true } });
  ({ state } = press(state, [':', 'D', ENTER]));
  assert.equal(state.marks['news@saas.example'].trash, true);
});

test('R, r, w and :w open the review', () => {
  for (const keys of [['R'], ['r'], ['w'], [':', 'w', ENTER]]) {
    const { state } = press(fresh(), [' ', ...keys]);
    assert.equal(state.mode, 'review', keys.join(''));
  }
  // Enter does not review: on wide screens it does nothing, on narrow ones it opens details
  assert.equal(press(fresh(), [' ', ENTER]).state.mode, 'normal');
  assert.equal(press(fresh(), [' ', ENTER], NARROW).state.detail, true);
});

test('review steps: Enter does it, S skips, Esc stops; y, s and n still work', () => {
  let { state, effects } = press(staged(), [ENTER]);
  assert.deepEqual(effects, ['apply']);
  assert.equal(state.mode, 'applying');
  ({ state } = press(staged(), ['S']));
  assert.equal(currentStage(state), 'filter');
  assert.deepEqual(state.stageResults.unsub, { skipped: true });
  ({ state } = press(state, ['s']));
  assert.equal(currentStage(state), 'trash');
  ({ state } = press(state, [ESC]));
  assert.equal(state.mode, 'normal');
  assert.match(state.flash, /Nothing changed/);
  assert.deepEqual(press(staged(), ['y']).effects, ['apply']);
  assert.equal(press(staged(), ['n']).state.mode, 'normal');
});

test('quit confirm: Enter yes, Esc no', () => {
  let { state, effects } = press(fresh(), [' ', 'q', ESC]);
  assert.equal(state.mode, 'normal');
  assert.deepEqual(effects, []);
  ({ effects } = press(state, ['q', ENTER]));
  assert.deepEqual(effects, ['quit']);
});

test('S, s and , open settings, and S closes them; P and V upper case work', () => {
  for (const key of ['S', 's', ',']) assert.equal(press(fresh(), [key]).state.mode, 'settings', key);
  assert.equal(press(fresh(), ['S', 'S']).state.mode, 'normal');
  const { state, effects } = press(fresh(), ['P']);
  assert.deepEqual(effects, ['save-protect']);
  assert.equal(state.protectText, 'deals@shop.example\n');
  assert.equal(press(fresh(), ['V', 'V']).state.verdictFilter, 'Review');
});

test('narrow: → opens details and ← or Esc closes them', () => {
  let { state } = press(fresh(), [k('', { rightArrow: true })], NARROW);
  assert.equal(state.detail, true);
  ({ state } = press(state, [k('', { leftArrow: true })], NARROW));
  assert.equal(state.detail, false);
});
