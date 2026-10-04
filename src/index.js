#!/usr/bin/env node
/**
 * ZeroBox CLI entrypoint.
 * Opens the full-screen view by default, while keeping direct commands available.
 */

import 'dotenv/config';
import { program } from 'commander';
import chalk from 'chalk';
import path from 'path';

import { launchAppShell } from './app-shell.js';
import { runScan } from './commands/scan.js';
import { runClean } from './commands/clean.js';
import { runUnsubscribe } from './commands/unsubscribe.js';
import { runFilter } from './commands/filter.js';
import { runStats } from './commands/stats.js';
import { runProtect } from './commands/protect.js';
import { runSettings } from './commands/settings.js';
import { ZEROBOX_HOME } from './paths.js';
import { VERSION } from './version.js';

function fatal(err) {
  console.error('');
  console.error(chalk.red(`  Error: ${err.message}`));
  if (process.env.DEBUG) {
    console.error('');
    console.error(chalk.dim(err.stack));
  }
  console.error('');
  process.exit(1);
}

program
  .name('zerobox')
  .description(chalk.cyan('ZeroBox - Gmail inbox cleaner for the terminal'))
  .version(VERSION)
  .addHelpText(
    'after',
    `
${chalk.bold('Quick start:')}
  zerobox setup          Connect ZeroBox to Gmail (guided, about 5 minutes, once)
  zerobox                Open the full-screen view: browse, mark, review, apply
  zerobox menu           The older guided menu
  zerobox scan           Scan inbox and rank senders by volume
  zerobox clean          Move mail from noisy senders to Trash
  zerobox unsubscribe    Auto-handle List-Unsubscribe links
  zerobox filter         Create Gmail filters to block future emails
  zerobox stats          Show inbox health dashboard
  zerobox protect <who>  Never bulk-clean a sender (address, @domain or *keyword*)
  zerobox settings       Show or change which rules protect senders

${chalk.bold('Setup:')}
  Run zerobox setup. It walks you through creating your own Google client
  (a Desktop app) and saves it as ${path.join(ZEROBOX_HOME, 'credentials.json')}

${chalk.bold('Data folder:')} ${ZEROBOX_HOME}  (override with ZEROBOX_HOME)
`
  );

program
  .command('scan')
  .description('Fetch inbox, rank senders by volume, display analysis table')
  .option('--fresh', 'Discard cache and start a new scan from scratch')
  .option('--limit <n>', 'Fetch at most n new messages this run (default: whole inbox)', (value) => {
    const parsed = parseInt(value, 10);
    if (Number.isNaN(parsed) || parsed < 1) {
      throw new Error('--limit must be a positive integer');
    }
    return parsed;
  })
  .option('--json', 'Output raw JSON instead of the formatted table')
  .action((opts) => runScan(opts).catch(fatal));

program
  .command('clean')
  .description('Interactively move emails from high-volume senders to Trash')
  .option('--dry-run', 'Show what would be deleted without making any changes')
  .option('--permanent', 'Skip Trash and delete permanently (cannot be undone)')
  .option('--top <n>', 'Number of sender candidates to show', (value) => parseInt(value, 10), 50)
  .action((opts) =>
    runClean({ dryRun: opts.dryRun, permanent: opts.permanent, top: opts.top }).catch(fatal)
  );

program
  .command('unsubscribe')
  .description('Auto-send or open unsubscribe links from List-Unsubscribe headers')
  .option('--all', 'Re-process senders that were already handled')
  .action((opts) => runUnsubscribe(opts).catch(fatal));

program
  .command('filter')
  .description('Create Gmail filters so future emails skip inbox (+ trash) automatically')
  .option('--nuke-only', 'Only show Nuke candidates')
  .option('--skip-trash', 'Archive only - do not also move to Trash')
  .action((opts) =>
    runFilter({ nukeOnly: opts.nukeOnly, skipTrash: opts.skipTrash }).catch(fatal)
  );

program
  .command('stats')
  .description('Show inbox health dashboard: totals, trends, top senders, history')
  .action(() => runStats().catch(fatal));

program
  .command('protect [pattern]')
  .description('Never bulk-trash or bulk-unsubscribe a sender: address, @domain or *keyword*')
  .option('--list', 'Show your protected list and what the last scan protects')
  .action((pattern, opts) => runProtect(pattern, { list: opts.list, mode: 'protect' }).catch(fatal));

program
  .command('unprotect <pattern>')
  .description('Remove a protected entry, or add an exception to the built-in rules')
  .action((pattern) => runProtect(pattern, { mode: 'unprotect' }).catch(fatal));

program
  .command('settings [action] [key] [value]')
  .description('Show protection settings, or change one: settings set <key> <value>')
  .action((action, key, value) => runSettings(action, key, value).catch(fatal));

program
  .command('setup')
  .description('Guided setup: connect ZeroBox to your own Google client, then sign in')
  .action(() => import('./commands/setup.js').then(({ runSetup }) => runSetup()).catch(fatal));

program
  .command('auth')
  .description('Trigger the OAuth2 flow to (re-)authorize ZeroBox')
  .option('--no-browser', 'Sign in from another device (for SSH or servers)')
  .action(async (opts) => {
    if (opts.browser === false) process.env.ZEROBOX_NO_BROWSER = '1';
    const { revokeToken, getAuthClient } = await import('./auth.js');
    await revokeToken();
    console.log(chalk.dim('  Token cleared. Re-authenticating...\n'));
    await getAuthClient();
    console.log(chalk.green('  ZeroBox is authorized.\n'));
  });

program
  .command('menu')
  .description('Open the older guided menu (the default is now the full-screen view)')
  .action(() => {
    process.on('uncaughtException', (error) => {
      if (error?.code === 'ERR_USE_AFTER_CLOSE') {
        console.log(chalk.dim('\n  Closing ZeroBox.\n'));
        process.exit(0);
      }
      fatal(error);
    });
    return launchAppShell().catch(fatal);
  });

if (process.argv.length <= 2) {
  import('./tui/app.tsx').then(({ launchTui }) => launchTui()).catch(fatal);
} else {
  program.parseAsync(process.argv).catch(fatal);
}
