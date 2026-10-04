/**
 * @module commands/settings
 * `zerobox settings` prints settings.json; `zerobox settings set <key> <value>`
 * changes one protection switch from the shell.
 */

import chalk from 'chalk';
import { SETTINGS_PATH } from '../paths.js';
import { DEFAULT_PROTECT, loadSettings, parseSettingValue, saveSettings } from '../settings.js';

const ABOUT = {
  replied: 'senders you replied to',
  opened: 'senders whose mail you often open',
  openedMin: 'opened share (%) that counts as often, 10-100',
  government: 'tax, .gov and .mil agencies',
  health: 'medical, pharmacy, patient portals',
  finance: 'banks, cards, payments, insurance',
  financeMarketing: 'also protect bank and card promo mail',
  accountSecurity: 'sign-in, codes, passwords, calendar invites',
  utilities: 'power, internet and phone carriers',
};

function load() {
  const { settings, warning } = loadSettings(SETTINGS_PATH);
  if (warning) console.warn(chalk.yellow(`  Warning: ${warning}`));
  return settings;
}

function print(settings) {
  console.log('');
  console.log(chalk.bold('  Protection settings') + chalk.dim(`  ${SETTINGS_PATH}`));
  for (const k of Object.keys(DEFAULT_PROTECT)) {
    const v = settings.protect[k];
    const shown = typeof v === 'boolean' ? (v ? chalk.green('true ') : chalk.yellow('false')) : chalk.cyan(String(v).padEnd(5));
    console.log(`  ${k.padEnd(17)} ${shown}  ${chalk.dim(ABOUT[k])}`);
  }
  console.log(chalk.dim('  Always on: starred mail and your own address.'));
  console.log(chalk.dim('  Change one: zerobox settings set financeMarketing false'));
  console.log('');
}

export async function runSettings(action, key, value) {
  if (!action) return print(load());
  if (action !== 'set') throw new Error(`Unknown settings action "${action}". Use: zerobox settings, or zerobox settings set <key> <value>.`);
  if (key == null || value == null) throw new Error('Usage: zerobox settings set <key> <value>, e.g. zerobox settings set openedMin 50');
  const { key: k, value: v } = parseSettingValue(key, value);
  const settings = load();
  settings.protect[k] = v;
  saveSettings(settings, SETTINGS_PATH);
  console.log(`\n  ${chalk.green(`Set ${k} to ${v}.`)}\n  ${chalk.dim(SETTINGS_PATH)}\n`);
}
