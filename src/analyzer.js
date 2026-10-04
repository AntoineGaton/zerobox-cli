/**
 * @module analyzer
 * Stateless sender scoring and analysis logic.
 * All functions are pure (no I/O, no side effects) and can be imported
 * by a web UI, API route, or test suite without modification.
 */

// ---------------------------------------------------------------------------
// Header parsing utilities
// ---------------------------------------------------------------------------

/**
 * Extract a named header value from a Gmail message metadata object.
 *
 * @param {object} message - Gmail message resource (format: METADATA)
 * @param {string} name - header name (case-insensitive)
 * @returns {string|null}
 */
export function getHeader(message, name) {
  const headers = message?.payload?.headers ?? [];
  const lower = name.toLowerCase();
  const header = headers.find((h) => h.name.toLowerCase() === lower);
  return header?.value ?? null;
}

/**
 * Parse a raw RFC 2822 From header into its component parts.
 *
 * Handles formats:
 *   - "Display Name <user@example.com>"
 *   - '"Display, Name" <user@example.com>'
 *   - "user@example.com"
 *
 * @param {string|null} from - raw From header value
 * @returns {{ name: string, email: string, domain: string }}
 */
export function parseFrom(from) {
  if (!from) return { name: '', email: '', domain: '' };

  const EMAIL = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/;

  // "Display Name <user@example.com>": the address is whatever is in brackets
  const angle = from.match(/^(.*?)<\s*([^<>\s]+)\s*>/);
  if (angle && EMAIL.test(angle[2])) {
    const name = angle[1].trim().replace(/^"|"$/g, '').trim();
    const email = angle[2].toLowerCase();
    return { name: name || email, email, domain: email.split('@')[1] ?? '' };
  }

  // Bare "user@example.com". Match the whole address: the old combined pattern
  // let the display-name group take the first character ("bob@" → "ob@").
  const bare = from.match(EMAIL);
  if (bare) {
    const email = bare[0].toLowerCase();
    return { name: email, email, domain: email.split('@')[1] ?? '' };
  }

  // Fallback: treat the whole thing as an email
  const email = from.trim().toLowerCase();
  const domain = email.includes('@') ? email.split('@')[1] : '';
  return { name: email, email, domain };
}

/**
 * The RFC 8058 one-click URL, or null: the message must carry
 * `List-Unsubscribe-Post: List-Unsubscribe=One-Click` and an https link.
 *
 * @param {string|null} listUnsubscribe - raw List-Unsubscribe header
 * @param {string|null} listUnsubscribePost - raw List-Unsubscribe-Post header
 * @returns {string|null}
 */
export function oneClickUrl(listUnsubscribe, listUnsubscribePost) {
  if (!/^\s*List-Unsubscribe\s*=\s*One-Click\s*$/i.test(listUnsubscribePost ?? '')) return null;
  const links = [...String(listUnsubscribe ?? '').matchAll(/<([^>]+)>/g)].map((m) => m[1].trim());
  return links.find((l) => /^https:\/\//i.test(l)) ?? null;
}

/**
 * Parse a List-Unsubscribe header into mailto and HTTP links.
 *
 * RFC 8058 format: "<mailto:unsub@example.com>, <https://example.com/unsub>"
 *
 * @param {string|null} header - raw List-Unsubscribe header value
 * @returns {{ mailto: string|null, http: string|null }}
 */
export function parseUnsubscribeHeader(header) {
  if (!header) return { mailto: null, http: null };

  const links = [...header.matchAll(/<([^>]+)>/g)].map((m) => m[1]);
  let mailto = null;
  let http = null;

  for (const link of links) {
    if (!mailto && link.startsWith('mailto:')) {
      mailto = link.slice('mailto:'.length);
    } else if (!http && (link.startsWith('http://') || link.startsWith('https://'))) {
      http = link;
    }
  }

  return { mailto, http };
}

// ---------------------------------------------------------------------------
// Verdict logic
// ---------------------------------------------------------------------------

/**
 * Compute the cleanup verdict for a sender based on volume and engagement.
 *
 * Rules (in priority order):
 *   🔴 Nuke   — count > 10 AND replied% < 5%
 *   🟡 Review — count > 5  AND replied% < 20%
 *   🟢 Keep   — everything else
 *
 * @param {number} count - total emails from this sender in inbox
 * @param {number} replyPct - percentage of threads where the user replied (0–100)
 * @returns {{ label: 'Nuke'|'Review'|'Keep', emoji: string, priority: number }}
 */
export function computeVerdict(count, replyPct) {
  if (count > 10 && replyPct < 5) {
    return { label: 'Nuke', emoji: '🔴', priority: 3 };
  }
  if (count > 5 && replyPct < 20) {
    return { label: 'Review', emoji: '🟡', priority: 2 };
  }
  return { label: 'Keep', emoji: '🟢', priority: 1 };
}

// ---------------------------------------------------------------------------
// Core analysis
// ---------------------------------------------------------------------------

/**
 * @typedef {object} SenderStats
 * @property {string} email - sender email address
 * @property {string} name - display name (falls back to email)
 * @property {string} domain - sender domain
 * @property {number} count - total messages in inbox from this sender
 * @property {number} repliedCount - unique threads where the user sent a reply
 * @property {string[]} threadIds - all thread IDs for this sender
 * @property {string[]} messageIds - all message IDs for this sender
 * @property {Date} oldestDate - date of the oldest message
 * @property {Date} newestDate - date of the most recent message
 * @property {number} ageDays - age of the oldest message in days
 * @property {boolean} hasUnsubscribe - true if any message had a List-Unsubscribe header
 * @property {{ mailto: string|null, http: string|null, oneClick: string|null }} unsubscribe - parsed
 *   unsubscribe links from the most recent message that has any; oneClick is the RFC 8058 https URL
 * @property {number} replyPct - percentage of threads replied to (0–100, 1 decimal)
 * @property {{ label: string, emoji: string, priority: number }} verdict
 */

/**
 * Analyze inbox messages to produce a ranked list of sender statistics.
 *
 * @param {object[]} inboxMessages - Gmail message resources (format: METADATA)
 * @param {Set<string>} [repliedThreadIds] - set of threadIds where the user sent a reply
 * @returns {SenderStats[]} sorted by verdict priority (Nuke first), then count desc
 */
export function analyzeSenders(inboxMessages, repliedThreadIds = new Set()) {
  /** @type {Map<string, SenderStats & { threadIdSet: Set<string> }>} */
  const senderMap = new Map();

  for (const msg of inboxMessages) {
    if (!msg?.payload) continue;

    const fromHeader = getHeader(msg, 'From');
    const dateHeader = getHeader(msg, 'Date');
    const unsubHeader = getHeader(msg, 'List-Unsubscribe');
    const unsubPost = getHeader(msg, 'List-Unsubscribe-Post');

    const { email, name, domain } = parseFrom(fromHeader);
    if (!email) continue;

    const date = dateHeader ? new Date(dateHeader) : new Date(0);
    const isValidDate = !Number.isNaN(date.getTime());
    const safeDate = isValidDate ? date : new Date();

    const threadId = msg.threadId ?? '';
    const replied = threadId ? repliedThreadIds.has(threadId) : false;
    const unsub = parseUnsubscribeHeader(unsubHeader);

    if (!senderMap.has(email)) {
      senderMap.set(email, {
        email,
        name,
        domain,
        count: 0,
        repliedCount: 0,
        threadIdSet: new Set(),
        threadIds: [],
        messageIds: [],
        oldestDate: safeDate,
        newestDate: safeDate,
        ageDays: 0,
        hasUnsubscribe: false,
        unsubscribe: { mailto: null, http: null, oneClick: null },
        unsubDate: -Infinity,
        replyPct: 0,
        verdict: { label: 'Keep', emoji: '🟢', priority: 1 },
      });
    }

    const sender = senderMap.get(email);
    sender.count++;
    sender.messageIds.push(msg.id);

    // Count threads, not messages, so the ratio below can't exceed 100%
    if (replied && !sender.threadIdSet.has(threadId)) sender.repliedCount++;
    sender.threadIdSet.add(threadId);
    if (isValidDate && safeDate < sender.oldestDate) sender.oldestDate = safeDate;
    if (isValidDate && safeDate > sender.newestDate) sender.newestDate = safeDate;

    // Links change over time: keep those of the most recent message
    const when = isValidDate ? safeDate.getTime() : -1;
    if ((unsub.mailto || unsub.http) && when >= sender.unsubDate) {
      sender.hasUnsubscribe = true;
      sender.unsubDate = when;
      sender.unsubscribe = { ...unsub, oneClick: oneClickUrl(unsubHeader, unsubPost) };
    }
  }

  // Compute derived fields and sort
  const now = Date.now();
  const results = [];

  for (const [, sender] of senderMap) {
    const uniqueThreads = sender.threadIdSet.size || 1;
    const replyPct = Math.round((sender.repliedCount / uniqueThreads) * 1000) / 10; // 1 decimal

    sender.threadIds = [...sender.threadIdSet];
    delete sender.threadIdSet; // clean up non-serializable Set
    delete sender.unsubDate;

    sender.replyPct = replyPct;
    sender.ageDays = Math.floor((now - sender.oldestDate.getTime()) / 86_400_000);
    sender.verdict = computeVerdict(sender.count, replyPct);

    results.push(sender);
  }

  // Sort: highest priority (Nuke) first, then by message count descending
  results.sort((a, b) => {
    if (b.verdict.priority !== a.verdict.priority) return b.verdict.priority - a.verdict.priority;
    return b.count - a.count;
  });

  return results;
}

// ---------------------------------------------------------------------------
// Formatting helpers (pure, no I/O)
// ---------------------------------------------------------------------------

/**
 * Format a number of days into a human-readable age string.
 * @param {number} days
 * @returns {string}  e.g. "3d", "2mo", "1y"
 */
export function formatAgeDays(days) {
  if (days < 1) return 'today';
  if (days < 30) return `${days}d`;
  if (days < 365) return `${Math.floor(days / 30)}mo`;
  return `${(days / 365).toFixed(1)}y`;
}

/**
 * Truncate a string to maxLen characters, appending '…' if truncated.
 * @param {string} str
 * @param {number} maxLen
 * @returns {string}
 */
export function truncate(str, maxLen) {
  if (!str || str.length <= maxLen) return str ?? '';
  return str.slice(0, maxLen - 1) + '…';
}
