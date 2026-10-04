/**
 * @module commands/scan
 * Fetches the inbox, analyzes senders, and displays a ranked table.
 * Supports resumable scans via the scan cache in ZEROBOX_HOME.
 */

import fs from 'fs/promises';
import path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import Table from 'cli-table3';
import { authorize } from '../auth.js';
import { listMessages, batchGetMetadata, getUserEmail, getLabelMessageCount } from '../gmail.js';
import { analyzeSenders, formatAgeDays, truncate } from '../analyzer.js';
import { header, hint, c } from '../ui.js';

import { CACHE_PATH as CACHE_FILE } from '../paths.js';

// ---------------------------------------------------------------------------
// Cache helpers
// ---------------------------------------------------------------------------

/**
 * @typedef {object} ScanCache
 * @property {string} timestamp - ISO timestamp of the scan
 * @property {boolean} complete - true if scan ran to completion
 * @property {object[]} inboxMessages - fetched Gmail message resources
 * @property {string[]} sentThreadIds - thread IDs from the user's Sent folder
 */

/** @returns {Promise<ScanCache|null>} */
async function loadCache() {
  try {
    return JSON.parse(await fs.readFile(CACHE_FILE, 'utf8'));
  } catch {
    return null;
  }
}

/** @param {ScanCache} data */
async function saveCache(data) {
  await fs.writeFile(CACHE_FILE, JSON.stringify(data, null, 2));
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

/**
 * Print the sender analysis as a colour-coded CLI table.
 * @param {import('../analyzer.js').SenderStats[]} senders
 * @param {number} [maxRows=60]
 */
function displayTable(senders, maxRows = 60) {
  const hidden = Math.max(0, senders.length - maxRows);
  const rows = senders.slice(0, maxRows);

  const table = new Table({
    head: [
      chalk.bold.white('Sender'),
      chalk.bold.white('Emails'),
      chalk.bold.white('Replied%'),
      chalk.bold.white('Oldest'),
      chalk.bold.white('Unsub?'),
      chalk.bold.white('Verdict'),
    ],
    style: { head: [], border: ['dim'] },
    colWidths: [38, 9, 11, 9, 8, 12],
    wordWrap: false,
  });

  for (const s of rows) {
    const replyColor =
      s.replyPct < 5 ? chalk.red : s.replyPct < 20 ? chalk.yellow : chalk.green;

    table.push([
      truncate(s.email, 36),
      s.count.toLocaleString(),
      replyColor(`${s.replyPct}%`),
      formatAgeDays(s.ageDays),
      s.hasUnsubscribe ? chalk.green('Yes') : chalk.dim('No'),
      `${s.verdict.emoji} ${s.verdict.label}`,
    ]);
  }

  console.log('');
  console.log(chalk.bold(`  Top ${rows.length} Senders by Volume`));
  console.log(table.toString());
  if (hidden > 0) {
    hint(`...and ${hidden.toLocaleString()} more senders not shown — run \`zerobox clean\` to see all`);
  }
}

// ---------------------------------------------------------------------------
// Main command
// ---------------------------------------------------------------------------

/**
 * Run the inbox scan command.
 *
 * Steps:
 *  1. Authenticate
 *  2. Resume or start a fresh paginated inbox fetch
 *  3. Fetch sent message thread IDs (for reply detection)
 *  4. Batch-fetch message metadata
 *  5. Analyze and display results
 *
 * @param {object} [opts]
 * @param {boolean} [opts.fresh=false] - ignore existing cache
 * @param {number} [opts.limit] - override SCAN_LIMIT env var
 * @param {boolean} [opts.json=false] - output raw JSON instead of table
 * @returns {Promise<import('../analyzer.js').SenderStats[]>}
 */
export async function runScan(opts = {}) {
  const spinner = ora({ color: 'cyan' });
  const rawLimit = opts.limit ?? parseInt(process.env.SCAN_LIMIT ?? '0', 10);
  // Max messages to fetch this run; 0 (the default) means the whole inbox.
  // Progress is saved as it goes, so a stopped scan resumes where it left off.
  const limit = rawLimit === 0 ? Infinity : rawLimit;

  // ── 1. Auth ───────────────────────────────────────────────────────────────
  const auth = await authorize(spinner);

  const userEmail = await getUserEmail(auth);
  console.log(chalk.dim(`  Signed in as: ${userEmail}\n`));

  // ── 2. Check cache ────────────────────────────────────────────────────────
  let existingMessages = [];
  let sentThreadIds = new Set();

  const cache = opts.fresh ? null : await loadCache();

  if (cache?.complete) {
    const ageHours = Math.round((Date.now() - new Date(cache.timestamp).getTime()) / 3_600_000);
    console.log(chalk.dim(`  Using cached scan from ${ageHours}h ago. Pass --fresh to rescan.\n`));
    existingMessages = cache.inboxMessages ?? [];
    sentThreadIds = new Set(cache.sentThreadIds ?? []);

    // Skip straight to analysis
    spinner.start('Analyzing senders…');
    const senders = analyzeSenders(existingMessages, sentThreadIds);
    spinner.succeed(`Analyzed ${senders.length.toLocaleString()} unique senders`);

    if (opts.json) {
      console.log(JSON.stringify(senders, null, 2));
    } else {
      displayTable(senders);
      printSummary(senders, existingMessages.length);
    }
    return senders;
  }

  if (cache && !cache.complete) {
    const loaded = cache.inboxMessages?.length ?? 0;
    console.log(chalk.yellow(`  Resuming interrupted scan (${loaded.toLocaleString()} messages already loaded)…\n`));
    existingMessages = cache.inboxMessages ?? [];
    sentThreadIds = new Set(cache.sentThreadIds ?? []);
  }

  // ── 3. List every inbox message ID ───────────────────────────────────────
  // IDs only, 500 per call, so even a 25k inbox lists in seconds. Listing the
  // whole inbox each run (instead of resuming a page token) means a resumed
  // scan always knows exactly which messages are still missing.
  spinner.start('Listing inbox…');
  const { messages: inboxIds } = await listMessages(auth, 'in:inbox', {
    maxResults: Infinity,
    onProgress: (n, est) => {
      spinner.text = `Listing inbox: ${n.toLocaleString()} / ~${(est ?? '?').toLocaleString()}`;
    },
  });
  spinner.succeed(`Inbox has ${inboxIds.length.toLocaleString()} messages`);

  // Drop cached messages that have since left the inbox
  const inInbox = new Set(inboxIds.map((m) => m.id));
  existingMessages = existingMessages.filter((m) => inInbox.has(m.id));

  // ── 4. Fetch sent thread IDs (once) ──────────────────────────────────────
  if (sentThreadIds.size === 0) {
    spinner.start('Fetching sent messages for reply detection…');
    const { messages: sentIds } = await listMessages(auth, 'in:sent', {
      maxResults: 10_000,
      onProgress: (n) => { spinner.text = `Fetching sent: ${n.toLocaleString()}`; },
    });
    sentThreadIds = new Set(sentIds.map((m) => m.threadId));
    spinner.succeed(`Found ${sentIds.length.toLocaleString()} sent messages (${sentThreadIds.size.toLocaleString()} unique threads)`);
  }

  // ── 5. Fetch metadata for messages not cached yet ────────────────────────
  const alreadyHave = new Set(existingMessages.map((m) => m.id));
  const missing = inboxIds.filter((m) => !alreadyHave.has(m.id));
  const toFetch = isFinite(limit) ? missing.slice(0, limit) : missing;
  const threadIdMap = new Map(inboxIds.map((m) => [m.id, m.threadId]));
  let fetchFailures = 0;

  const persist = (complete) => saveCache({
    timestamp: new Date().toISOString(),
    complete,
    // Lets the UI show the account and protect the user's own address
    account: userEmail,
    inboxMessages: existingMessages,
    sentThreadIds: [...sentThreadIds],
  });

  if (toFetch.length > 0) {
    const etaMin = Math.ceil(toFetch.length / 30 / 60);
    spinner.start(`Fetching metadata for ${toFetch.length.toLocaleString()} messages (~${etaMin} min)…`);

    // Checkpoint every 2,000 messages so Ctrl+C or a dropped connection
    // keeps the progress made so far
    const SLICE = 2000;
    for (let i = 0; i < toFetch.length; i += SLICE) {
      const slice = toFetch.slice(i, i + SLICE).map((m) => m.id);
      const { messages: newMetadata, failedIds } = await batchGetMetadata(auth, slice, {
        onProgress: (done) => {
          const total = toFetch.length;
          const n = i + done;
          spinner.text = `Fetching metadata: ${n.toLocaleString()} / ${total.toLocaleString()} (${Math.round((n / total) * 100)}%)`;
        },
      });
      for (const msg of newMetadata) {
        if (!msg.threadId) msg.threadId = threadIdMap.get(msg.id) ?? '';
      }
      existingMessages.push(...newMetadata);
      fetchFailures += failedIds.length;
      await persist(false);
    }

    if (fetchFailures) {
      spinner.warn(`Metadata fetched — ${existingMessages.length.toLocaleString()} messages, ${fetchFailures.toLocaleString()} failed`);
    } else {
      spinner.succeed(`Metadata fetched — ${existingMessages.length.toLocaleString()} messages total`);
    }
  }

  // ── 6. Persist cache ──────────────────────────────────────────────────────
  // Never call a scan complete while messages are missing: the next run
  // fetches only what isn't cached yet.
  const stillMissing = missing.length - toFetch.length + fetchFailures;
  await persist(stillMissing === 0);

  if (fetchFailures) {
    console.log(chalk.yellow(`\n  ⚠️  ${fetchFailures.toLocaleString()} messages could not be fetched. Run \`zerobox scan\` again to fetch just those.`));
  } else if (stillMissing > 0) {
    console.log(chalk.yellow(`\n  ⚠️  Reached scan limit (${limit.toLocaleString()}). ${stillMissing.toLocaleString()} messages left: run \`zerobox scan\` again to continue.`));
  } else {
    console.log(chalk.dim(`  Scan complete. Cache saved to ${CACHE_FILE}\n`));
  }

  // ── 7. Analyze & display ──────────────────────────────────────────────────
  spinner.start('Analyzing senders…');
  const senders = analyzeSenders(existingMessages, sentThreadIds);
  spinner.succeed(`Analyzed ${senders.length.toLocaleString()} unique senders`);

  if (opts.json) {
    console.log(JSON.stringify(senders, null, 2));
  } else {
    displayTable(senders);
    printSummary(senders, existingMessages.length);
  }

  return senders;
}

/**
 * Print a summary line below the table.
 * @param {import('../analyzer.js').SenderStats[]} senders
 * @param {number} totalMessages
 */
function printSummary(senders, totalMessages) {
  const nukeCount  = senders.filter((s) => s.verdict.label === 'Nuke').length;
  const reviewCount = senders.filter((s) => s.verdict.label === 'Review').length;
  const nukeEmails = senders
    .filter((s) => s.verdict.label === 'Nuke')
    .reduce((n, s) => n + s.count, 0);

  header('Summary');
  console.log(`  ${c.danger(`${nukeCount} to nuke`)}   — ${nukeEmails.toLocaleString()} emails`);
  console.log(`  ${c.warn(`${reviewCount} to review`)}`);
  hint(`${totalMessages.toLocaleString()} messages scanned`);
  console.log('');
}
