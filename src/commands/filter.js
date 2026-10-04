/**
 * @module commands/filter
 * Creates Gmail filters for selected senders so future emails
 * automatically skip the inbox (and optionally go to Trash).
 */

import fs from 'fs/promises';
import path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import { authorize } from '../auth.js';
import { createSenderFilter, listFilters } from '../gmail.js';
import { analyzeSenders, truncate } from '../analyzer.js';
import { success, hint, c } from '../ui.js';

import { CACHE_PATH as CACHE_FILE } from '../paths.js';

// ---------------------------------------------------------------------------
// Main command
// ---------------------------------------------------------------------------

/**
 * Run the filter creation command.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.nukeOnly=false] - only show 🔴 Nuke candidates
 * @param {boolean} [opts.skipTrash=false] - skip inbox only (don't also trash)
 */
export async function runFilter(opts = {}) {
  const spinner = ora({ color: 'cyan' });

  // ── Load scan cache ───────────────────────────────────────────────────────
  let cache;
  try {
    cache = JSON.parse(await fs.readFile(CACHE_FILE, 'utf8'));
  } catch {
    console.error(chalk.red('\n❌ No scan cache found. Run `zerobox scan` first.\n'));
    throw new Error('No scan cache found. Run a scan first.');
  }

  // ── Authenticate early — needed to check existing filters ─────────────────
  const auth = await authorize(spinner);

  // ── Load existing filters to avoid duplication ────────────────────────────
  spinner.start('Checking existing Gmail filters…');
  const existingFilters = await listFilters(auth);
  spinner.succeed(`Found ${existingFilters.length} existing filter(s)`);

  const existingFroms = new Set(
    existingFilters
      .map((f) => f.criteria?.from?.toLowerCase())
      .filter(Boolean)
  );

  // ── Analyze senders ───────────────────────────────────────────────────────
  spinner.start('Loading scan results…');
  const senders = analyzeSenders(cache.inboxMessages ?? [], new Set(cache.sentThreadIds ?? []));
  spinner.succeed(`Loaded ${senders.length.toLocaleString()} senders`);

  // Filter to candidates that don't already have a filter
  const candidates = senders.filter((s) => {
    if (existingFroms.has(s.email.toLowerCase())) return false;
    if (opts.nukeOnly) return s.verdict.label === 'Nuke';
    return s.verdict.label === 'Nuke' || s.verdict.label === 'Review';
  });

  if (!candidates.length) {
    console.log(chalk.green('\n  ✅ All Nuke/Review candidates already have Gmail filters!\n'));
    return;
  }

  // ── Sender selector ───────────────────────────────────────────────────────
  console.log('');
  console.log(chalk.bold(`  ${candidates.length} senders available for filtering`));
  console.log(chalk.dim(`  (${existingFroms.size} already filtered)\n`));

  const choices = candidates.slice(0, 50).map((s) => ({
    name: `${s.verdict.emoji} ${truncate(s.email, 38).padEnd(38)} ${String(s.count).padStart(5)} emails`,
    value: s.email,
    checked: s.verdict.label === 'Nuke',
  }));

  const { selected } = await inquirer.prompt([
    {
      type: 'checkbox',
      name: 'selected',
      message: 'Select senders to create Gmail filters for:',
      choices,
      pageSize: 20,
      loop: false,
    },
  ]);

  if (!selected.length) {
    console.log(chalk.yellow('\n  Nothing selected.\n'));
    return;
  }

  // ── Confirm ───────────────────────────────────────────────────────────────
  const filterDesc = opts.skipTrash
    ? 'skip inbox (archive)'
    : 'skip inbox + move to Trash';

  console.log('');
  const { confirmed } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirmed',
      message: `Create ${selected.length} Gmail filter(s)? Future emails will ${filterDesc}.`,
      default: true,
    },
  ]);

  if (!confirmed) {
    console.log(chalk.yellow('\n  Cancelled.\n'));
    return;
  }

  // ── Create filters ────────────────────────────────────────────────────────
  console.log('');
  let created = 0;
  let skipped = 0;
  let failed = 0;

  for (const email of selected) {
    spinner.start(`Creating filter for ${email}…`);
    try {
      await createSenderFilter(auth, email, {
        skipInbox: true,
        trash: !opts.skipTrash,
      });
      spinner.succeed(chalk.dim(`Filter created: ${email}`));
      created++;
    } catch (err) {
      // 409 means filter already exists — treat as success
      if (err.code === 409 || err.status === 409) {
        spinner.info(chalk.dim(`Already filtered: ${email}`));
        skipped++;
      } else {
        spinner.fail(chalk.red(`Failed [${email}]: ${err.message}`));
        failed++;
      }
    }
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('');
  if (created) success(`Created ${created} new Gmail filter${created !== 1 ? 's' : ''}`);
  if (skipped) hint(`${skipped} already existed`);
  if (failed)  console.log(`  ${c.danger('✗')} ${failed} failed`);

  console.log('');
  hint('Future emails from filtered senders will skip your inbox automatically.');
  hint('View/edit: Gmail Settings → Filters and Blocked Addresses');
  console.log('');
}
