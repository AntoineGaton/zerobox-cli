/**
 * @module gmail
 * Pure Gmail API wrapper functions.
 * All functions accept an OAuth2 auth client as the first argument,
 * making them trivially portable to a Next.js API route or any server context.
 */

import { google } from 'googleapis';
import { TRASH_PER_SECOND } from './limits.js';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Return a Gmail API client bound to the provided auth client.
 * @param {import('googleapis').Auth.OAuth2Client} auth
 */
function gmail(auth) {
  return google.gmail({ version: 'v1', auth });
}

// ---------------------------------------------------------------------------
// Retry / rate-limit handling
// ---------------------------------------------------------------------------

/**
 * True for errors worth retrying: rate limits and server hiccups.
 * Gmail signals throttling as 429 or as 403 with reason rateLimitExceeded /
 * userRateLimitExceeded; a 403 with any other reason is a real permission error.
 * @param {any} err
 */
export function isTransientError(err) {
  const status = err?.response?.status ?? err?.status ?? (typeof err?.code === 'number' ? err.code : undefined);
  const reason = err?.errors?.[0]?.reason ?? err?.response?.data?.error?.errors?.[0]?.reason;
  if ([429, 500, 502, 503, 504].includes(status)) return true;
  if (reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded') return true;
  return ['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ECONNREFUSED'].includes(err?.code);
}

/**
 * Execute an async function with exponential backoff on transient errors
 * (see isTransientError).
 *
 * @param {() => Promise<T>} fn - async function to execute
 * @param {number} [maxRetries=8]
 * @returns {Promise<T>}
 * @template T
 */
export async function withBackoff(fn, maxRetries = 8) {
  let lastError;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (!isTransientError(err)) throw err;

      // Exponential backoff: 1s, 2s, 4s … capped at 60s (+ jitter). Gmail also
      // enforces a per-minute quota, so retries must be able to outlast a
      // full one-minute window (~3 min in total here).
      const delay = Math.min(1000 * 2 ** attempt + Math.random() * 500, 60_000);
      await sleep(delay);
    }
  }
  throw lastError;
}

// ---------------------------------------------------------------------------
// Message listing
// ---------------------------------------------------------------------------

/**
 * List Gmail message IDs matching a query, paginating through all results.
 * Only returns lightweight {id, threadId} objects — no body or headers fetched.
 *
 * @param {import('googleapis').Auth.OAuth2Client} auth
 * @param {string} query - Gmail search query (e.g. 'in:inbox', 'in:sent')
 * @param {object} [options]
 * @param {number} [options.maxResults=5000] - hard cap on total messages returned
 * @param {string|null} [options.pageToken=null] - resume pagination from this token
 * @param {(fetched: number, estimate: number) => void} [options.onProgress]
 * @returns {Promise<{messages: Array<{id: string, threadId: string}>, nextPageToken: string|null}>}
 */
export async function listMessages(auth, query, { maxResults = 5000, pageToken = null, onProgress } = {}) {
  const g = gmail(auth);
  const messages = [];
  let token = pageToken;

  while (messages.length < maxResults) {
    const pageSize = Math.min(500, maxResults - messages.length);

    const res = await withBackoff(() =>
      g.users.messages.list({
        userId: 'me',
        q: query,
        maxResults: pageSize,
        pageToken: token || undefined,
        fields: 'messages(id,threadId),nextPageToken,resultSizeEstimate',
      })
    );

    const batch = res.data.messages || [];
    messages.push(...batch);
    token = res.data.nextPageToken || null;

    if (onProgress) {
      onProgress(messages.length, res.data.resultSizeEstimate || messages.length);
    }

    if (!token) break;
  }

  return { messages, nextPageToken: token };
}

// ---------------------------------------------------------------------------
// Message metadata fetching
// ---------------------------------------------------------------------------

/**
 * Fetch metadata for a single message (specified headers only, no body).
 *
 * @param {import('googleapis').Auth.OAuth2Client} auth
 * @param {string} messageId
 * @param {string[]} [headers] - which RFC 2822 headers to include
 * @returns {Promise<object>} Gmail message resource
 */
export async function getMessageMetadata(
  auth,
  messageId,
  headers = ['From', 'Date', 'Subject', 'List-Unsubscribe', 'List-Unsubscribe-Post']
) {
  const g = gmail(auth);
  const res = await withBackoff(() =>
    g.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'METADATA',
      metadataHeaders: headers,
      fields: 'id,threadId,labelIds,payload(headers)',
    })
  );
  return res.data;
}

// Gmail allows 250 quota units per user per second (15,000 per minute) and
// messages.get costs 5, so 50/s is the ceiling. 30/s leaves headroom for
// listing and other calls instead of relying on retries.
const METADATA_PER_SECOND = 30;

/**
 * Fetch metadata for many messages in small parallel batches, paced to stay
 * under Gmail's per-user quota.
 *
 * Messages that still fail after retries are returned in `failedIds` rather
 * than silently dropped, so callers can report them and retry later.
 *
 * @param {import('googleapis').Auth.OAuth2Client} auth
 * @param {string[]} messageIds
 * @param {object} [options]
 * @param {number} [options.batchSize=10] - parallel API calls per batch
 * @param {string[]} [options.headers] - forwarded to getMessageMetadata
 * @param {(done: number, total: number) => void} [options.onProgress]
 * @returns {Promise<{messages: object[], failedIds: string[]}>}
 */
export async function batchGetMetadata(auth, messageIds, { batchSize = 10, headers, onProgress } = {}) {
  const messages = [];
  const failedIds = [];

  for (let i = 0; i < messageIds.length; i += batchSize) {
    const chunk = messageIds.slice(i, i + batchSize);
    const started = Date.now();

    const chunkResults = await Promise.all(
      chunk.map((id) =>
        getMessageMetadata(auth, id, headers).catch((err) => {
          if (process.env.DEBUG) console.error(`  [warn] Failed to fetch ${id}: ${err.message}`);
          failedIds.push(id);
          return null;
        })
      )
    );

    messages.push(...chunkResults.filter(Boolean));

    if (onProgress) onProgress(i + chunk.length, messageIds.length);

    const minMs = (chunk.length / METADATA_PER_SECOND) * 1000;
    const wait = minMs - (Date.now() - started);
    if (wait > 0 && i + batchSize < messageIds.length) await sleep(wait);
  }

  return { messages, failedIds };
}

// ---------------------------------------------------------------------------
// Message deletion
// ---------------------------------------------------------------------------

/**
 * Permanently delete messages using Gmail's batchDelete endpoint.
 * Automatically splits into chunks of 1000 (API maximum).
 * ⚠️  This bypasses Trash. Use trashMessages() for recoverable deletion.
 *
 * @param {import('googleapis').Auth.OAuth2Client} auth
 * @param {string[]} messageIds
 * @param {(deleted: number, total: number) => void} [onProgress]
 * @returns {Promise<{deleted: number, deletedIds: string[], failedIds: string[]}>}
 */
export async function batchDeleteMessages(auth, messageIds, onProgress) {
  const g = gmail(auth);
  const chunkSize = parseInt(process.env.BATCH_SIZE, 10) || 1000;
  let deleted = 0;

  for (let i = 0; i < messageIds.length; i += chunkSize) {
    const chunk = messageIds.slice(i, i + chunkSize);
    await withBackoff(() =>
      g.users.messages.batchDelete({
        userId: 'me',
        requestBody: { ids: chunk },
      })
    );
    deleted += chunk.length;
    if (onProgress) onProgress(deleted, messageIds.length);
  }

  // batchDelete is all-or-nothing per chunk and throws on failure
  return { deleted, deletedIds: messageIds, failedIds: [] };
}

/**
 * Move messages to Trash (recoverable for 30 days).
 * Runs in parallel batches since there is no batch-trash API endpoint.
 *
 * @param {import('googleapis').Auth.OAuth2Client} auth
 * @param {string[]} messageIds
 * Individual failures do not abort the run; they are returned in `failedIds`
 * so callers only treat messages that actually moved as trashed.
 *
 * @param {(processed: number, total: number) => void} [onProgress]
 * @returns {Promise<{trashed: number, trashedIds: string[], failedIds: string[]}>}
 */
export async function trashMessages(auth, messageIds, onProgress) {
  const g = gmail(auth);
  const batchSize = 20;
  const trashedIds = [];
  const failedIds = [];

  for (let i = 0; i < messageIds.length; i += batchSize) {
    const chunk = messageIds.slice(i, i + batchSize);
    const started = Date.now();
    const results = await Promise.all(
      chunk.map((id) =>
        withBackoff(() => g.users.messages.trash({ userId: 'me', id }))
          .then(() => true)
          .catch((err) => {
            if (process.env.DEBUG) console.error(`  [warn] Failed to trash ${id}: ${err.message}`);
            return false;
          })
      )
    );
    results.forEach((ok, j) => (ok ? trashedIds : failedIds).push(chunk[j]));
    if (onProgress) onProgress(i + chunk.length, messageIds.length);
    // Pace every batch, the last one too: callers checkpoint by calling this
    // repeatedly with slices, and the quota counts across calls
    const wait = (chunk.length / TRASH_PER_SECOND) * 1000 - (Date.now() - started);
    if (wait > 0) await sleep(wait);
  }

  return { trashed: trashedIds.length, trashedIds, failedIds };
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

/**
 * Create a Gmail filter that skips the inbox (and optionally trashes) future
 * messages from a given sender address.
 *
 * @param {import('googleapis').Auth.OAuth2Client} auth
 * @param {string} senderEmail - "from" email address to match
 * @param {object} [options]
 * @param {boolean} [options.skipInbox=true] - remove INBOX label
 * @param {boolean} [options.trash=true] - move to Trash
 * @returns {Promise<object>} the created filter resource
 */
export async function createSenderFilter(auth, senderEmail, { skipInbox = true, trash = true } = {}) {
  const g = gmail(auth);

  const action = {};
  if (skipInbox) action.removeLabelIds = ['INBOX'];
  if (trash) action.addLabelIds = ['TRASH'];

  const res = await withBackoff(() =>
    g.users.settings.filters.create({
      userId: 'me',
      requestBody: {
        criteria: { from: senderEmail },
        action,
      },
    })
  );

  return res.data;
}

/**
 * List all existing Gmail filters for the authenticated user.
 *
 * @param {import('googleapis').Auth.OAuth2Client} auth
 * @returns {Promise<object[]>} array of filter resources
 */
export async function listFilters(auth) {
  const g = gmail(auth);
  const res = await withBackoff(() =>
    g.users.settings.filters.list({ userId: 'me' })
  );
  return res.data.filter || [];
}

// ---------------------------------------------------------------------------
// Sending (for unsubscribe mailto:)
// ---------------------------------------------------------------------------

/**
 * Send an RFC 2822 email message via the Gmail API.
 * Used to hit mailto: unsubscribe links automatically.
 *
 * @param {import('googleapis').Auth.OAuth2Client} auth
 * @param {string} to - recipient email address
 * @param {string} [subject='unsubscribe']
 * @param {string} [body='Please remove me from this mailing list.']
 * @returns {Promise<void>}
 */
export async function sendEmail(auth, to, subject = 'unsubscribe', body = 'Please remove me from this mailing list.') {
  const g = gmail(auth);

  const raw = [
    `To: ${to}`,
    `Subject: ${subject}`,
    `Content-Type: text/plain; charset=utf-8`,
    ``,
    body,
  ].join('\r\n');

  const encoded = Buffer.from(raw).toString('base64url');

  await withBackoff(() =>
    g.users.messages.send({
      userId: 'me',
      requestBody: { raw: encoded },
    })
  );
}

// ---------------------------------------------------------------------------
// Profile / labels
// ---------------------------------------------------------------------------

/**
 * Return the authenticated user's Gmail address.
 *
 * @param {import('googleapis').Auth.OAuth2Client} auth
 * @returns {Promise<string>}
 */
export async function getUserEmail(auth) {
  const g = gmail(auth);
  const res = await withBackoff(() =>
    g.users.getProfile({ userId: 'me', fields: 'emailAddress' })
  );
  return res.data.emailAddress;
}

/**
 * Return the total message count for a label (default: INBOX).
 *
 * @param {import('googleapis').Auth.OAuth2Client} auth
 * @param {string} [labelId='INBOX']
 * @returns {Promise<number>}
 */
export async function getLabelMessageCount(auth, labelId = 'INBOX') {
  const g = gmail(auth);
  const res = await withBackoff(() =>
    g.users.labels.get({ userId: 'me', id: labelId, fields: 'messagesTotal' })
  );
  return res.data.messagesTotal || 0;
}
