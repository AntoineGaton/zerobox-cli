/**
 * @module protect
 * Decides which senders must never be bulk-trashed or bulk-unsubscribed.
 * Pure: no I/O. The user's list is passed in as text (protected.txt).
 *
 * A sender is protected when any of these holds:
 *   - one of its messages is starred                       (always)
 *   - it is your own address                               (always)
 *   - you replied to it (replyPct > 0)                     (settings: replied)
 *   - you open most of its mail (opened >= openedMin, 40%) (settings: opened, openedMin)
 *   - it matches a built-in rule below (banks, government, health, account security…)
 *     whose category is switched on in settings.json
 *   - it matches an entry in protected.txt
 * An entry starting with `!` in protected.txt removes protection, overriding
 * everything above; a plain entry protects whatever the settings say.
 * Receipts and shops are deliberately NOT protected.
 */

import { DEFAULT_PROTECT } from './settings.js';

/** Default opened share (0–100) at or above which a sender is protected. */
export const OPENED_MIN = DEFAULT_PROTECT.openedMin;

/** Built-in rule category → its switch in settings.protect. */
export const CATEGORY_SETTING = {
  government: 'government',
  health: 'health',
  finance: 'finance',
  'account security': 'accountSecurity',
  utilities: 'utilities',
};

/**
 * Built-in rules, checked against the lower-case address. Each is
 * [category, RegExp]. Keep them readable and conservative: they decide what
 * a bulk trash skips, and anything they miss is still shown for review.
 * Big companies (Apple, Google, Microsoft) are matched by the account,
 * security, card and calendar senders, never by their whole domain, so their
 * marketing stays trashable.
 */
export const RULES = [
  // Government and tax: any .gov / .mil domain, plus well-known agencies
  ['government', /@(.+\.)?[a-z0-9-]+\.(gov|mil)(\.[a-z]{2})?$|@(.+\.)?(irs|ssa)\.(gov|com)$/],

  // Health, medical, pharmacy, patient portals
  ['health', /health|medical|pharmac|patient|clinic|hospital|mychart|@(.+\.)?(cvs|walgreens|kaiserpermanente)\.com$/],

  // Banks, cards, payments, investments, insurance (domains)
  ['finance', new RegExp('@(.+\\.)?(' + [
    'chase', 'paypal', 'venmo', 'fidelity', 'vanguard', 'schwab', 'etrade', 'robinhood', 'coinbase',
    'synchrony', 'synchronybank', 'synchronyfinancial', 'barclays', 'barclaysus', 'breadfinancial', 'comenity',
    'capitalone', 'wellsfargo', 'bankofamerica', 'bofa', 'citi', 'citibank', 'americanexpress', 'aexp', 'amex',
    'discover', 'usbank', 'pnc', 'ally', 'sofi', 'navyfederal', 'tdbank', 'truist', 'regions', 'hsbc',
    'applecard', 'wise', 'zelle', 'experian', 'equifax', 'transunion', 'creditkarma',
    'geico', 'progressive', 'statefarm', 'allstate', 'libertymutual', 'lemonade',
  ].join('|') + ')\\.[a-z.]+$')],
  // …and words in the address that mean money or insurance
  ['finance', /\bbank\b|banking|creditunion|credit-union|insurance|\bcardholder|applecard|statements?\b|\bcard[-_.]?(services|member|alerts?)\b/],

  // Account security, sign-in, verification, calendar invites
  ['account security', /security|accountprotection|account-protection|verif|sign-?in|login|\b2fa\b|\botp\b|password|fraud|noreply-accounts|accounts?-noreply|@accounts\.|calendar-notification/],

  // Utilities and phone carriers
  ['utilities', /@(.+\.)?(verizon|verizonwireless|att|t-mobile|tmobile|comcast|xfinity|spectrum|charter|cox|fpl|duke-energy|duke|coned|pge|sce|nationalgrid|mintmobile)\.(com|net)$/],
];

// ── protected.txt ───────────────────────────────────────────────────────────

/**
 * @typedef {{pattern: string, negate: boolean}} Entry
 * pattern is one of: full address, `@domain`, or `*keyword*`
 */

/**
 * Parse protected.txt: one entry per line, `#` comments, blank lines ignored.
 * A leading `!` turns an entry into an exception (never protected).
 * @param {string} text
 * @returns {Entry[]}
 */
export function parseProtectList(text) {
  const out = [];
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    let line = raw.replace(/#.*$/, '').trim().toLowerCase();
    if (!line) continue;
    const negate = line.startsWith('!');
    if (negate) line = line.slice(1).trim();
    if (line) out.push({ pattern: line, negate });
  }
  return out;
}

/** True when an entry's pattern matches an address. */
export function matchEntry(pattern, email) {
  email = String(email ?? '').toLowerCase();
  pattern = pattern.toLowerCase();
  if (pattern.startsWith('*') && pattern.endsWith('*') && pattern.length > 2) {
    return email.includes(pattern.slice(1, -1));
  }
  if (pattern.startsWith('@')) {
    const domain = email.split('@')[1] ?? '';
    const want = pattern.slice(1);
    return domain === want || domain.endsWith('.' + want);
  }
  return email === pattern;
}

/** 'protect' | 'unprotect' | null for an address under the user's list. Exceptions win. */
export function listDecision(entries, email) {
  let decision = null;
  for (const e of entries) {
    if (!matchEntry(e.pattern, email)) continue;
    if (e.negate) return 'unprotect';
    decision = 'protect';
  }
  return decision;
}

// ── Finance marketing ───────────────────────────────────────────────────────

/**
 * Words in an address that mean account mail rather than promotion. Any of
 * them keeps a finance sender protected even when finance marketing is off:
 * `statements@mail.bank.example` stays, `offers@mail.bank.example` goes.
 */
const TRANSACTIONAL = /alert|statement|servic|customer|fraud|security|billing|payment|notice|account|verif|receipt/;

/**
 * Sending subdomains that bulk-mail platforms use: `m.`, `e.`, `em.`,
 * `email1.`, `info15.`, `news.`, `mail8.`… One- and two-letter labels
 * (`o.lender.example`, `s.usa.bureau.example`) are almost always an email service
 * provider. `notification.` / `notify.` are deliberately NOT here: banks send
 * payment and balance alerts from them (card@notification.bank.example).
 */
const MARKETING_LABEL = /^([a-z]{1,2}|e\d+|em\d*|emails?\d*|mail\d*|mailer|mailing|info\d*|news(letters?)?|marketing|promos?|promotions?|offers?|deals|campaigns?|mkt[a-z]*)$/;

/** Local parts (split on . _ - +) that mean promotional mail. */
const MARKETING_LOCAL = /^(info|news|newsletters?|marketing|offers?|promos?|promotions?|deals|mail)$/;

/**
 * True when a finance address looks like bulk marketing rather than account
 * mail. Used only when settings.protect.financeMarketing is off.
 * @param {string} email
 */
export function looksLikeMarketing(email) {
  email = String(email ?? '').toLowerCase();
  const at = email.lastIndexOf('@');
  if (at < 0) return false;
  if (TRANSACTIONAL.test(email)) return false;
  const local = email.slice(0, at);
  const labels = email.slice(at + 1).split('.');
  // Subdomain labels: everything before the last two (the registrable domain)
  const sub = labels.slice(0, Math.max(0, labels.length - 2));
  return sub.some((l) => MARKETING_LABEL.test(l)) || local.split(/[._+-]/).some((t) => MARKETING_LOCAL.test(t));
}

// ── Decisions ───────────────────────────────────────────────────────────────

/** settings.json `protect` object (or the whole settings) merged over the defaults. */
export function protectSettings(settings) {
  const p = settings?.protect ?? settings ?? {};
  return { ...DEFAULT_PROTECT, ...p };
}

/**
 * Why a sender is protected by the built-in rules, or null.
 * Starred and your own address always protect; the rest follow settings.
 * @param {{email: string, starred?: number, replyPct?: number, openedPct?: number|null}} s
 * @param {{own?: string[], settings?: object}} [opts]  the user's own addresses, settings.json
 * @returns {string|null}
 */
export function builtinReason(s, { own = [], settings } = {}) {
  const p = protectSettings(settings);
  const email = String(s.email ?? '').toLowerCase();
  if (own.some((a) => a && a.toLowerCase() === email)) return 'your address';
  if (s.starred > 0) return 'starred';
  if (p.replied && s.replyPct > 0) return 'you replied';
  if (p.opened && s.openedPct != null && s.openedPct >= p.openedMin) return `opened ${Math.round(s.openedPct)}%`;
  return ruleCategory(email, p);
}

/**
 * The first built-in rule category that matches and is switched on, or null.
 * @param {string} email  lower-case address
 * @param {object} p      protectSettings()
 */
export function ruleCategory(email, p = DEFAULT_PROTECT) {
  let marketing = null;
  for (const [category, re] of RULES) {
    if (!p[CATEGORY_SETTING[category]] || !re.test(email)) continue;
    if (category === 'finance' && !p.financeMarketing) {
      marketing ??= looksLikeMarketing(email);
      if (marketing) continue;
    }
    return category;
  }
  return null;
}

/**
 * Final protection for a sender: the user's list overrides the built-ins.
 * @param {string} email
 * @param {string|null} builtin  result of builtinReason
 * @param {Entry[]} entries
 * @returns {string|null} reason, or null when not protected
 */
export function protectReason(email, builtin, entries) {
  const d = listDecision(entries, email);
  if (d === 'unprotect') return null;
  if (d === 'protect') return 'your list';
  return builtin;
}

/**
 * Flip one address in protected.txt so its protection toggles, keeping
 * comments and unrelated lines. Protected → removes its own line, and adds
 * `!address` if something else would still protect it. Unprotected →
 * removes a `!address` line, and adds the address if still unprotected.
 *
 * @param {string} text      current protected.txt
 * @param {string} email
 * @param {string|null} builtin  builtinReason for this sender
 * @returns {{text: string, protected: boolean}}
 */
export function toggleProtectText(text, email, builtin) {
  email = email.toLowerCase();
  const lines = String(text ?? '').split(/\r?\n/);
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  const isLine = (l, neg) => l.replace(/#.*$/, '').trim().toLowerCase() === (neg ? '!' : '') + email;
  const was = protectReason(email, builtin, parseProtectList(text)) !== null;

  // Drop the line that currently decides this address, then re-check
  const next = lines.filter((l) => !isLine(l, !was));
  const now = () => protectReason(email, builtin, parseProtectList(next.join('\n'))) !== null;
  if (was && now()) next.push(`!${email}`);
  if (!was && !now()) next.push(email);
  return { text: next.length ? next.join('\n') + '\n' : '', protected: !was };
}

export const PROTECT_FILE_HEADER = `# ZeroBox protected senders: never bulk-trashed or bulk-unsubscribed.
# One per line: full address, @domain (includes subdomains) or *keyword*.
# Start a line with ! to remove protection from a sender the built-in rules protect.
`;

/** What to write to protected.txt: the header is added to a file that has none. */
export function protectFileBody(text) {
  return String(text ?? '').startsWith('#') ? text : PROTECT_FILE_HEADER + (text ?? '');
}

/** True for a usable protected.txt pattern: address, @domain or *keyword*. */
export function isValidPattern(p) {
  p = String(p ?? '').trim().toLowerCase();
  return /^[^\s@#!]+@[^\s@#]+\.[^\s@#]+$/.test(p) ||
    /^@[^\s@#]+\.[^\s@#]+$/.test(p) ||
    /^\*[^\s#*]+\*$/.test(p);
}

/**
 * Edit protected.txt for `zerobox protect` / `zerobox unprotect`.
 * protect: drops any `!pattern` line and adds `pattern`.
 * unprotect: drops a `pattern` line if there is one, else adds `!pattern`
 * (an exception that overrides the built-in rules).
 * @returns {{text: string, change: 'added'|'removed'|'excepted'|'unchanged'}}
 */
export function editProtectText(text, pattern, mode) {
  pattern = pattern.trim().toLowerCase();
  const lines = String(text ?? '').split(/\r?\n/);
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  const body = (l) => l.replace(/#.*$/, '').trim().toLowerCase();
  const has = (v) => lines.some((l) => body(l) === v);
  const without = (v) => lines.filter((l) => body(l) !== v);
  const out = (ls, change) => ({ text: ls.length ? ls.join('\n') + '\n' : '', change });

  if (mode === 'protect') {
    const ls = without(`!${pattern}`);
    if (has(pattern)) return out(ls, ls.length === lines.length ? 'unchanged' : 'added');
    return out([...ls, pattern], 'added');
  }
  if (has(pattern)) return out(without(pattern), 'removed');
  if (has(`!${pattern}`)) return out(lines, 'unchanged');
  return out([...lines, `!${pattern}`], 'excepted');
}
