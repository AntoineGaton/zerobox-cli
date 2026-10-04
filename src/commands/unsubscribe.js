/**
 * @module commands/unsubscribe
 * Automatically handles List-Unsubscribe headers:
 *   - one-click links (RFC 8058) → POSTs the unsubscribe request directly
 *   - mailto: links → sends an unsubscribe email via Gmail API
 *   - http: links   → opens in the user's browser for manual completion
 * Protected senders are listed but never pre-checked.
 * Tracks completion status in .unsubscribe-status.json.
 */

import fs from 'fs/promises';
import path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import open from 'open';
import { authorize } from '../auth.js';
import { sendEmail } from '../gmail.js';
import { analyzeSenders, truncate } from '../analyzer.js';
import { success, hint, c } from '../ui.js';
import { loadProtectText, loadUserSettings, loadUnsubStatus as loadStatus, saveUnsubStatus as saveStatus, parseMailto } from '../actions.js';
import { oneClickUnsubscribe } from '../oneclick.js';
import { protectedSenders } from '../tui/model.js';

import { CACHE_PATH as CACHE_FILE, UNSUB_STATUS_PATH as STATUS_FILE } from '../paths.js';

// ---------------------------------------------------------------------------
// Main command
// ---------------------------------------------------------------------------

/**
 * Run the unsubscribe command.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.all=false] - include senders already processed
 */
export async function runUnsubscribe(opts = {}) {
  const spinner = ora({ color: 'cyan' });

  // ── Load scan cache ───────────────────────────────────────────────────────
  let cache;
  try {
    cache = JSON.parse(await fs.readFile(CACHE_FILE, 'utf8'));
  } catch {
    console.error(chalk.red('\n❌ No scan cache found. Run `zerobox scan` first.\n'));
    throw new Error('No scan cache found. Run a scan first.');
  }

  // ── Analyze senders with unsubscribe links ────────────────────────────────
  spinner.start('Loading scan results…');
  const senders = analyzeSenders(cache.inboxMessages ?? [], new Set(cache.sentThreadIds ?? []));
  spinner.succeed('Loaded');

  const withUnsub = senders.filter((s) => s.hasUnsubscribe && s.verdict.label !== 'Keep');

  if (!withUnsub.length) {
    console.log(chalk.yellow('\n  No Nuke/Review senders with unsubscribe links found.\n'));
    console.log(chalk.dim('  Run `zerobox scan --fresh` to refresh, or check that the scan included List-Unsubscribe headers.\n'));
    return;
  }

  const status = await loadStatus();

  const pending = opts.all
    ? withUnsub
    : withUnsub.filter((s) => !status[s.email]?.done);

  const doneCount = Object.values(status).filter((v) => v.done).length;

  console.log('');
  console.log(chalk.bold(`  ${withUnsub.length} senders have unsubscribe links`));
  console.log(chalk.dim(`  ${doneCount} already unsubscribed, ${pending.length} pending`));
  console.log('');

  if (!pending.length) {
    console.log(chalk.green('  ✅ All unsubscribe links have been handled! Use --all to re-process.\n'));
    return;
  }

  // ── Sender selector ───────────────────────────────────────────────────────
  const protectedBy = protectedSenders(cache, await loadProtectText(), loadUserSettings());
  const choices = pending.slice(0, 30).map((s) => {
    const method = s.unsubscribe.oneClick ? '⚡ one-click' : s.unsubscribe.mailto ? '📧 email' : '🌐 web';
    const reason = protectedBy.get(s.email);
    return {
      name: `${s.verdict.emoji} ${truncate(s.email, 36).padEnd(36)} ${String(s.count).padStart(5)} emails  [${method}]` +
        (reason ? chalk.blue(`  [protected: ${reason}]`) : ''),
      value: s.email,
      checked: s.verdict.label === 'Nuke' && !reason,
    };
  });

  const { selected } = await inquirer.prompt([
    {
      type: 'checkbox',
      name: 'selected',
      message: 'Select senders to unsubscribe from:',
      choices,
      pageSize: 20,
      loop: false,
    },
  ]);

  if (!selected.length) {
    console.log(chalk.yellow('\n  Nothing selected.\n'));
    return;
  }

  // ── Authenticate (needed only for mailto: links) ──────────────────────────
  const needsAuth = selected.some((email) => {
    const s = senders.find((x) => x.email === email);
    return s?.unsubscribe?.mailto && !s.unsubscribe.oneClick;
  });

  let auth = null;
  if (needsAuth) {
    auth = await authorize(spinner);
  }

  const senderMap = new Map(senders.map((s) => [s.email, s]));
  console.log('');

  // ── Process each selected sender ──────────────────────────────────────────
  for (const email of selected) {
    const sender = senderMap.get(email);
    if (!sender) continue;

    console.log(chalk.bold(`  ${sender.verdict.emoji} ${sender.email}`));

    if (sender.unsubscribe.oneClick) {
      // ── RFC 8058 one-click POST ─────────────────────────────────────────
      spinner.start('Sending one-click unsubscribe…');
      const r = await oneClickUnsubscribe(sender.unsubscribe.oneClick);
      if (r.ok) {
        spinner.succeed(`Unsubscribed (HTTP ${r.status})`);
        status[email] = { done: true, method: 'one-click', url: r.url, httpStatus: r.status, timestamp: new Date().toISOString() };
        await saveStatus(status);
        console.log('');
        continue;
      }
      spinner.warn(`One-click failed (${r.error}); trying the next method`);
    }

    if (sender.unsubscribe.mailto) {
      if (!auth) {
        auth = await authorize(spinner);
      }
      // ── mailto: auto-send ───────────────────────────────────────────────
      const { to, subject, body } = parseMailto(sender.unsubscribe.mailto);
      spinner.start(`Sending unsubscribe email to ${to}…`);

      try {
        await sendEmail(auth, to, subject, body);
        spinner.succeed(`Unsubscribe email sent to ${to}`);
        status[email] = {
          done: true,
          method: 'mailto',
          to,
          subject,
          timestamp: new Date().toISOString(),
        };
      } catch (err) {
        spinner.fail(`Failed: ${err.message}`);
        status[email] = {
          done: false,
          method: 'mailto',
          error: err.message,
          timestamp: new Date().toISOString(),
        };
      }

    } else if (sender.unsubscribe.http) {
      // ── http: open in browser ───────────────────────────────────────────
      console.log(chalk.dim(`  Opening: ${sender.unsubscribe.http}`));

      try {
        await open(sender.unsubscribe.http);
      } catch {
        console.log(chalk.yellow(`  Could not open browser. Visit manually:\n  ${sender.unsubscribe.http}`));
      }

      const { confirmed } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirmed',
          message: `  Did you complete the unsubscribe for ${email}?`,
          default: true,
        },
      ]);

      status[email] = {
        done: confirmed,
        method: 'web',
        url: sender.unsubscribe.http,
        timestamp: new Date().toISOString(),
      };

      if (confirmed) {
        console.log(chalk.green(`  ✅ Marked as unsubscribed`));
      } else {
        console.log(chalk.yellow(`  ⏭  Skipped`));
      }
    }

    await saveStatus(status);
    console.log('');
  }

  // ── Final summary ─────────────────────────────────────────────────────────
  const totalDone = Object.values(status).filter((v) => v.done).length;
  success(`${totalDone} senders unsubscribed total`);
  hint(`Status saved to ${STATUS_FILE}\n`);
}
