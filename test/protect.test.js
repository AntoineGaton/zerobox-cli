import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  builtinReason, editProtectText, looksLikeMarketing, isValidPattern, listDecision, matchEntry, parseProtectList, protectFileBody, protectReason, toggleProtectText,
} from '../src/protect.js';

// Representative senders (placeholder domains) that a volume-only score would Nuke
const MUST_PROTECT = [
  'no.reply.alerts@vanguard.example',
  'service@venmo.example',
  'invest.alerts@schwab.example',
  'statements@mail.storecard.example',
  'customer.service@servicing.discover.example',
  'alerts@services.usbank.example',
  'cardholder@inside.bigtech.example',
  'no_reply@post.card-services.example',
  'marketplace@benefits.example.gov',
  'yourhealth@healthsystem.university.example',
  'noreply@patient-portal.example',
  'account-security-noreply@accountprotection.bigtech.example',
  'noreply-accounts@bigtech.example',
  'no-reply@accounts.bigtech.example',
  'calendar-notification@bigtech.example',
  'refunds@tax.example.gov',
];

const MUST_STAY = [
  'jewelry@em.store.example',
  'contact@mailer.games.example',
  'dan@newsletter.example',
  'news@inside.bigtech.example',
  'store-noreply@bigtech.example',
  'console-noreply@bigtech.example',
  'deals@shop.example',
  'receipts@store.example',
];

const quiet = (email) => ({ email, starred: 0, replyPct: 0, openedPct: 2 });

test('built-in rules protect finance, government, health and account-security senders', () => {
  for (const email of MUST_PROTECT) assert.ok(builtinReason(quiet(email)), `${email} should be protected`);
  assert.equal(builtinReason(quiet('no.reply.alerts@vanguard.example')), 'finance');
  assert.equal(builtinReason(quiet('marketplace@benefits.example.gov')), 'government');
  assert.equal(builtinReason(quiet('yourhealth@healthsystem.university.example')), 'health');
  assert.equal(builtinReason(quiet('calendar-notification@bigtech.example')), 'account security');
});

test('marketing, newsletters and receipts are not protected', () => {
  for (const email of MUST_STAY) assert.equal(builtinReason(quiet(email)), null, `${email} should stay trashable`);
});

test('engagement protects: starred, replied, opened at least 40%, own address', () => {
  const s = (o) => ({ email: 'someone@example.com', starred: 0, replyPct: 0, openedPct: 0, ...o });
  assert.equal(builtinReason(s({ starred: 1 })), 'starred');
  assert.equal(builtinReason(s({ replyPct: 3.7, openedPct: 63 })), 'you replied');
  assert.equal(builtinReason(s({ openedPct: 40 })), 'opened 40%');
  assert.equal(builtinReason(s({ openedPct: 39.9 })), null);
  assert.equal(builtinReason(s({ openedPct: null })), null);
  assert.equal(builtinReason(s({}), { own: ['SomeOne@example.com'] }), 'your address');
});

test('protected.txt: addresses, @domains, *keywords*, comments and ! exceptions', () => {
  const list = parseProtectList(`# comment
Boss@Work.example
@school.edu   # includes subdomains

*invoice*
!news@school.edu
`);
  assert.deepEqual(list.map((e) => e.pattern), ['boss@work.example', '@school.edu', '*invoice*', 'news@school.edu']);
  assert.equal(matchEntry('@school.edu', 'a@mail.school.edu'), true);
  assert.equal(matchEntry('@school.edu', 'a@notschool.edu'), false);
  assert.equal(matchEntry('*invoice*', 'invoices@vendor.example'), true);
  assert.equal(listDecision(list, 'boss@work.example'), 'protect');
  assert.equal(listDecision(list, 'news@school.edu'), 'unprotect');
  assert.equal(listDecision(list, 'other@example.com'), null);
  // The user's exception overrides a built-in rule
  assert.equal(protectReason('service@venmo.example', 'finance', parseProtectList('!service@venmo.example')), null);
  assert.equal(protectReason('deals@shop.example', null, parseProtectList('@shop.example')), 'your list');
});

test('toggleProtectText flips one address and keeps the rest of the file', () => {
  const start = '# mine\n@family.example\n';
  // Unprotected → added
  let r = toggleProtectText(start, 'Deals@Shop.example', null);
  assert.equal(r.protected, true);
  assert.equal(r.text, '# mine\n@family.example\ndeals@shop.example\n');
  // …and back
  r = toggleProtectText(r.text, 'deals@shop.example', null);
  assert.equal(r.protected, false);
  assert.equal(r.text, start);
  // Protected by a built-in rule → an exception is added, then removed again
  r = toggleProtectText(start, 'service@venmo.example', 'finance');
  assert.equal(r.protected, false);
  assert.match(r.text, /^!service@venmo\.example$/m);
  r = toggleProtectText(r.text, 'service@venmo.example', 'finance');
  assert.equal(r.protected, true);
  assert.equal(r.text, start);
  // Protected by a domain entry → exception for just this address
  r = toggleProtectText(start, 'cousin@family.example', null);
  assert.equal(r.protected, false);
  assert.match(r.text, /^!cousin@family\.example$/m);
});

test('a new protected.txt gets an explanatory header', () => {
  assert.match(protectFileBody('a@b.example\n'), /^# ZeroBox protected senders/);
  assert.equal(protectFileBody('# own\n'), '# own\n');
});

test('editProtectText backs zerobox protect / unprotect', () => {
  let r = editProtectText('', 'Bob@Example.com', 'protect');
  assert.deepEqual(r, { text: 'bob@example.com\n', change: 'added' });
  assert.equal(editProtectText(r.text, 'bob@example.com', 'protect').change, 'unchanged');
  assert.deepEqual(editProtectText(r.text, 'bob@example.com', 'unprotect'), { text: '', change: 'removed' });
  r = editProtectText('# keep\n', 'service@venmo.example', 'unprotect');
  assert.deepEqual(r, { text: '# keep\n!service@venmo.example\n', change: 'excepted' });
  assert.deepEqual(editProtectText(r.text, 'service@venmo.example', 'protect'), { text: '# keep\nservice@venmo.example\n', change: 'added' });
  assert.equal(isValidPattern('bob@example.com'), true);
  assert.equal(isValidPattern('@example.com'), true);
  assert.equal(isValidPattern('*invoice*'), true);
  assert.equal(isValidPattern('bogus'), false);
  assert.equal(isValidPattern('!bob@example.com'), false);
});

// ── Settings ────────────────────────────────────────────────────────────────

const off = (o) => ({ settings: { protect: o } });

test('each settings toggle switches its rule off; starred and your address cannot be', () => {
  const s = (o) => ({ email: 'someone@example.com', starred: 0, replyPct: 0, openedPct: 0, ...o });
  assert.equal(builtinReason(s({ replyPct: 5 }), off({ replied: false })), null);
  assert.equal(builtinReason(s({ openedPct: 90 }), off({ opened: false })), null);
  assert.equal(builtinReason(s({ openedPct: 50 }), off({ openedMin: 60 })), null);
  assert.equal(builtinReason(s({ openedPct: 60 }), off({ openedMin: 60 })), 'opened 60%');
  assert.equal(builtinReason(s({ openedPct: 30 }), off({ openedMin: 30 })), 'opened 30%');
  assert.equal(builtinReason(quiet('refunds@tax.example.gov'), off({ government: false })), null);
  assert.equal(builtinReason(quiet('yourhealth@healthsystem.university.example'), off({ health: false })), null);
  assert.equal(builtinReason(quiet('no.reply.alerts@vanguard.example'), off({ finance: false })), null);
  assert.equal(builtinReason(quiet('noreply-accounts@bigtech.example'), off({ accountSecurity: false })), null);
  assert.equal(builtinReason(quiet('bill@nationalgrid.com'), off({ utilities: false })), null);
  assert.equal(builtinReason(quiet('bill@nationalgrid.com')), 'utilities');
  // Turning one category off leaves the others alone
  assert.equal(builtinReason(quiet('refunds@tax.example.gov'), off({ finance: false })), 'government');
  // A finance address that also matches account security keeps that reason
  assert.equal(builtinReason(quiet('security@vanguard.example'), off({ finance: false })), 'account security');
  // Always on, whatever the settings say
  const all = off({ replied: false, opened: false, government: false, health: false, finance: false, accountSecurity: false, utilities: false });
  assert.equal(builtinReason(s({ starred: 2 }), all), 'starred');
  assert.equal(builtinReason(s({}), { ...all, own: ['someone@example.com'] }), 'your address');
  // The whole settings object or only its protect part both work
  assert.equal(builtinReason(quiet('refunds@tax.example.gov'), { settings: { government: false } }), null);
});

// Finance senders (placeholder domains), by what financeMarketing=false should do
const FINANCE_MARKETING = [
  'lender@m.ally.example',
  'rewards@info15.pnc.example',
  'storecard@info16.amex.example',
  'info@emails.usbank.example',
  'noreply@news.venmo.example',
];
const FINANCE_ACCOUNT = [
  'no.reply.alerts@vanguard.example',
  'service@venmo.example',
  'invest.alerts@schwab.example',
  'statements@mail.storecard.example',
  'customer.service@servicing.discover.example',
  'cardholder@inside.bigtech.example',
  // notification-style senders carry payment alerts: kept on purpose
  'wellsfargo@notification.wellsfargo.example',
  'vanguard@fraudalert.vanguard.example',
];

test('financeMarketing off unprotects finance marketing, keeps account mail', () => {
  for (const email of FINANCE_MARKETING) {
    assert.equal(builtinReason(quiet(email)), 'finance', `${email} is protected by default`);
    assert.equal(builtinReason(quiet(email), off({ financeMarketing: false })), null, `${email} should be unprotected`);
    assert.equal(looksLikeMarketing(email), true, email);
  }
  for (const email of FINANCE_ACCOUNT) {
    assert.equal(builtinReason(quiet(email), off({ financeMarketing: false })), 'finance', `${email} should stay protected`);
    assert.equal(looksLikeMarketing(email), false, email);
  }
});

test('financeMarketing on (the default) changes nothing', () => {
  for (const email of [...MUST_PROTECT, ...FINANCE_MARKETING]) {
    assert.equal(builtinReason(quiet(email), off({ financeMarketing: true })), builtinReason(quiet(email)), email);
  }
  for (const email of MUST_STAY) assert.equal(builtinReason(quiet(email), off({ financeMarketing: true })), null);
});

test('financeMarketing only touches finance: engagement and other rules still protect', () => {
  const s = { email: 'lender@m.ally.example', starred: 0, replyPct: 2, openedPct: 0 };
  assert.equal(builtinReason(s, off({ financeMarketing: false })), 'you replied');
  assert.equal(builtinReason(quiet('newsletter@health.example'), off({ financeMarketing: false })), 'health');
});

test('protected.txt still overrides the settings both ways', () => {
  const builtin = builtinReason(quiet('lender@m.ally.example'), off({ financeMarketing: false }));
  assert.equal(protectReason('lender@m.ally.example', builtin, parseProtectList('@ally.example')), 'your list');
  const bank = builtinReason(quiet('no.reply.alerts@vanguard.example'), off({ financeMarketing: false }));
  assert.equal(protectReason('no.reply.alerts@vanguard.example', bank, parseProtectList('!no.reply.alerts@vanguard.example')), null);
});
