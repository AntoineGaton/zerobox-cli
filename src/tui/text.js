/**
 * @module tui/text
 * Width-aware string helpers for the full-screen UI. Pure, no I/O.
 * Uses the same string-width as Ink so our padding matches its layout.
 */

import stringWidth from 'string-width';

/** Emoji, joiners, variation selectors and control characters are dropped. */
const NOISE = /[\p{Extended_Pictographic}‍︎️\p{Cc}]/gu;

/** @param {string} str */
export function clean(str) {
  return String(str ?? '').replace(NOISE, '').replace(/\s+/g, ' ').trim();
}

/** @param {string} str */
export function width(str) {
  return stringWidth(String(str ?? ''));
}

/**
 * Cut a string to at most `w` terminal columns, ending with '…' when cut.
 * @param {string} str
 * @param {number} w
 */
export function cut(str, w) {
  str = String(str ?? '');
  if (w <= 0) return '';
  if (width(str) <= w) return str;
  let out = '';
  let used = 0;
  for (const ch of str) {
    const cw = width(ch);
    if (used + cw > w - 1) break;
    out += ch;
    used += cw;
  }
  return out + '…';
}

/** Left-align in exactly `w` columns. */
export function padEnd(str, w) {
  const s = cut(str, w);
  return s + ' '.repeat(Math.max(0, w - width(s)));
}

/** Right-align in exactly `w` columns. */
export function padStart(str, w) {
  const s = cut(str, w);
  return ' '.repeat(Math.max(0, w - width(s))) + s;
}

/** 1234 → "1,234" (fixed locale so snapshots are stable). */
export function num(n) {
  return Number(n ?? 0).toLocaleString('en-US');
}

/** Milliseconds → "3m", "5h", "2d", "4mo", "1.2y". */
export function age(ms) {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d`;
  if (d < 365) return `${Math.floor(d / 30)}mo`;
  return `${(d / 365).toFixed(1)}y`;
}

/** Percentage 0–100 → "37%", or "–" when unknown. */
export function pct(p) {
  return p == null || Number.isNaN(p) ? '–' : `${Math.round(p)}%`;
}
