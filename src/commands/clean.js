/**
 * @module commands/clean
 * Interactive bulk-delete for high-volume senders.
 * Shows a multi-select checkbox list, confirms before deleting,
 * and writes a structured log to cleanup-log.json.
 */

import fs from 'fs/promises';
import path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import cliProgress from 'cli-progress';
import { authorize } from '../auth.js';
import { batchDeleteMessages, trashMessages } from '../gmail.js';
import { analyzeSenders, truncate } from '../analyzer.js';
import { success, hint, c } from '../ui.js';
import { appendLog, loadProtectText, loadUserSettings, pruneCacheMessages } from '../actions.js';
import { protectedSenders } from '../tui/model.js';

import { CACHE_PATH as CACHE_FILE, LOG_PATH as LOG_FILE } from '../paths.js';

// ---------------------------------------------------------------------------
// Prompt helpers
// ---------------------------------------------------------------------------

/**
 * Build an Inquirer checkbox choice label for a sender.
 * @param {import('../analyzer.js').SenderStats} s
 * @returns {string}
 */
function choiceLabel(s) {
  const email = truncate(s.email, 38).padEnd(38);
  const count = String(s.count).padStart(5);
  const reply = `${s.replyPct}%`.padStart(6);
  return `${s.verdict.emoji} ${email} ${count} emails  replied: ${reply}`;
}

// ---------------------------------------------------------------------------
// Main command
// ---------------------------------------------------------------------------

/**
 * Run the interactive clean command.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.dryRun=false] - show what would happen without deleting
 * @param {boolean} [opts.permanent=false] - bypass Trash and delete permanently (cannot be undone)
 * @param {number} [opts.top=50] - max candidates to show in the selector
 */
export async function runClean(opts = {}) {
  const spinner = ora({ color: 'cyan' });

  // ── Load scan cache ───────────────────────────────────────────────────────
  let cache;
  try {
    cache = JSON.parse(await fs.readFile(CACHE_FILE, 'utf8'));
  } catch {
    console.error(chalk.red('\n❌ No scan cache found. Run `zerobox scan` first.\n'));
    throw new Error('No scan cache found. Run a scan first.');
  }

  if (!cache.inboxMessages?.length) {
    console.error(chalk.red('\n❌ Scan cache is empty. Run `zerobox scan` first.\n'));
    throw new Error('Scan cache is empty. Run a scan first.');
  }

  // ── Analyze ───────────────────────────────────────────────────────────────
  spinner.start('Loading scan results…');
  const senders = analyzeSenders(cache.inboxMessages, new Set(cache.sentThreadIds ?? []));
  spinner.succeed(`Loaded ${senders.length.toLocaleString()} senders`);

  // Protected senders (banks, account security, starred, replied…) are listed but never pre-checked
  const protectedBy = protectedSenders(cache, await loadProtectText(), loadUserSettings());

  const candidates = senders
    .filter((s) => s.verdict.label === 'Nuke' || s.verdict.label === 'Review')
    .slice(0, opts.top ?? 50);

  if (!candidates.length) {
    console.log(chalk.green('\n✅ No Nuke/Review candidates found. Your inbox is clean!\n'));
    return;
  }

  // ── Sender selector ───────────────────────────────────────────────────────
  console.log('');
  console.log(chalk.bold(`  ${candidates.length} candidates (Space to toggle, A to select all, Enter to confirm):\n`));

  const choices = candidates.map((s) => {
    const reason = protectedBy.get(s.email);
    return {
      name: choiceLabel(s) + (reason ? chalk.blue(`  [protected: ${reason}]`) : ''),
      value: s.email,
      checked: s.verdict.label === 'Nuke' && !reason, // pre-check unprotected Nuke candidates
    };
  });

  const { selected } = await inquirer.prompt([
    {
      type: 'checkbox',
      name: 'selected',
      message: 'Select senders to delete:',
      choices,
      pageSize: 20,
      loop: false,
    },
  ]);

  if (!selected.length) {
    console.log(chalk.yellow('\n  Nothing selected. Exiting.\n'));
    return;
  }

  // ── Gather message IDs ────────────────────────────────────────────────────
  const senderMap = new Map(senders.map((s) => [s.email, s]));
  const toDelete = [];
  const selectedSenders = [];

  // Never touch starred mail, even from a selected sender
  const starredIds = new Set(
    cache.inboxMessages.filter((m) => m.labelIds?.includes('STARRED')).map((m) => m.id)
  );
  let skippedStarred = 0;

  for (const email of selected) {
    const sender = senderMap.get(email);
    if (!sender) continue;
    for (const id of sender.messageIds) {
      if (starredIds.has(id)) skippedStarred++;
      else toDelete.push(id);
    }
    selectedSenders.push(sender);
  }

  // ── Deletion summary ──────────────────────────────────────────────────────
  const trash = !opts.permanent;
  const action = trash ? 'Move to Trash' : 'Permanently delete';
  const actionPast = trash ? 'Trashed' : 'Deleted';

  console.log('');
  console.log(chalk.bold('  Deletion plan:'));
  for (const s of selectedSenders) {
    const bar = s.verdict.emoji;
    console.log(`  ${bar} ${s.email.padEnd(40)} ${s.count.toLocaleString()} emails`);
  }
  console.log('');
  console.log(`  ${chalk.bold('Total:')} ${toDelete.length.toLocaleString()} emails from ${selected.length} senders`);
  if (skippedStarred) hint(`${skippedStarred.toLocaleString()} starred emails will be kept`);
  console.log('');

  if (!toDelete.length) {
    console.log(chalk.yellow('  Nothing to remove — every selected email is starred.\n'));
    return;
  }

  if (opts.dryRun) {
    console.log(chalk.cyan(`  [DRY RUN] ${action} ${toDelete.length.toLocaleString()} emails. No changes made.\n`));
    return;
  }

  // ── Final confirmation ────────────────────────────────────────────────────
  const warnColor = trash ? chalk.yellow : chalk.red;

  const { confirmed } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirmed',
      message: warnColor(
        `⚠️  ${action} ${toDelete.length.toLocaleString()} emails from ${selected.length} senders?` +
        (trash ? ' (recoverable from Trash for 30 days)' : ' THIS CANNOT BE UNDONE.')
      ),
      default: false,
    },
  ]);

  if (!confirmed) {
    console.log(chalk.yellow('\n  Cancelled. No emails deleted.\n'));
    return;
  }

  // ── Authenticate ──────────────────────────────────────────────────────────
  const auth = await authorize(spinner);

  // ── Progress bar ──────────────────────────────────────────────────────────
  const bar = new cliProgress.SingleBar(
    {
      format: `  ${chalk.cyan('{bar}')} {percentage}% | {value}/{total} | ETA: {eta_formatted}`,
      barCompleteChar: '█',
      barIncompleteChar: '░',
      hideCursor: true,
      clearOnComplete: false,
    },
    cliProgress.Presets.shades_classic
  );

  console.log('');
  bar.start(toDelete.length, 0);

  const startTime = Date.now();

  try {
    const result = trash
      ? await trashMessages(auth, toDelete, (done) => bar.update(done))
      : await batchDeleteMessages(auth, toDelete, (done) => bar.update(done));
    const doneIds = trash ? result.trashedIds : result.deletedIds;

    bar.stop();

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log('');
    success(`${actionPast} ${doneIds.length.toLocaleString()} emails in ${elapsed}s`);
    if (result.failedIds.length) {
      console.log(chalk.yellow(`  ⚠️  ${result.failedIds.length.toLocaleString()} emails could not be moved and are still in your inbox. Run clean again to retry.`));
    }

    // ── Write cleanup log ─────────────────────────────────────────────────
    const run = {
      timestamp: new Date().toISOString(),
      action: trash ? 'trash' : 'delete',
      senders: selectedSenders.map((s) => ({
        email: s.email,
        count: s.count,
        verdict: s.verdict.label,
      })),
      totalEmails: doneIds.length,
      failedEmails: result.failedIds.length,
      durationSeconds: parseFloat(elapsed),
    };
    await appendLog(run);
    hint(`Run logged to ${LOG_FILE}`);

    // ── Prune cache ───────────────────────────────────────────────────────
    await pruneCacheMessages(new Set(doneIds));
    hint('Cache updated.\n');

  } catch (err) {
    bar.stop();
    console.log('');
    console.error(chalk.red(`\n  ❌ Deletion failed: ${err.message}\n`));
    throw err;
  }
}
