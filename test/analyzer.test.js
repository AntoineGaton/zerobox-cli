import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSenders, computeVerdict, parseFrom, parseUnsubscribeHeader } from '../src/analyzer.js';

const msg = (id, threadId, from = 'News <news@example.com>') => ({
  id,
  threadId,
  payload: { headers: [{ name: 'From', value: from }] },
});

test('reply rate counts each thread once and never exceeds 100%', () => {
  const messages = [msg('1', 't1'), msg('2', 't1'), msg('3', 't1'), msg('4', 't1'), msg('5', 't1'), msg('6', 't2')];
  const [sender] = analyzeSenders(messages, new Set(['t1']));
  assert.equal(sender.repliedCount, 1);
  assert.equal(sender.replyPct, 50);
});

test('verdicts follow volume and reply thresholds', () => {
  assert.equal(computeVerdict(11, 4).label, 'Nuke');
  assert.equal(computeVerdict(11, 5).label, 'Review');
  assert.equal(computeVerdict(6, 19).label, 'Review');
  assert.equal(computeVerdict(5, 0).label, 'Keep');
});

test('parseFrom handles quoted names and bare addresses', () => {
  assert.deepEqual(parseFrom('"Doe, Jane" <Jane@Example.com>'), { name: 'Doe, Jane', email: 'jane@example.com', domain: 'example.com' });
  assert.equal(parseFrom('bob@example.org').email, 'bob@example.org');
  assert.equal(parseFrom('<bob@example.org>').email, 'bob@example.org');
  assert.deepEqual(parseFrom('Jane Doe <jane@example.com>'), { name: 'Jane Doe', email: 'jane@example.com', domain: 'example.com' });
  assert.equal(parseFrom('jane@example.com <jane@example.com>').name, 'jane@example.com');
});

test('parseUnsubscribeHeader splits mailto and https links', () => {
  assert.deepEqual(
    parseUnsubscribeHeader('<mailto:unsub@example.com?subject=stop>, <https://example.com/u/1>'),
    { mailto: 'unsub@example.com?subject=stop', http: 'https://example.com/u/1' }
  );
});

test('unsubscribe links and one-click come from the most recent message', () => {
  const m = (id, date, unsub, post) => ({
    id, threadId: id,
    payload: { headers: [
      { name: 'From', value: 'news@example.com' }, { name: 'Date', value: date },
      { name: 'List-Unsubscribe', value: unsub },
      ...(post ? [{ name: 'List-Unsubscribe-Post', value: 'List-Unsubscribe=One-Click' }] : []),
    ] },
  });
  const [s] = analyzeSenders([
    m('2', 'Tue, 02 Sep 2026 10:00:00 GMT', '<https://new.example/u>', true),
    m('1', 'Mon, 01 Sep 2025 10:00:00 GMT', '<mailto:old@example.com>', false),
  ]);
  assert.deepEqual(s.unsubscribe, { mailto: null, http: 'https://new.example/u', oneClick: 'https://new.example/u' });
  const [t] = analyzeSenders([
    m('1', 'Mon, 01 Sep 2025 10:00:00 GMT', '<https://old.example/u>', true),
    m('2', 'Tue, 02 Sep 2026 10:00:00 GMT', '<mailto:new@example.com>, <https://new.example/u>', false),
  ]);
  assert.deepEqual(t.unsubscribe, { mailto: 'new@example.com', http: 'https://new.example/u', oneClick: null });
});
