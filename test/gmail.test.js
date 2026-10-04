import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isTransientError } from '../src/gmail.js';

// Shapes observed from googleapis/gaxios against the real Gmail API
const gmailError = (status, reason) => ({ code: status, status, response: { status }, errors: [{ reason }] });

test('Gmail 403 rate limits are retried', () => {
  assert.equal(isTransientError(gmailError(403, 'rateLimitExceeded')), true);
  assert.equal(isTransientError(gmailError(403, 'userRateLimitExceeded')), true);
});

test('429 and 5xx are retried, real permission errors are not', () => {
  assert.equal(isTransientError(gmailError(429, 'rateLimitExceeded')), true);
  assert.equal(isTransientError(gmailError(503, 'backendError')), true);
  assert.equal(isTransientError(gmailError(403, 'insufficientPermissions')), false);
  assert.equal(isTransientError(gmailError(404, 'notFound')), false);
});

test('network resets are retried', () => {
  assert.equal(isTransientError({ code: 'ECONNRESET' }), true);
});
