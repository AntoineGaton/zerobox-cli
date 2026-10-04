/**
 * @module commands/protect
 * `zerobox protect <pattern>`, `zerobox unprotect <pattern>` and
 * `zerobox protect --list`: manage protected.txt from the shell.
 */

import fs from 'fs/promises';
import chalk from 'chalk';
import { loadProtectText, loadUserSettings, saveProtectText } from '../actions.js';
import { CACHE_PATH, PROTECTED_PATH } from '../paths.js';
import { editProtectText, isValidPattern, parseProtectList } from '../protect.js';
import { protectedSenders } from '../tui/model.js';

const USAGE = 'Use a full address (bob@example.com), a domain (@example.com) or a keyword (*invoice*).';

export async function runProtect(pattern, { list = false, mode = 'protect' } = {}) {
  if (list || !pattern) return listProtected();
  if (!isValidPattern(pattern)) throw new Error(`"${pattern}" is not a pattern ZeroBox understands. ${USAGE}`);

  const { text, change } = editProtectText(await loadProtectText(), pattern, mode);
  await saveProtectText(text);
  const p = pattern.toLowerCase();
  const msg = {
    added: `Protected ${p}. Bulk marks skip it from now on.`,
    removed: `Removed ${p} from your protected list.`,
    excepted: `Added an exception: ${p} is never protected, even by the built-in rules.`,
    unchanged: mode === 'protect' ? `${p} was already protected.` : `${p} already has an exception.`,
  }[change];
  console.log(`\n  ${chalk.green(msg)}\n  ${chalk.dim(PROTECTED_PATH)}\n`);
}

async function listProtected() {
  const text = await loadProtectText();
  const entries = parseProtectList(text);
  console.log('');
  console.log(chalk.bold(`  Your protected list`) + chalk.dim(`  ${PROTECTED_PATH}`));
  if (!entries.length) console.log(chalk.dim('  (empty) Add one with: zerobox protect bob@example.com'));
  for (const e of entries) console.log(`  ${e.negate ? chalk.yellow('never  ') : chalk.blue('protect')}  ${e.pattern}`);

  let cache = null;
  try { cache = JSON.parse(await fs.readFile(CACHE_PATH, 'utf8')); } catch { /* no scan yet */ }
  if (cache?.inboxMessages?.length) {
    const map = protectedSenders(cache, text, loadUserSettings());
    const by = new Map();
    for (const reason of map.values()) {
      const key = reason.replace(/^opened \d+%$/, 'opened often');
      by.set(key, (by.get(key) ?? 0) + 1);
    }
    console.log('');
    console.log(chalk.bold(`  ${map.size} senders in your last scan are protected`));
    for (const [k, n] of [...by].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(5)}  ${k}`);
  }
  console.log('');
}
