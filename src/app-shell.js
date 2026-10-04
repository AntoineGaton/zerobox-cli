/**
 * @module app-shell
 * ZeroBox interactive command center.
 * Persistent REPL loop — never exits until the user chooses to.
 * Uses Ink for the home screen and menus; commands retain full stdout access.
 */

import fs from 'fs/promises';
import path from 'path';

import { error, hint, success, c } from './ui.js';
import { analyzeSenders } from './analyzer.js';
import { revokeToken, getAuthClient } from './auth.js';
import { runSetup } from './commands/setup.js';
import { getUserEmail } from './gmail.js';
import { runScan } from './commands/scan.js';
import { runClean } from './commands/clean.js';
import { runUnsubscribe } from './commands/unsubscribe.js';
import { runFilter } from './commands/filter.js';
import { runStats } from './commands/stats.js';

// Ink menus — loaded dynamically so tsx transpiles the .tsx file
const { renderMenu, renderAdvancedMenu, renderAfterAction } =
  await import('./tui/menu.tsx');

import {
  credentialsPath,
  TOKEN_PATH as TOKEN_FILE,
  CACHE_PATH as CACHE_FILE,
  LOG_PATH as LOG_FILE,
  UNSUB_STATUS_PATH as UNSUB_FILE,
} from './paths.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

async function readJson(file, fallback = null) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch { return fallback; }
}

async function fileExists(file) {
  try { await fs.access(file); return true; }
  catch { return false; }
}

function n(num) { return Number(num).toLocaleString(); }

// ── State loader ──────────────────────────────────────────────────────────────

export async function loadAppState() {
  const [hasCreds, hasToken, cache, log, unsubStatus] = await Promise.all([
    fileExists(credentialsPath()),
    fileExists(TOKEN_FILE),
    readJson(CACHE_FILE),
    readJson(LOG_FILE, { runs: [] }),
    readJson(UNSUB_FILE, {}),
  ]);

  const messages = cache?.inboxMessages ?? [];
  const senders  = messages.length
    ? analyzeSenders(messages, new Set(cache?.sentThreadIds ?? []))
    : [];

  const nuke    = senders.filter(s => s.verdict.label === 'Nuke');
  const review  = senders.filter(s => s.verdict.label === 'Review');
  const actions = senders.filter(s => s.verdict.label !== 'Keep');

  const pendingUnsub = actions
    .filter(s => s.hasUnsubscribe && !unsubStatus[s.email]?.done).length;
  const unsubDone    = Object.values(unsubStatus).filter(v => v?.done).length;

  const totalDeleted = (log?.runs ?? [])
    .reduce((sum, r) => sum + (r.totalEmails ?? r.totalDeleted ?? 0), 0);

  return {
    hasCreds,
    hasToken,
    hasScan:      Boolean(messages.length),
    scanComplete: Boolean(cache?.complete),
    scanAgeHours: cache?.timestamp
      ? Math.round((Date.now() - new Date(cache.timestamp).getTime()) / 3_600_000)
      : null,
    totalMessages: messages.length,
    senderCount:   senders.length,
    nukeCount:     nuke.length,
    reviewCount:   review.length,
    nukeEmails:    nuke.reduce((s, x) => s + x.count, 0),
    actionCount:   actions.length,
    pendingUnsub,
    unsubDone,
    cleanupRuns:   log?.runs?.length ?? 0,
    totalDeleted,
  };
}

// ── Recommendation engine ─────────────────────────────────────────────────────

export function getRecommendedAction(state) {
  if (!state.hasCreds)
    return { value: 'setup',               label: 'Finish Google setup',                      reason: 'Run the guided setup (about 5 minutes) to connect ZeroBox to Gmail.' };
  if (!state.hasToken)
    return { value: 'auth',                label: 'Connect your Gmail account',               reason: 'Authorize once to unlock the full cleanup flow.' };
  if (!state.hasScan)
    return { value: 'scan',                label: 'Run your first inbox scan',                reason: 'ZeroBox needs sender data before it can make cleanup calls.' };
  if (state.nukeCount > 0)
    return { value: 'clean-trash',         label: `Nuke ${n(state.nukeCount)} low-engagement senders`, reason: `${n(state.nukeEmails)} emails — trash mode is safe and recoverable.` };
  if (!state.scanComplete)
    return { value: 'scan',                label: 'Continue scanning your inbox',             reason: 'Partial results loaded — more coverage available.' };
  if (state.reviewCount > 0)
    return { value: 'clean-preview',       label: 'Review the cleanup queue',                 reason: `${n(state.reviewCount)} senders need a quick look.` };
  if (state.pendingUnsub > 0)
    return { value: 'unsubscribe-pending', label: 'Handle unsubscribe links',                 reason: `${n(state.pendingUnsub)} senders have List-Unsubscribe links.` };
  if (state.actionCount > 0)
    return { value: 'filter-default',      label: 'Create inbox shields',                     reason: 'Turn cleanup decisions into automatic future protection.' };
  return   { value: 'stats',               label: 'Open inbox dashboard',                     reason: 'Maintenance mode — your inbox is looking clean.' };
}

// ── After-action choices ──────────────────────────────────────────────────────

function buildAfterActionChoices(executed, state) {
  const choices = [];

  if (executed === 'scan') {
    if (state.nukeCount > 0)
      choices.push({ label: `Nuke ${n(state.nukeCount)} senders`,  detail: `${n(state.nukeEmails)} emails · trash mode`,   value: 'clean-trash' });
    if (!state.scanComplete)
      choices.push({ label: 'Keep scanning',                        detail: 'resume from where you left off',               value: 'scan' });
    if (state.pendingUnsub > 0)
      choices.push({ label: 'Unsubscribe queue',                    detail: `${n(state.pendingUnsub)} pending`,             value: 'unsubscribe-pending' });

  } else if (['clean-trash', 'clean-delete', 'clean-preview'].includes(executed)) {
    if (state.pendingUnsub > 0)
      choices.push({ label: 'Unsubscribe next',  detail: `${n(state.pendingUnsub)} pending`,          value: 'unsubscribe-pending' });
    if (state.actionCount > 0)
      choices.push({ label: 'Create filters',    detail: `${n(state.actionCount)} candidates`,        value: 'filter-default' });
    if (!state.scanComplete)
      choices.push({ label: 'Scan more',         detail: 'resume from cache',                         value: 'scan' });

  } else if (['unsubscribe-pending', 'unsubscribe-all'].includes(executed)) {
    if (state.actionCount > 0)
      choices.push({ label: 'Create filters',    detail: `${n(state.actionCount)} candidates`,        value: 'filter-default' });
    choices.push(  { label: 'Dashboard',         detail: 'review current state',                      value: 'stats' });

  } else if (['filter-default', 'filter-archive'].includes(executed)) {
    choices.push(  { label: 'Dashboard',         detail: 'see the full picture',                      value: 'stats' });
  }

  if (choices.length > 0)
    choices.push({ label: '← Back to home', detail: '', value: 'home' });

  return choices;
}

// ── Sub-command runners ───────────────────────────────────────────────────────

async function runScanMenu(state) {
  if (!state.hasScan) {
    await runScan({});
    return 'scan';
  }

  // Inline scan options via Ink
  const choice = await renderAfterAction([
    { label: state.scanComplete ? 'Use cached results' : 'Resume interrupted scan', detail: 'recommended', value: 'cached' },
    { label: 'Fresh rescan',   detail: 'discard cache · start from scratch', value: 'fresh' },
    { label: '← Back',        detail: '',                                    value: 'back'  },
  ]);

  if (choice === 'back') return null;
  await runScan({ fresh: choice === 'fresh' });
  return 'scan';
}

async function runCleanMenu(mode) {
  if (mode === 'trash')   { await runClean({ top: 50 }); return 'clean-trash'; }
  if (mode === 'delete')  { await runClean({ permanent: true, top: 50 }); return 'clean-delete'; }
  if (mode === 'preview') { await runClean({ dryRun: true, top: 50 }); return 'clean-preview'; }

  const choice = await renderAfterAction([
    { label: 'Trash mode',      detail: 'safe, recoverable for 30 days · recommended', value: 'trash'   },
    { label: 'Preview only',    detail: 'dry run, no changes',                          value: 'preview' },
    { label: 'Permanent delete',detail: 'cannot be undone',                             value: 'delete'  },
    { label: '← Back',         detail: '',                                              value: 'back'    },
  ]);

  if (choice === 'back') return null;
  return runCleanMenu(choice);
}

// ── Misc actions ──────────────────────────────────────────────────────────────

async function reconnect() {
  console.log('');
  hint('Clearing cached token and re-opening Google auth…\n');
  await revokeToken();
  await getAuthClient();
  console.log('');
  success('Account reconnected.\n');
}


// ── Action dispatcher ─────────────────────────────────────────────────────────

async function executeAction(action, state) {
  switch (action) {
    case 'scan':               return await runScanMenu(state) ?? 'home';
    case 'scan-fresh':         await runScan({ fresh: true });                         return 'scan';
    case 'clean':              return await runCleanMenu()          ?? 'home';
    case 'clean-trash':        return await runCleanMenu('trash')   ?? 'home';
    case 'clean-preview':      return await runCleanMenu('preview') ?? 'home';
    case 'clean-delete':       return await runCleanMenu('delete')  ?? 'home';
    case 'unsubscribe':
    case 'unsubscribe-pending':await runUnsubscribe({ all: false });                   return action;
    case 'unsubscribe-all':    await runUnsubscribe({ all: true });                    return action;
    case 'filter':
    case 'filter-default':     await runFilter({ nukeOnly: false, skipTrash: false }); return action;
    case 'filter-archive':     await runFilter({ nukeOnly: false, skipTrash: true });  return action;
    case 'stats':              await runStats();                                        return 'stats';
    case 'auth':               await reconnect();                                       return 'auth';
    case 'setup':              await runSetup();                                        return 'setup';
    case 'advanced':           return await renderAdvancedMenu(state);
    case 'exit':               return 'exit';
    case 'home':               return 'home';
    default: throw new Error(`Unknown action: ${action}`);
  }
}

// ── Main loop ─────────────────────────────────────────────────────────────────

async function getAccountEmail() {
  try {
    if (!await fileExists(TOKEN_FILE)) return null;
    return await getUserEmail(await getAuthClient());
  } catch { return null; }
}

export async function launchAppShell() {
  const account = await getAccountEmail();

  while (true) {
    const state = await loadAppState();
    const rec   = getRecommendedAction(state);

    if (process.stdout.isTTY) process.stdout.write('\x1Bc'); // clear

    // Ink renders home screen + menu, resolves with chosen action
    let action;
    try {
      action = await renderMenu(state, account, rec);
    } catch (err) {
      if (isPromptExit(err)) { goodbye(); return; }
      throw err;
    }

    if (action === 'exit') { goodbye(); return; }

    // Run the action (full stdout access — Ink is unmounted)
    try {
      let current = action;

      while (current && current !== 'home') {
        const executed = await executeAction(current, state);
        if (executed === 'exit') { goodbye(); return; }
        if (executed === 'home') break;

        const nextState = await loadAppState();
        const choices   = buildAfterActionChoices(executed, nextState);

        if (choices.length === 0) break;

        try {
          current = await renderAfterAction(choices);
        } catch (err) {
          if (isPromptExit(err)) { goodbye(); return; }
          throw err;
        }
      }
    } catch (err) {
      if (isPromptExit(err)) { goodbye(); return; }
      console.log('');
      error(err.message);
      hint('ZeroBox is still running — pick another path when ready.\n');
    }
  }
}

// ── Exit helpers ──────────────────────────────────────────────────────────────

function isPromptExit(err) {
  return Boolean(err && typeof err === 'object' && (
    err.name === 'ExitPromptError' ||
    err.name === 'AbortPromptError' ||
    err.code  === 'ERR_USE_AFTER_CLOSE'
  ));
}

function goodbye() {
  console.log('\n' + c.muted('  Goodbye. ✌') + '\n');
}
