/**
 * @module ui
 * Shared terminal UI primitives for ZeroBox.
 * Keeps visual output consistent across all commands and the app shell.
 */

import chalk from 'chalk';

import { VERSION } from './version.js';

// ── Palette ─────────────────────────────────────────────────────────────────
export const c = {
  brand:   chalk.bold.cyan,
  accent:  chalk.cyan,
  muted:   chalk.dim,
  strong:  chalk.bold.white,
  success: chalk.green,
  warn:    chalk.yellow,
  danger:  chalk.red,
  bold:    chalk.bold,
};

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Strip ANSI escape codes to measure visible character width. */
function visibleLen(str) {
  return String(str).replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, '').length;
}

/** Terminal column width, capped at 100. */
function cols() {
  return Math.max(40, Math.min(process.stdout.columns || 80, 100));
}

// ── Layout primitives ─────────────────────────────────────────────────────────

/**
 * Print the ZeroBox brand banner with optional account email aligned right.
 * @param {string|null} account
 */
export function banner(account) {
  const left  = `  ${c.brand('◆ ZeroBox')}  ${c.muted(`v${VERSION}`)}`;
  const right  = account ? c.muted(account) : '';
  const gap    = Math.max(1, cols() - visibleLen(left) - visibleLen(right));
  console.log(left + ' '.repeat(gap) + right);
}

/**
 * Print a thin dim horizontal rule.
 */
export function divider() {
  console.log(c.muted('  ' + '─'.repeat(cols() - 4)));
}

/**
 * Print a one-line status row from an array of strings.
 * Falsy values are filtered out. Items are joined with a dim ' · ' separator.
 * @param {(string|null|undefined)[]} parts
 */
export function statusLine(parts) {
  const joined = parts.filter(Boolean).join(c.muted(' · '));
  if (joined) console.log(`  ${joined}`);
}

/**
 * Print a highlighted recommendation with a cyan arrow and optional reason.
 * @param {string} label
 * @param {string} [reason]
 */
export function recommendation(label, reason) {
  console.log(`  ${c.accent('→')} ${c.strong(label)}`);
  if (reason) console.log(`    ${c.muted(reason)}`);
}

/**
 * Print a bold section header with a blank line above.
 * @param {string} text
 */
export function header(text) {
  console.log('');
  console.log(`  ${c.bold(text)}`);
}

// ── Status messages ───────────────────────────────────────────────────────────

/** @param {string} text */
export function success(text) { console.log(`  ${c.success('✓')} ${text}`); }

/** @param {string} text */
export function warn(text)    { console.log(`  ${c.warn('⚠')} ${text}`); }

/** @param {string} text */
export function error(text)   { console.log(`  ${c.danger('✗')} ${text}`); }

/** @param {string} text */
export function hint(text)    { console.log(`  ${c.muted(text)}`); }

// ── Menu helpers ───────────────────────────────────────────────────────────────

/**
 * Build a padded menu item label with a dim right-side detail.
 * @param {string} label
 * @param {string} [detail]
 * @param {number} [labelWidth=26]
 * @returns {string}
 */
export function menuItem(label, detail, labelWidth = 26) {
  const visible = visibleLen(label);
  const pad = visible >= labelWidth ? '  ' : ' '.repeat(labelWidth - visible + 2);
  return detail ? `${label}${pad}${c.muted(detail)}` : label;
}

// ── Animations ─────────────────────────────────────────────────────────────────

/**
 * Print text character-by-character for a typewriter effect.
 * @param {string} text
 * @param {number} [delayMs=14]
 * @returns {Promise<void>}
 */
export function typewriter(text, delayMs = 14) {
  return new Promise((resolve) => {
    process.stdout.write('  ');
    let i = 0;
    const tick = setInterval(() => {
      if (i >= text.length) {
        process.stdout.write('\n');
        clearInterval(tick);
        resolve();
        return;
      }
      process.stdout.write(text[i++]);
    }, delayMs);
  });
}
