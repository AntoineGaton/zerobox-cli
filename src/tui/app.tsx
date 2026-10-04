/**
 * @module tui/app
 * Full-screen ZeroBox: one Ink view to browse senders, mark them, review
 * the plan and apply it. All decisions live in keys.js / view.js (pure);
 * this file wires them to the terminal and to Gmail.
 */

import React, { useEffect, useRef, useState } from 'react';
import { render, Text, Box, useApp, useInput, useStdin, useStdout } from 'ink';
import fs from 'fs';
import { spawnSync } from 'child_process';
import open from 'open';

import { VERSION } from '../version.js';
import { CACHE_PATH, credentialsPath, PROTECTED_PATH, SETTINGS_PATH, TOKEN_PATH, UNSUB_STATUS_PATH, ZEROBOX_HOME } from '../paths.js';
import { buildPlan, buildRows, bodyHeight, layout, screenSize } from './model.js';
import { currentStage, initialState, reduce, stageDone, visibleRows } from './keys.js';
import { renderScreen } from './view.js';
import { applyPlan } from '../actions.js';
import { protectFileBody } from '../protect.js';
import { loadSettings, saveSettings } from '../settings.js';

// ── Data ──────────────────────────────────────────────────────────────────────

function readJson(file: string, fallback: any) {
  try {
    return { value: JSON.parse(fs.readFileSync(file, 'utf8')), error: null };
  } catch (err: any) {
    return { value: fallback, error: err.code === 'ENOENT' ? null : err.message };
  }
}

export function loadData() {
  const { value: cache, error } = readJson(CACHE_PATH, null);
  const { value: unsub } = readJson(UNSUB_STATUS_PATH, {});
  let protectText = '';
  try { protectText = fs.readFileSync(PROTECTED_PATH, 'utf8'); } catch { /* none yet */ }
  const own = [cache?.account, cache?.email, cache?.userEmail].filter(Boolean);
  const { settings, warning: settingsWarning } = loadSettings(SETTINGS_PATH);
  const rows = buildRows(cache, unsub ?? {}, { protectText, own, settings });
  const messages = cache?.inboxMessages ?? [];
  const scannedAt = cache?.timestamp ? Date.parse(cache.timestamp) : NaN;
  return {
    rows,
    protectText,
    settings,
    own,
    settingsWarning,
    meta: {
      version: VERSION,
      account: cache?.account ?? cache?.email ?? cache?.userEmail ?? null,
      totalEmails: messages.length,
      senderCount: rows.length,
      scannedAt: Number.isFinite(scannedAt) ? scannedAt : null,
      complete: cache?.complete,
      home: ZEROBOX_HOME,
      hasCache: rows.length > 0,
      needsSetup: !fs.existsSync(credentialsPath()),
      cacheError: error,
    },
  };
}

// ── Terminal size ─────────────────────────────────────────────────────────────

function useSize() {
  const { stdout } = useStdout();
  const read = () => screenSize(stdout.columns, stdout.rows);
  const [size, setSize] = useState(read);
  useEffect(() => {
    const onResize = () => setSize(read());
    stdout.on('resize', onResize);
    return () => { stdout.off('resize', onResize); };
  }, [stdout]);
  return size;
}

// ── Gmail apply ───────────────────────────────────────────────────────────────

async function runApply(plan: any, steps: string[], onProgress: (p: any) => void, shouldStop: () => boolean) {
  // Without a saved token, auth would start an interactive sign-in under the UI
  if (!fs.existsSync(credentialsPath()) || !fs.existsSync(TOKEN_PATH)) {
    throw new Error('ZeroBox is not signed in. Quit (q) and run `zerobox auth`, then try again.');
  }
  const { getAuthClient } = await import('../auth.js');
  const gmail = await import('../gmail.js');
  const auth = await getAuthClient();
  return applyPlan(plan, {
    auth,
    trashMessages: gmail.trashMessages,
    sendEmail: gmail.sendEmail,
    createSenderFilter: gmail.createSenderFilter,
    openUrl: (url: string) => open(url),
    onProgress,
    shouldStop,
    steps,
  });
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function Line({ segs }: { segs: any[] }) {
  return (
    <Text wrap="truncate">
      {segs.map((s, i) => (
        <Text key={i} color={s.fg} backgroundColor={s.bg} bold={s.bold}>{s.t}</Text>
      ))}
    </Text>
  );
}

type Exit = 'quit' | 'rescan' | 'setup';

const CHAR_KEYS: Record<string, any> = {
  '\r': { return: true }, '\n': { return: true }, '\t': { tab: true },
  '\x1b': { escape: true }, '\x7f': { backspace: true }, '\b': { backspace: true },
};

// Ink's useInput reports Home and End as an empty key, so they are read from
// the raw input: xterm, VT220 (tmux, screen) and rxvt sequences
export const HOME_END: Record<string, 'home' | 'end'> = {
  '\x1b[H': 'home', '\x1bOH': 'home', '\x1b[1~': 'home', '\x1b[7~': 'home',
  '\x1b[F': 'end', '\x1bOF': 'end', '\x1b[4~': 'end', '\x1b[8~': 'end',
};

export function splitKeys(input: string) {
  return [...input].map((ch) => {
    if (CHAR_KEYS[ch]) return { input: '', key: CHAR_KEYS[ch] };
    // Other control characters are Ctrl+letter (Ctrl-R is \x12)
    const code = ch.charCodeAt(0);
    if (code >= 1 && code <= 26) return { input: String.fromCharCode(code + 96), key: { ctrl: true } };
    return { input: ch, key: {} };
  });
}

type Link = { email: string; url: string };

function App({ initial, onExit, onLinks }: { initial: ReturnType<typeof loadData>; onExit: (a: Exit) => void; onLinks: (l: Link[]) => void }) {
  const { exit } = useApp();
  const size = useSize();
  const [data, setData] = useState(initial);
  const [state, setState] = useState(() => ({
    ...initialState(initial.rows, {}, initial.protectText, { settings: initial.settings, own: initial.own }),
    flash: initial.settingsWarning ?? '',
  }));
  const stopRef = useRef(false);
  const stateRef = useRef(state);
  stateRef.current = state;

  const L = layout(size.cols);
  const ctx = { height: bodyHeight(size.rows), wide: L.wide };

  const update = (fn: (s: any) => any) => {
    const next = fn(stateRef.current);
    stateRef.current = next;
    setState(next);
  };

  const finish = (action: Exit) => {
    onExit(action);
    exit();
  };

  // Applies the stage under review (unsubscribe, filters or trash), then
  // moves to the next stage's review or to the result screen
  const apply = async () => {
    const kind = currentStage(stateRef.current);
    if (!kind) return;
    const plan = buildPlan(stateRef.current.rows, stateRef.current.marks);
    let result: any;
    stopRef.current = false;
    try {
      result = await runApply(plan, [kind], (progress) => update((s) => ({ ...s, progress })), () => stopRef.current);
    } catch (err: any) {
      result = { error: err.message, seconds: 0 };
    }
    if (result.unsub?.links?.length) onLinks(result.unsub.links);
    // A failed sign-in changed nothing: stageDone keeps those marks
    update((s) => stageDone(s, kind, result));
  };

  const reload = () => {
    const fresh = loadData();
    setData(fresh);
    update((s) => {
      const keep = Object.fromEntries(Object.entries(s.marks).filter(([email]) => fresh.rows.some((r) => r.email === email)));
      const next = { ...s, rows: fresh.rows, marks: keep, protectText: fresh.protectText, settings: fresh.settings, own: fresh.own };
      const total = visibleRows(next).length;
      return { ...next, cursor: Math.min(next.cursor, Math.max(0, total - 1)) };
    });
  };

  const handle = (input: string, key: any) => {
    const s = stateRef.current;
    if (!data.meta.hasCache) {
      // Enter runs the guided Google setup when there is no client yet
      if (data.meta.needsSetup && key.return) return finish('setup');
      // Ctrl-R scans; s still works as it did before
      if ((key.ctrl && input === 'r') || input === 's') return finish('rescan');
      if (input === 'q' || key.escape || (key.ctrl && input === 'c')) return finish('quit');
      return;
    }
    // Ink delivers keys that arrive together (fast typing, SSH lag, paste)
    // as one string: replay them one character at a time.
    // Some terminals report Tab as Ctrl-I
    if (key.ctrl && input === 'i') { input = ''; key = { ...key, ctrl: false, tab: true }; }
    const events = input.length > 1 && !key.ctrl && !key.meta ? splitKeys(input) : [{ input, key }];
    let cur = s;
    for (const ev of events) {
      const { state: next, effect } = reduce(cur, ev, ctx);
      cur = next;
      if (effect) {
        update(() => cur);
        if (effect === 'quit' || effect === 'rescan') {
          // Quitting mid-apply: stop after the current slice (work so far is checkpointed)
          stopRef.current = true;
          return finish(effect);
        }
        if (effect === 'apply') return void apply();
        if (effect === 'reload') return reload();
        if (effect === 'cancel') { stopRef.current = true; continue; }
        if (effect === 'save-settings') {
          try {
            saveSettings(cur.settings, SETTINGS_PATH);
          } catch (err: any) {
            cur = { ...cur, flash: `Could not save ${SETTINGS_PATH}: ${err.message}` };
          }
        }
        if (effect === 'save-protect') {
          try {
            fs.writeFileSync(PROTECTED_PATH, protectFileBody(cur.protectText));
          } catch (err: any) {
            cur = { ...cur, flash: `Could not save ${PROTECTED_PATH}: ${err.message}` };
          }
        }
      }
    }
    if (cur !== s) update(() => cur);
  };
  const handleRef = useRef(handle);
  handleRef.current = handle;

  useInput((input, key) => handleRef.current(input, key));

  const { internal_eventEmitter: inputEvents } = useStdin() as any;
  useEffect(() => {
    if (!inputEvents) return;
    const onData = (raw: string) => {
      const name = HOME_END[String(raw)];
      if (name) handleRef.current('', { [name]: true });
    };
    inputEvents.on('input', onData);
    return () => { inputEvents.off('input', onData); };
  }, [inputEvents]);

  const lines = renderScreen(state, size, { ...data.meta, now: Date.now() });
  return (
    <Box flexDirection="column" width={size.cols}>
      {lines.map((segs: any[], i: number) => <Line key={i} segs={segs} />)}
    </Box>
  );
}

// ── Launcher ──────────────────────────────────────────────────────────────────

const ALT_ON = '\x1b[?1049h\x1b[H';
const ALT_OFF = '\x1b[?1049l';
let inAlt = false;

function altScreen(on: boolean) {
  if (!process.stdout.isTTY || on === inAlt) return;
  process.stdout.write(on ? ALT_ON : ALT_OFF);
  inAlt = on;
}

process.on('exit', () => altScreen(false));

function printLinks(links: Link[]) {
  if (!links.length) return;
  console.log('\n  Finish these unsubscribes in a browser:\n');
  for (const l of links) console.log(`  ${l.email}\n  ${l.url}\n`);
}

function runOnce(): Promise<Exit> {
  return new Promise((resolve, reject) => {
    let action: Exit = 'quit';
    const links: Link[] = [];
    altScreen(true);
    const instance = render(
      <App initial={loadData()} onExit={(a) => { action = a; }} onLinks={(l) => links.push(...l)} />,
      { exitOnCtrlC: false },
    );
    instance.waitUntilExit().then(
      () => { altScreen(false); printLinks(links); resolve(action); },
      (err) => { altScreen(false); reject(err); },
    );
  });
}

/**
 * Launch the full-screen UI. Returns when the user quits.
 * Ctrl-R (rescan) leaves the UI, runs `zerobox scan` in the same terminal and
 * comes back when it succeeds. Enter on the first-run screen runs
 * `zerobox setup` the same way.
 */
export async function launchTui() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error('\n  ZeroBox needs an interactive terminal for its full-screen view.');
    console.error('  For scripts, use the subcommands: zerobox scan | clean | unsubscribe | filter | stats\n');
    process.exitCode = 1;
    return;
  }

  for (;;) {
    const action = await runOnce();
    if (action === 'setup') {
      console.log('');
      const child = spawnSync(process.execPath, [...process.execArgv, process.argv[1], 'setup'], { stdio: 'inherit' });
      if (child.status !== 0) {
        process.exitCode = child.status ?? 1;
        return;
      }
      continue;
    }
    if (action !== 'rescan') return;

    console.log('\n  Running zerobox scan. ZeroBox reopens when it finishes.\n');
    const child = spawnSync(process.execPath, [...process.execArgv, process.argv[1], 'scan'], { stdio: 'inherit' });
    if (child.status !== 0) {
      console.log('\n  The scan did not finish. Fix the issue above, then run zerobox again.\n');
      process.exitCode = child.status ?? 1;
      return;
    }
  }
}
