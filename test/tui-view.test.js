import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderScreen, toText, wrapLine } from '../src/tui/view.js';
import { initialState, reduce } from '../src/tui/keys.js';
import { buildRows, screenSize } from '../src/tui/model.js';
import { width } from '../src/tui/text.js';
import { fixtureCache, NOW } from './tui-fixtures.js';

// d0 is starred; protected.txt un-protects deals so the starred-skip paths show
const cache = fixtureCache({ starred: true });
const rows = buildRows(cache, {}, { protectText: '!deals@shop.example\n' });
const meta = {
  version: '9.9.9', totalEmails: cache.inboxMessages.length, senderCount: rows.length,
  scannedAt: Date.parse(cache.timestamp), complete: true, now: NOW, hasCache: true,
};

function screen(state, cols, rowsN = 24, m = meta) {
  const size = screenSize(cols, rowsN);
  const lines = renderScreen(state, size, m);
  return { lines, size, text: toText(lines) };
}

function assertFits(lines, size) {
  assert.equal(lines.length, size.rows - 1, 'one row short of the terminal so Ink never scrolls');
  for (const l of lines) assert.equal(l.reduce((n, s) => n + width(s.t), 0), size.cols);
}

test('every line is exactly the terminal width at all sizes and modes', () => {
  const states = [
    initialState(rows),
    { ...initialState(rows), marks: { 'deals@shop.example': { trash: true, unsub: true } }, mode: 'review' },
    { ...initialState(rows), mode: 'help' },
    { ...initialState(rows), detail: true },
    { ...initialState(rows), mode: 'filter', filterDraft: 'zzz' },
    { ...initialState(rows), mode: 'settings', settingsCursor: 7 },
    { ...initialState(rows), mode: 'result', result: { seconds: 2, trash: { trashed: 11, failed: 1, starredSkipped: 1 }, unsub: { sent: 1, failed: [], links: [{ email: 'deals@shop.example', url: 'https://shop.example/' + 'x'.repeat(120) }], opened: false }, filter: { created: 1, existed: 0, failed: [] }, logPath: '/tmp/log.json' } },
  ];
  for (const cols of [0, 40, 45, 80, 90, 140]) {
    for (const r of [0, 10, 24, 50]) {
      for (const s of states) {
        const { lines, size } = screen(s, cols, r);
        assertFits(lines, size);
      }
    }
  }
});

test('wide layout shows the list, the detail pane and the status line', () => {
  const { text } = screen(initialState(rows), 140);
  assert.match(text, /ZeroBox v9\.9\.9/);
  assert.match(text, /22 emails · 3 senders · scanned 2h ago/);
  assert.match(text, /SENDER.*EMAILS.*OPENED.*VERDICT.*│\s+DETAIL/);
  assert.match(text, /deals@shop\.example/);
  assert.match(text, /opened\s+25%/);
  assert.match(text, /starred\s+1/);
  assert.match(text, /unsubscribe\s+one-click link/);
  assert.match(text, /NORMAL  ↑↓ move · Space select · A select all · R review · \? help\s+1\/3$/m);
  assert.match(text, /alerts@bank\.example\s+3\s+100% Protect/);
  assert.match(text, / 1\/3\s*$/);
});

test('narrow layout is one column, details open full width', () => {
  let state = initialState(rows);
  let { text } = screen(state, 45);
  assert.doesNotMatch(text, /DETAIL/);
  assert.match(text, /deals@shop\.example\s+12\s+25% Nuke/);
  state = reduce(state, { input: '', key: { return: true } }, { height: 17, wide: false }).state;
  ({ text } = screen(state, 45));
  assert.match(text, /DETAIL/);
  assert.match(text, /replied\s+0%/);
});

test('marked rows and the status summary update', () => {
  const state = { ...initialState(rows), marks: { 'deals@shop.example': { trash: true, unsub: true }, 'news@saas.example': { filter: true } } };
  const { text } = screen(state, 140);
  assert.match(text, /du\s+Deals/);
  assert.match(text, /2 marked → trash 11 · unsub 1 · filter 1/);
});

test('review says starred mail is skipped and trash is recoverable', () => {
  const state = { ...initialState(rows), marks: { 'deals@shop.example': { trash: true } }, mode: 'review' };
  for (const cols of [45, 140]) {
    const text = screen(state, cols, 30).text.replace(/\n +/g, ' ');
    assert.match(text, /TRASH\s+11 emails from 1 sender/);
    assert.match(text, /1 starred email is skipped/);
    assert.match(text, /recoverable in Gmail for 30 days/);
    assert.match(text, /REVIEW/);
  }
});

test('result screen keeps long unsubscribe URLs whole by wrapping them', () => {
  const url = 'https://shop.example/unsubscribe?token=' + 'a'.repeat(90);
  const state = { ...initialState(rows), mode: 'result', result: { seconds: 1, unsub: { sent: 0, failed: [], links: [{ email: 'deals@shop.example', url }], opened: false } } };
  const { text } = screen(state, 45, 40);
  assert.ok(text.replace(/\n\s*/g, '').includes(url));
});

test('empty state explains how to scan', () => {
  const { lines, size, text } = screen(initialState([]), 45, 24, { version: '1', hasCache: false });
  assertFits(lines, size);
  assert.match(text, /No scan yet/);
  assert.match(text, /zerobox scan/);
});

test('first run without a Google client offers the guided setup', () => {
  for (const cols of [45, 120]) {
    const { lines, size, text } = screen(initialState([]), cols, 24, { version: '1', hasCache: false, needsSetup: true, home: '/tmp/zb' });
    assertFits(lines, size);
    const flat = text.replace(/\n\s*/g, ' ');
    assert.match(flat, /connect it to Gmail/);
    assert.match(flat, /Or run zerobox setup/);
    assert.ok(!text.includes('…'), 'nothing is cut off');
    assert.match(text, /Enter setup · q quit/);
  }
});

test('wrapLine splits words and long tokens under the original indent', () => {
  const out = wrapLine([{ t: '    ' }, { t: 'one two three four five six' }], 14);
  assert.deepEqual(out.map((l) => l.map((s) => s.t).join('')), ['    one two ', '    three ', '    four five ', '    six']);
  const long = wrapLine([{ t: '  ' }, { t: 'x'.repeat(25) }], 12);
  assert.deepEqual(long.map((l) => l.map((s) => s.t).join('')), ['  xxxxxxxxxx', '  xxxxxxxxxx', '  xxxxx']);
});

test('protected rows show in their verdict view with a Protect label and reason', () => {
  const plain = buildRows(fixtureCache(), {}, { protectText: 'deals@shop.example\n' });
  let state = { ...initialState(plain), verdictFilter: 'Nuke' };
  let { text, lines, size } = screen(state, 45);
  assertFits(lines, size);
  assert.match(text, /deals@shop\.example\s+12\s+25% Protect/);
  ({ text } = screen(state, 140, 30));
  assert.match(text, /protected\s+your list/);
  assert.match(text, /otherwise\s+Nuke/);
  assert.match(text, /P unprotect/);
});

test('review groups unsubscribes by method and estimates long trash runs', () => {
  const state = { ...initialState(rows), marks: { 'deals@shop.example': { trash: true, unsub: true }, 'news@saas.example': { unsub: true } }, mode: 'review' };
  const text = screen(state, 140, 40).text;
  assert.match(text, /UNSUBSCRIBE\s+2 senders: 1 one-click · 1 by email/);
  assert.match(text, /deals@shop\.example\s+one-click request/);
  assert.match(text, /news@saas\.example\s+sends an unsubscribe email/);
});

test('applying shows count, rate and ETA; stopping is visible', () => {
  const base = { ...initialState(rows), marks: { 'deals@shop.example': { trash: true } }, mode: 'applying', progress: { label: 'Moving to Trash', done: 3_000, total: 21_640, rate: 29.6, etaSeconds: 630 } };
  for (const cols of [45, 140]) {
    const { text, lines, size } = screen(base, cols);
    assertFits(lines, size);
    assert.match(text, /3,000\/21,640 · 30\/s · ETA 11 min/);
  }
  const { text } = screen({ ...base, cancelling: true }, 140);
  assert.match(text, /stopping after this batch/);
});

test('result screen reports one-click, emails, limits and a stop', () => {
  const state = { ...initialState(rows), mode: 'result', result: {
    seconds: 700, stopped: true,
    trash: { trashed: 5_000, failed: 2, starredSkipped: 0, stopped: true, notAttempted: 16_638 },
    unsub: null, filter: null, logPath: '/tmp/log.json',
  } };
  let text = screen(state, 140, 30).text;
  assert.match(text, /5,000 emails moved to Trash/);
  assert.match(text, /2 could not be moved/);
  assert.match(text, /Stopped by you: 16,638 were not attempted/);
  state.result = { seconds: 9, unsub: { oneClick: 300, sent: 4, failed: [], links: [], opened: false, notSent: ['a@x.example'], sendStopped: 'stopped at 400 unsubscribe emails this run' } };
  text = screen(state, 140, 30).text;
  assert.match(text, /300 one-click, 4 emails sent/);
  assert.match(text, /Emails stopped at 400/);
  assert.match(text, /1 not sent yet/);
});

test('staged review: unsubscribe first with a warning, then the previous result as a banner', async () => {
  const { stageDone } = await import('../src/tui/keys.js');
  const marks = { 'deals@shop.example': { trash: true, unsub: true }, 'news@saas.example': { filter: true } };
  let state = { ...initialState(rows), marks, mode: 'review', stages: ['unsub', 'filter', 'trash'], stageIndex: 0, stageResults: {} };
  for (const cols of [45, 140]) {
    const { lines, size } = screen(state, cols, 30);
    assertFits(lines, size);
  }
  let text = screen(state, 140, 30).text;
  assert.match(text, /Step 1 of 3: Unsubscribe\s+about 1s/);
  assert.match(text, /1 Unsubscribe ◂\s+2 Filters\s+3 Trash backlog/);
  assert.match(text, /Sends 1 one-click request on your behalf\. ZeroBox cannot undo this\./);
  assert.match(text, /^  Unsubscribe from 1 sender\? This sends requests from your account\.  Enter do it · S skip · Esc stop$/m);
  assert.match(text, /Esc stops here: later steps do not run/);
  assert.match(text, /REVIEW .*│ Enter do it · S skip · Esc stop/);
  assert.match(text, /REVIEW\s+step 1\/3 unsubscribe: 1 sender, about 1s/);
  assert.doesNotMatch(text, /TRASH/);
  assert.match(screen(state, 45, 30).text, /REVIEW\s+step 1\/3 unsub ~1s/);

  state = stageDone({ ...state, mode: 'applying' }, 'unsub', { unsub: { oneClick: 1, sent: 0, failed: [], links: [], opened: false, notSent: [] }, seconds: 1 });
  text = screen(state, 140, 30).text;
  assert.match(text, /Step 2 of 3: Filters/);
  assert.match(text, /Unsubscribe: 1 one-click, 0 emails sent in 1s/);
  assert.match(text, /1 Unsubscribe ✓/);

  state = { ...state, stageIndex: 2 };
  text = screen(state, 140, 30).text;
  assert.match(text, /Step 3 of 3: Trash backlog/);
  assert.match(text, /recoverable in Gmail for 30 days/);
  assert.match(text, /Move 11 emails from 1 sender to Trash\? You can restore them for 30 days\./);
  assert.doesNotMatch(text, /later steps do not run/);
});

test('result screen lists each stage with its status and time', () => {
  const state = { ...initialState(rows), mode: 'result', result: {
    seconds: 3, stages: [{ kind: 'unsub', status: 'done', seconds: 2 }, { kind: 'filter', status: 'skipped' }, { kind: 'trash', status: 'not run' }],
    unsub: { oneClick: 3, sent: 0, failed: [], links: [], opened: false, notSent: [] }, trash: null, filter: null,
  } };
  const text = screen(state, 140, 30).text;
  assert.match(text, /Unsubscribe\s+done in 2s/);
  assert.match(text, /Filters\s+skipped/);
  assert.match(text, /Trash backlog\s+not run/);
});

test('bulk mark messages have a short form for narrow screens', () => {
  const state = reduce(initialState(rows), { input: 'D', key: {} }, { height: 17, wide: false }).state;
  assert.match(screen(state, 140).text, /Marked 2 senders → trash 18 emails \(1 protected skipped\)/);
  assert.match(screen(state, 45).text, /^ 2 marked: trash 18, 1 protected kept$/m);
});

test('settings screen lists each switch with its count, at narrow and wide sizes', () => {
  let state = reduce(initialState(rows), { input: ',', key: {} }, { height: 10, wide: true }).state;
  const wide = screen(state, 120, 40).text;
  assert.match(wide, /SETTINGS/);
  assert.match(wide, /▌ \[x\] replied +senders you have replied to · protects 0 senders/);
  assert.match(wide, /\[x\] opened ≥ 40% +you open at least 40% of their mail \(\+\/- adjusts\) · protects 1 sender$/m);
  assert.match(wide, /\[x\] finance +banks, cards, payments, insurance · protects 1 sender$/m);
  assert.match(wide, /\[•\] starred +starred mail is never trashed · 1 sender/);
  assert.match(wide, /protected\.txt \(P\) wins/);
  // Narrow: count on the label line, explanation below
  const narrow = screen(state, 45, 40);
  assertFits(narrow.lines, narrow.size);
  assert.match(narrow.text, /^▌ \[x\] replied +protects 0 senders$/m);
  assert.match(narrow.text, /^ {6}senders you have replied to$/m);
  // Off switches say what they would protect; + moves the threshold live
  state = reduce(state, { input: ' ', key: {} }, { height: 10, wide: true }).state;
  state = reduce(state, { input: '-', key: {} }, { height: 10, wide: true }).state;
  const after = screen(state, 120, 40).text;
  assert.match(after, /\[ \] replied +senders you have replied to · off · would protect 0/);
  assert.match(after, /opened ≥ 35%/);
});

test('settings screen keeps the selected switch visible on short terminals', () => {
  const state = { ...initialState(rows), mode: 'settings', settingsCursor: 7 };
  const { lines, size, text } = screen(state, 45, 14);
  assertFits(lines, size);
  assert.match(text, /▌ \[x\] utilities/);
});

test('status hints use the familiar keys and shorten on narrow screens', () => {
  const state = initialState(rows);
  assert.match(screen(state, 120).text, /^ NORMAL  ↑↓ move · Space select · A select all · R review · \? help +1\/3$/m);
  // 45 columns: the shorter hint wins over the position counter
  assert.match(screen(state, 45).text, /^ NORMAL  Space select · A all · R review · \?$/m);
  // With a selection: the summary plus R review
  const marked = { ...state, marks: { 'deals@shop.example': { trash: true, unsub: true } } };
  assert.match(screen(marked, 120).text, /NORMAL  1 marked → trash 11 · unsub 1 │ R review · Space select · A all · \? help/);
  assert.match(screen(marked, 45).text, /NORMAL  1 marked · trash 11 │ R review  1\/3$/m);
  // Narrow details
  assert.match(screen({ ...state, detail: true }, 45).text, /NORMAL  Esc back · Space select · \? help/);
});

test('help lists the basics first, then the Vim power keys', () => {
  const text = screen({ ...initialState(rows), mode: 'help' }, 120, 60).text;
  const basics = text.indexOf('Basics');
  const power = text.indexOf('Power keys (Vim)');
  assert.ok(basics >= 0 && power > basics);
  assert.match(text, /Space +select this sender for cleanup: unsubscribe \+ trash/);
  assert.match(text, /Ctrl-R +rescan your inbox/);
  assert.match(text.slice(power), /d  u  f +trash, unsubscribe, filter this sender/);
  assert.match(text.slice(power), /:U  :F +mark every sender in view/);
});

test('confirm and empty state use the new keys', () => {
  const confirm = screen({ ...initialState(rows), marks: { 'deals@shop.example': { trash: true } }, mode: 'confirm', confirm: 'quit' }, 120).text;
  assert.match(confirm, /Quit and drop your marks\? Enter yes · Esc no/);
  const empty = screen(initialState([]), 120, 24, { version: '1', hasCache: false }).text;
  assert.match(empty, /press Ctrl-R to start it now/);
  assert.match(empty, /Ctrl-R scan · q quit/);
});

test('select-all message falls back to shorter forms on narrow screens', () => {
  const state = { ...initialState(rows), flash: 'Selected 366 senders for cleanup → trash 18,757 emails · unsubscribe 315 (63 protected skipped)',
    flashShort: { text: '366 selected: trash 18,757 · unsub 315, 63 protected kept', shorter: ['366 selected: trash 18,757, 63 protected kept', '366 selected, 63 protected kept'] } };
  state.flashShort.for = state.flash;
  assert.match(screen(state, 140).text, /^ Selected 366 senders for cleanup → trash 18,757 emails · unsubscribe 315 \(63 protected skipped\)$/m);
  assert.match(screen(state, 60).text, /^ 366 selected: trash 18,757 · unsub 315, 63 protected kept$/m);
  assert.match(screen(state, 45).text, /^ 366 selected, 63 protected kept$/m);
});
