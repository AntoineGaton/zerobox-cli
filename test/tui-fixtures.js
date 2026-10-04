// Small synthetic scan cache shared by the full-screen UI tests.
const DAY = 86_400_000;
const NOW = Date.parse('2026-10-01T12:00:00Z');

function msg(id, from, { labels = ['INBOX', 'UNREAD'], days = 1, unsub, post, thread } = {}) {
  const headers = [
    { name: 'From', value: from },
    { name: 'Date', value: new Date(NOW - days * DAY).toUTCString() },
  ];
  if (unsub) headers.push({ name: 'List-Unsubscribe', value: unsub });
  if (post) headers.push({ name: 'List-Unsubscribe-Post', value: 'List-Unsubscribe=One-Click' });
  return { id, threadId: thread ?? `t-${id}`, labelIds: labels, payload: { headers } };
}

/**
 * @param {{starred?: boolean}} [opts]  starred: d0 is starred (which protects
 *   deals@shop.example unless protected.txt says `!deals@shop.example`)
 */
export function fixtureCache({ starred = false } = {}) {
  const inboxMessages = [];
  // 12 deals: Nuke, one-click http unsubscribe, 3 opened (d0 optionally starred)
  for (let i = 0; i < 12; i++) {
    const labels = i === 0 && starred ? ['INBOX', 'STARRED'] : i < 3 ? ['INBOX'] : ['INBOX', 'UNREAD'];
    inboxMessages.push(msg(`d${i}`, 'Deals <deals@shop.example>', { labels, days: i + 1, unsub: '<https://shop.example/u>', post: true }));
  }
  // 7 news: Review, mailto unsubscribe
  for (let i = 0; i < 7; i++) {
    inboxMessages.push(msg(`n${i}`, 'News <news@saas.example>', { days: 10 + i, unsub: '<mailto:unsub@saas.example?subject=stop>' }));
  }
  // 3 bank alerts: Keep, no unsubscribe; all opened, so protected
  for (let i = 0; i < 3; i++) {
    inboxMessages.push(msg(`b${i}`, 'Bank <alerts@bank.example>', { labels: ['INBOX'], days: 100 + i }));
  }
  return { timestamp: new Date(NOW - 2 * 3_600_000).toISOString(), complete: true, inboxMessages, sentThreadIds: [] };
}

export { NOW };
