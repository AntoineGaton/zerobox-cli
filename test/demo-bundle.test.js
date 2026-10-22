import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildDemo, OUT } from '../build-demo.mjs';
import { demoData, fakeStage, buildPlan, initialState, reduce, renderScreen, screenSize, stageDone } from '../src/tui/demo.js';
import { toText } from '../src/tui/view.js';

test('site/lib/tui-demo.js is up to date with src/ (run npm run build:demo)', async () => {
  // Windows checkouts may turn LF into CRLF; compare the code, not the line endings
  assert.equal(fs.readFileSync(OUT, 'utf8').replace(/\r\n/g, '\n'), await buildDemo(false));
});

test('the demo sample shows every verdict', () => {
  const { rows } = demoData(Date.parse('2026-10-01T12:00:00Z'));
  assert.deepEqual([...new Set(rows.map((r) => r.verdict))].sort(), ['Keep', 'Nuke', 'Protect', 'Review']);
});

test('select, review and a faked apply reach the result screen', () => {
  const now = Date.parse('2026-10-01T12:00:00Z');
  const { rows, meta } = demoData(now);
  const ctx = { height: 17, wide: true };
  let s = initialState(rows);
  for (const ev of [{ input: ' ', key: {} }, { input: 'r', key: {} }]) s = reduce(s, ev, ctx).state;
  assert.equal(s.mode, 'review');
  for (let i = 0; i < 5 && s.mode === 'review'; i++) {
    const { state, effect } = reduce(s, { input: 'y', key: {} }, ctx);
    assert.equal(effect, 'apply');
    const kind = state.stages[state.stageIndex];
    s = stageDone(state, kind, fakeStage(buildPlan(state.rows, state.marks), kind).result);
  }
  assert.equal(s.mode, 'result');
  assert.match(toText(renderScreen(s, screenSize(120, 24), { ...meta, now })), /Trash/);
});
