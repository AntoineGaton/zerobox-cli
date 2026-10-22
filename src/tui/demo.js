/**
 * @module tui/demo
 * Browser entry for the landing site's demo. It re-exports the real screen,
 * model and key code, adds a sample inbox, and fakes Gmail when a review is
 * applied. `npm run build:demo` bundles it into site/lib/tui-demo.js.
 * Nothing here touches the filesystem, the network or the terminal.
 */

import { buildPlan, buildRows, bodyHeight, layout, screenSize } from './model.js';
import { currentRow, currentStage, initialState, reduce, stageDone, visibleRows } from './keys.js';
import { renderScreen } from './view.js';

export { bodyHeight, buildPlan, currentRow, currentStage, initialState, layout, reduce, renderScreen, screenSize, stageDone, visibleRows };

const DAY = 86_400_000;

/**
 * Sample senders: name, address, emails, share opened, share replied to,
 * unsubscribe kind ('one-click', 'mailto', 'web' or null).
 */
const SENDERS = [
  ['Weekly Deals', 'deals@shop.example', 1204, 0.02, 0, 'one-click'],
  ['Social Updates', 'notify@social.example', 812, 0.04, 0, 'one-click'],
  ['Product News', 'news@saas.example', 433, 0.09, 0, 'mailto'],
  ['Travel Offers', 'offers@travel.example', 8, 0, 0, 'web'],
  ['Dev Digest', 'digest@devweekly.example', 188, 0.61, 0.25, 'mailto'],
  ['Bank Alerts', 'alerts@bank.example', 96, 1, 0, null],
  ['Recipes Weekly', 'hello@recipes.example', 9, 0.12, 0, 'one-click'],
  ['Old Forum', 'forum@club.example', 4, 0.25, 0, 'mailto'],
];

/** A scan cache shaped like the one `zerobox scan` writes, built from SENDERS. */
export function demoCache(now = Date.now()) {
  const inboxMessages = [];
  const sentThreadIds = [];
  for (const [name, email, count, opened, replied, unsub] of SENDERS) {
    const domain = email.split('@')[1];
    for (let i = 0; i < count; i++) {
      const id = `${domain}-${i}`;
      const labels = i < Math.round(count * opened) ? ['INBOX'] : ['INBOX', 'UNREAD'];
      const headers = [
        { name: 'From', value: `${name} <${email}>` },
        { name: 'Date', value: new Date(now - (1 + i * (400 / count)) * DAY).toUTCString() },
      ];
      if (unsub === 'one-click') {
        headers.push({ name: 'List-Unsubscribe', value: `<https://${domain}/unsubscribe>` });
        headers.push({ name: 'List-Unsubscribe-Post', value: 'List-Unsubscribe=One-Click' });
      } else if (unsub === 'mailto') {
        headers.push({ name: 'List-Unsubscribe', value: `<mailto:unsubscribe@${domain}?subject=unsubscribe>` });
      } else if (unsub === 'web') {
        headers.push({ name: 'List-Unsubscribe', value: `<https://${domain}/preferences>` });
      }
      if (i < Math.round(count * replied)) sentThreadIds.push(`t-${id}`);
      inboxMessages.push({ id, threadId: `t-${id}`, labelIds: labels, payload: { headers } });
    }
  }
  return { timestamp: new Date(now - 2 * 3_600_000).toISOString(), inboxMessages, sentThreadIds };
}

/** Rows and screen metadata for the demo, as the app builds them from a scan. */
export function demoData(now = Date.now()) {
  const cache = demoCache(now);
  const rows = buildRows(cache, {});
  const meta = {
    version: '0.1.0', totalEmails: cache.inboxMessages.length, senderCount: rows.length,
    scannedAt: Date.parse(cache.timestamp), complete: true, now, hasCache: true,
  };
  return { rows, meta };
}

const STAGE_LABEL = { trash: 'Moving to Trash', unsub: 'Unsubscribing', filter: 'Creating filters' };

/**
 * What one stage would do to Gmail, without Gmail: the same result shape as
 * applyPlan, where every action succeeds and web unsubscribe pages are listed.
 * @returns {{label: string, total: number, result: object}}
 */
export function fakeStage(plan, kind) {
  if (kind === 'trash') {
    return { label: STAGE_LABEL.trash, total: plan.trashEmails, result: { trash: { trashed: plan.trashEmails, failed: 0, starredSkipped: plan.starredSkipped }, seconds: 1.2 } };
  }
  if (kind === 'unsub') {
    const out = { oneClick: 0, sent: 0, failed: [], links: [], opened: false, notSent: [], sendStopped: null };
    for (const u of plan.unsub) {
      if (u.method === 'one-click') out.oneClick++;
      else if (u.method === 'email') out.sent++;
      else if (u.http) out.links.push({ email: u.email, url: u.http });
    }
    return { label: STAGE_LABEL.unsub, total: plan.unsub.length, result: { unsub: out, seconds: 1.2 } };
  }
  return { label: STAGE_LABEL.filter, total: plan.filter.length, result: { filter: { created: plan.filter.length, existed: 0, failed: [] }, seconds: 1.2 } };
}
