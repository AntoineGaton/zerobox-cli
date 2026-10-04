/**
 * @module commands/stats
 * Displays an inbox health dashboard: live count, trend, top senders,
 * cleanup history, and a rough estimate to inbox zero.
 */

import fs from 'fs/promises';
import path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import Table from 'cli-table3';
import { authorize } from '../auth.js';
import { getUserEmail, getLabelMessageCount } from '../gmail.js';
import { analyzeSenders, formatAgeDays, truncate } from '../analyzer.js';
import { divider, hint, c } from '../ui.js';

import { CACHE_PATH as CACHE_FILE, LOG_PATH as LOG_FILE, UNSUB_STATUS_PATH as UNSUB_FILE } from '../paths.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** @returns {Promise<{runs: object[]}|null>} */
async function loadLog() {
  try {
    return JSON.parse(await fs.readFile(LOG_FILE, 'utf8'));
  } catch {
    return null;
  }
}

/** @returns {Promise<object|null>} */
async function loadCache() {
  try {
    return JSON.parse(await fs.readFile(CACHE_FILE, 'utf8'));
  } catch {
    return null;
  }
}

/** @returns {Promise<object|null>} */
async function loadUnsubStatus() {
  try {
    return JSON.parse(await fs.readFile(UNSUB_FILE, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Compute average emails per day from a list of Gmail message resources.
 * @param {object[]} messages
 * @returns {number|null}
 */
function computeEmailsPerDay(messages) {
  if (!messages?.length) return null;

  let oldest = Infinity;
  for (const m of messages) {
    const h = m.payload?.headers?.find((h) => h.name === 'Date');
    if (h?.value) {
      const t = new Date(h.value).getTime();
      if (!Number.isNaN(t) && t < oldest) oldest = t;
    }
  }

  if (!isFinite(oldest)) return null;

  const daySpan = Math.max(1, (Date.now() - oldest) / 86_400_000);
  return Math.round(messages.length / daySpan);
}

// ---------------------------------------------------------------------------
// Main command
// ---------------------------------------------------------------------------

/**
 * Run the stats dashboard command.
 */
export async function runStats() {
  const spinner = ora({ color: 'cyan' });

  // ── Auth + live counts ────────────────────────────────────────────────────
  const auth = await authorize(spinner);

  const [userEmail, inboxTotal] = await Promise.all([
    getUserEmail(auth),
    getLabelMessageCount(auth, 'INBOX'),
  ]);

  // ── Load local data ───────────────────────────────────────────────────────
  const [cache, cleanupLog, unsubStatus] = await Promise.all([
    loadCache(),
    loadLog(),
    loadUnsubStatus(),
  ]);

  const senders = cache
    ? analyzeSenders(cache.inboxMessages ?? [], new Set(cache.sentThreadIds ?? []))
    : [];

  const emailsPerDay = cache ? computeEmailsPerDay(cache.inboxMessages) : null;

  const totalRuns = cleanupLog?.runs?.length ?? 0;
  const totalDeleted = (cleanupLog?.runs ?? []).reduce((n, r) => n + (r.totalEmails ?? r.totalDeleted ?? 0), 0);
  const totalUnsubbed = unsubStatus
    ? Object.values(unsubStatus).filter((v) => v.done).length
    : 0;

  // ── Inbox-zero estimate ───────────────────────────────────────────────────
  let zeroEstimate = null;
  if (totalRuns > 0 && totalDeleted > 0) {
    const avgPerRun = Math.round(totalDeleted / totalRuns);
    const runsNeeded = Math.ceil(inboxTotal / avgPerRun);
    zeroEstimate = `~${runsNeeded} more ZeroBox run${runsNeeded !== 1 ? 's' : ''} at ${avgPerRun.toLocaleString()} emails/run`;
  }

  // ── Render dashboard ──────────────────────────────────────────────────────
  console.log('');
  console.log(`  ${c.bold('◆ ZeroBox')}  ${c.muted('Inbox Dashboard')}`);
  divider();

  console.log(`  ${c.muted('account')}      ${userEmail}`);
  console.log(`  ${c.muted('inbox total')}  ${c.danger.bold(inboxTotal.toLocaleString())} messages`);
  if (emailsPerDay !== null) {
    console.log(`  ${c.muted('inflow')}       ~${emailsPerDay.toLocaleString()} emails/day`);
  }

  divider();

  if (totalRuns > 0) {
    console.log(`  ${c.muted('deleted')}      ${c.success.bold(totalDeleted.toLocaleString())} across ${totalRuns} run${totalRuns !== 1 ? 's' : ''}`);
  } else {
    hint('No emails deleted yet — run Nuke senders to start.');
  }
  if (totalUnsubbed > 0) {
    console.log(`  ${c.muted('unsubscribed')} ${c.success(totalUnsubbed.toString())} senders`);
  }
  if (zeroEstimate) {
    console.log(`  ${c.muted('to zero')}      ${zeroEstimate}`);
  }

  // ── Sender breakdown ──────────────────────────────────────────────────────
  if (senders.length > 0) {
    const nukeCount   = senders.filter((s) => s.verdict.label === 'Nuke').length;
    const reviewCount = senders.filter((s) => s.verdict.label === 'Review').length;
    const keepCount   = senders.filter((s) => s.verdict.label === 'Keep').length;
    const nukeEmails  = senders.filter((s) => s.verdict.label === 'Nuke').reduce((n, s) => n + s.count, 0);

    divider();
    console.log(`  ${c.muted('🔴 nuke')}     ${c.danger.bold(String(nukeCount).padStart(4))} senders  ${c.muted(`(${nukeEmails.toLocaleString()} emails)`)}`);
    console.log(`  ${c.muted('🟡 review')}   ${c.warn.bold(String(reviewCount).padStart(4))} senders`);
    console.log(`  ${c.muted('🟢 keep')}     ${c.success.bold(String(keepCount).padStart(4))} senders`);
    console.log('');

    const top10 = senders.slice(0, 10);
    const table = new Table({
      head: [c.bold('Top 10 Senders'), c.bold('Emails'), c.bold('Reply%'), c.bold('Verdict')],
      style: { head: [], border: ['dim'] },
      colWidths: [38, 9, 9, 12],
    });

    for (const s of top10) {
      const replyColor = s.replyPct < 5 ? chalk.red : s.replyPct < 20 ? chalk.yellow : chalk.green;
      table.push([
        truncate(s.email, 36),
        s.count.toLocaleString(),
        replyColor(`${s.replyPct}%`),
        `${s.verdict.emoji} ${s.verdict.label}`,
      ]);
    }
    console.log(table.toString());

    if (cache?.timestamp) {
      const ageHours = Math.round((Date.now() - new Date(cache.timestamp).getTime()) / 3_600_000);
      hint(`Scan data is ${ageHours}h old — choose "Scan inbox → Fresh rescan" to refresh.`);
    }
  } else {
    divider();
    hint('No scan data. Choose "Scan inbox" to analyze your inbox.');
  }

  // ── Cleanup history ───────────────────────────────────────────────────────
  if (totalRuns > 0) {
    console.log('');
    console.log(`  ${c.bold('Recent Cleanup History')}`);
    const recent = [...(cleanupLog?.runs ?? [])].reverse().slice(0, 5);
    for (const run of recent) {
      const date = new Date(run.timestamp).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric',
      });
      const emails = (run.totalEmails ?? run.totalDeleted ?? 0).toLocaleString();
      const senderCount = run.senders?.length ?? 0;
      const verb = run.action === 'trash' ? 'trashed' : 'deleted';
      console.log(`  ${c.muted(date.padEnd(14))}  ${c.success(emails)} emails ${verb} from ${senderCount} sender${senderCount !== 1 ? 's' : ''}`);
    }
  }

  console.log('');
}
