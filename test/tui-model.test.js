import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPlan, buildRows, clampTop, filterRows, layout, markGlyph, nextVerdictFilter, planSummary, screenSize, toggleMark,
} from '../src/tui/model.js';
import { cut, padEnd, width, clean } from '../src/tui/text.js';
import { fixtureCache } from './tui-fixtures.js';

test('rows are sorted Nuke, Review, Keep, Protect and carry opened, starred and method', () => {
  const rows = buildRows(fixtureCache({ starred: true }), { 'news@saas.example': { done: true } }, { protectText: '!deals@shop.example' });
  assert.deepEqual(rows.map((r) => r.verdict), ['Nuke', 'Review', 'Protect']);
  const [deals, news, bank] = rows;
  assert.equal(deals.count, 12);
  assert.equal(deals.starred, 1);
  assert.equal(deals.trashIds.length, 11);
  assert.ok(!deals.trashIds.includes('d0'));
  assert.equal(Math.round(deals.openedPct), 25); // 3 of 12 have no UNREAD
  assert.equal(deals.method, 'one-click');
  assert.equal(news.method, 'email');
  assert.equal(news.unsubDone, true);
  assert.equal(bank.method, 'none');
  assert.equal(bank.openedPct, 100);
  assert.equal(bank.baseVerdict, 'Keep');
  assert.equal(bank.protectReason, 'opened 100%');
  assert.equal(deals.unsubscribe.oneClick, 'https://shop.example/u');
  // Without the exception, the starred message protects deals
  assert.equal(buildRows(fixtureCache({ starred: true }))[0].email, 'news@saas.example');
});

test('empty or missing cache gives no rows', () => {
  assert.deepEqual(buildRows(null), []);
  assert.deepEqual(buildRows({ inboxMessages: [] }), []);
});

test('filterRows matches text and verdict', () => {
  const rows = buildRows(fixtureCache());
  assert.equal(filterRows(rows, { text: 'BANK' }).length, 1);
  assert.equal(filterRows(rows, { text: 'news' })[0].email, 'news@saas.example');
  assert.equal(filterRows(rows, { verdict: 'Review' }).length, 1);
  assert.equal(filterRows(rows, { text: 'shop', verdict: 'Keep' }).length, 0);
  // The protected bank shows under Protect and under its original verdict
  assert.equal(filterRows(rows, { verdict: 'Protect' })[0].email, 'alerts@bank.example');
  assert.equal(filterRows(rows, { verdict: 'Keep' })[0].email, 'alerts@bank.example');
  assert.equal(nextVerdictFilter('All'), 'Nuke');
  assert.equal(nextVerdictFilter('Keep'), 'Protect');
  assert.equal(nextVerdictFilter('Protect'), 'All');
  assert.equal(nextVerdictFilter('All', -1), 'Protect');
});

test('marks toggle and build a plan that skips starred mail', () => {
  const rows = buildRows(fixtureCache({ starred: true }), {}, { protectText: '!deals@shop.example' });
  let marks = toggleMark({}, 'deals@shop.example', 'trash');
  marks = toggleMark(marks, 'deals@shop.example', 'unsub');
  marks = toggleMark(marks, 'news@saas.example', 'filter');
  marks = toggleMark(marks, 'alerts@bank.example', 'trash');
  marks = toggleMark(marks, 'alerts@bank.example', 'trash'); // off again
  assert.equal(marks['alerts@bank.example'], undefined);
  assert.equal(markGlyph(marks['deals@shop.example']), 'du');
  assert.equal(markGlyph(undefined), '·');

  const plan = buildPlan(rows, marks);
  assert.equal(plan.senders, 2);
  assert.equal(plan.trashEmails, 11);
  assert.equal(plan.starredSkipped, 1);
  assert.equal(plan.unsub[0].http, 'https://shop.example/u');
  assert.equal(plan.filter[0].email, 'news@saas.example');
  assert.equal(planSummary(plan), '2 marked → trash 11 · unsub 1 · filter 1');
  assert.equal(planSummary(plan, true), '2 marked · trash 11');
  assert.equal(planSummary(buildPlan(rows, {})), 'nothing marked');
});

test('screen size falls back for 0/undefined and never goes below the minimum', () => {
  assert.deepEqual(screenSize(0, 0), { cols: 80, rows: 24 });
  assert.deepEqual(screenSize(undefined, undefined), { cols: 80, rows: 24 });
  assert.deepEqual(screenSize(12, 3), { cols: 40, rows: 10 });
  assert.deepEqual(screenSize(140, 50), { cols: 140, rows: 50 });
});

test('layout is wide from 90 columns and list columns always add up', () => {
  for (const cols of [40, 45, 80, 89, 90, 120, 140, 300]) {
    const L = layout(cols);
    assert.equal(L.wide, cols >= 90);
    assert.equal(L.listW + (L.wide ? L.detailW + 1 : 0), cols);
    const used = 1 + 3 + 1 + L.senderW + 1 + L.emailsW + 1 + L.openedW + 1 + L.verdictW + 1;
    assert.equal(used, L.listW, `cols ${cols}`);
  }
});

test('clampTop keeps the cursor in view', () => {
  assert.equal(clampTop(0, 5, 10, 100), 0);
  assert.equal(clampTop(0, 12, 10, 100), 3);
  assert.equal(clampTop(20, 5, 10, 100), 5);
  assert.equal(clampTop(95, 99, 10, 100), 90);
  assert.equal(clampTop(0, 0, 10, 3), 0);
});

test('text helpers measure wide characters and strip emoji', () => {
  assert.equal(width('日本'), 4);
  assert.equal(cut('hello world', 5), 'hell…');
  assert.equal(width(padEnd('日本語テキスト', 7)), 7);
  assert.equal(clean('Sale 🔥 today\u0007'), 'Sale today');
});
