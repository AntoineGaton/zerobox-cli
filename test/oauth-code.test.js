import { test } from 'node:test';
import assert from 'node:assert/strict';
import { codeFromPaste, isHeadless } from '../src/oauth-code.js';

test('codeFromPaste reads the code from the redirected localhost URL', () => {
  assert.equal(codeFromPaste('http://localhost:53123/?code=4/0AbC-dEf_123&scope=https://mail.google.com/'), '4/0AbC-dEf_123');
  assert.equal(codeFromPaste('  4/0AbC-dEf_123  '), '4/0AbC-dEf_123');
});

test('codeFromPaste handles addresses copied without http:// (iOS Safari)', () => {
  const pasted = 'localhost:35651/?iss=https://accounts.google.com&code=4/0AXlq-abc_123&scope=https://mail.google.com/%20https://www.googleapis.com/auth/gmail.settings.basic';
  assert.equal(codeFromPaste(pasted), '4/0AXlq-abc_123');
  assert.throws(() => codeFromPaste('localhost:35651/?error=access_denied'), /access_denied/);
});

test('codeFromPaste rejects errors, empty input and junk', () => {
  assert.throws(() => codeFromPaste('http://localhost:1/?error=access_denied'), /access_denied/);
  assert.throws(() => codeFromPaste('http://localhost:1/'), /no \?code=/);
  assert.throws(() => codeFromPaste(''), /Nothing pasted/);
  assert.throws(() => codeFromPaste('not a code'), /does not look like/);
});

test('isHeadless detects SSH, missing display and the override', () => {
  assert.equal(isHeadless({ SSH_CONNECTION: '1 2 3 4' }, 'darwin'), true);
  assert.equal(isHeadless({ ZEROBOX_NO_BROWSER: '1' }, 'win32'), true);
  assert.equal(isHeadless({}, 'linux'), true);
  assert.equal(isHeadless({ DISPLAY: ':0' }, 'linux'), false);
  assert.equal(isHeadless({}, 'win32'), false);
  assert.equal(isHeadless({ SSH_CONNECTION: '1 2 3 4', ZEROBOX_NO_BROWSER: '0' }, 'linux'), false);
});
