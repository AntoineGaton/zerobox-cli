/**
 * @module tui/menu
 * Ink-based interactive menu for ZeroBox.
 */

import React from 'react';
import { render, Box, Text } from 'ink';
import SelectInput from 'ink-select-input';
import { VERSION } from '../version.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AppState {
  hasCreds: boolean; hasToken: boolean; hasScan: boolean;
  scanComplete: boolean; scanAgeHours: number | null;
  totalMessages: number; senderCount: number;
  nukeCount: number; reviewCount: number; nukeEmails: number;
  actionCount: number; pendingUnsub: number;
  unsubDone: number; cleanupRuns: number; totalDeleted: number;
}

export interface Rec { value: string; label: string; reason: string; }

// ── Constants ─────────────────────────────────────────────────────────────────

const SEP     = '\x00';
const LABEL_W = 24;

// ── Helpers ───────────────────────────────────────────────────────────────────

function n(num: number) { return Number(num).toLocaleString(); }
// Some terminals report 0 columns; fall back to 80 and never go below 40
function cols()         { return Math.max(40, Math.min(process.stdout.columns || 80, 110)); }
function sep(extra = '') { return { label: `---${extra}`, value: `---${extra}` }; }
function mitem(label: string, detail = '', disabled = false) {
  const d = disabled ? `[${detail || 'unavailable'}]` : detail;
  return { label: label + SEP + d, value: label };
}

// ── Ink components ────────────────────────────────────────────────────────────

function Divider({ light = false }: { light?: boolean }) {
  return <Text dimColor>{'  ' + (light ? '·'.repeat(cols() - 4) : '─'.repeat(cols() - 4))}</Text>;
}

/** Full-width row highlight on selection — the Lipgloss effect */
function MenuItem({ isSelected = false, label }: { isSelected?: boolean; label: string }) {
  if (label.startsWith('---')) {
    return <Box paddingLeft={4}><Text dimColor>{'────────────'}</Text></Box>;
  }

  const [main = '', rawDetail = ''] = label.split(SEP);
  const isDisabled = rawDetail.startsWith('[') && rawDetail.endsWith(']');
  const detail = isDisabled ? rawDetail.slice(1, -1) : rawDetail;
  const isRec = main.startsWith('→ ');

  if (isSelected && !isDisabled) {
    // Pad to full terminal width for a solid highlight bar
    const indicator = '❯ ';
    const mainStrip = main;
    const lpad = ' '.repeat(Math.max(1, LABEL_W - mainStrip.length));
    const content = `  ${indicator}${mainStrip}${lpad}${detail}`;
    const fill = ' '.repeat(Math.max(0, cols() - content.length));
    return (
      <Text backgroundColor="cyan" color="black" bold>
        {content + fill}
      </Text>
    );
  }

  const lpad = ' '.repeat(Math.max(1, LABEL_W - main.length));

  return (
    <Box>
      <Text dimColor={isDisabled} color={isRec ? 'cyan' : isDisabled ? undefined : 'white'}>
        {'    ' + main}
      </Text>
      <Text>{lpad}</Text>
      {detail && (
        <Text dimColor color={isDisabled ? 'red' : undefined}>
          {detail}
        </Text>
      )}
    </Box>
  );
}

// Zero-width indicator — handled inside MenuItem
function Indicator() { return null as any; }

// ── Status badges ─────────────────────────────────────────────────────────────

function Badge({ label, color }: { label: string; color: string }) {
  return (
    <Text backgroundColor={color} color="black" bold>
      {` ${label} `}
    </Text>
  );
}

function StatusSection({ state }: { state: AppState }) {
  if (!state.hasScan) {
    return (
      <Box paddingLeft={2} paddingY={1}>
        <Text dimColor>No scan yet — choose </Text>
        <Text color="cyan">Scan inbox</Text>
        <Text dimColor> to start</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingLeft={2} paddingY={1} gap={0}>
      {/* Row 1: scan stats + badges */}
      <Box gap={2} alignItems="center">
        <Text bold color="white">{n(state.totalMessages)}</Text>
        <Text dimColor>scanned</Text>
        {state.nukeCount > 0 && (
          <><Text dimColor>·</Text><Badge label={`${n(state.nukeCount)} NUKE`} color="red" /></>
        )}
        {state.reviewCount > 0 && (
          <><Text dimColor>·</Text><Badge label={`${n(state.reviewCount)} REVIEW`} color="yellow" /></>
        )}
        {state.scanAgeHours !== null && (
          <><Text dimColor>·</Text><Text dimColor>{state.scanAgeHours}h old</Text></>
        )}
      </Box>

      {/* Row 2: cleanup progress */}
      {(state.totalDeleted > 0 || state.unsubDone > 0) && (
        <Box gap={2} marginTop={0}>
          {state.totalDeleted > 0 && (
            <><Text color="green" bold>{n(state.totalDeleted)}</Text><Text dimColor>deleted</Text></>
          )}
          {state.unsubDone > 0 && (
            <><Text dimColor>·</Text><Text color="green" bold>{n(state.unsubDone)}</Text><Text dimColor>unsubscribed</Text></>
          )}
        </Box>
      )}
    </Box>
  );
}

// ── Home screen ───────────────────────────────────────────────────────────────

function HomeScreen({ state, account, rec, items, onSelect }: {
  state: AppState; account: string | null; rec: Rec;
  items: Array<{ label: string; value: string }>;
  onSelect: (value: string) => void;
}) {
  const c = cols();
  const left = `  ◆ ZeroBox  v${VERSION}`;
  const right = account ? account + '  ' : '';
  const gap = ' '.repeat(Math.max(1, c - left.length - right.length));

  return (
    <Box flexDirection="column">
      {/* Header */}
      <Box>
        <Text bold color="cyan">{'  ◆ ZeroBox'}</Text>
        <Text dimColor>{`  v${VERSION}`}</Text>
        <Text>{gap}</Text>
        <Text dimColor>{right}</Text>
      </Box>

      <Divider />
      <StatusSection state={state} />
      <Divider />

      {/* Recommendation */}
      <Box flexDirection="column" paddingLeft={2} paddingTop={1} paddingBottom={1}>
        <Box gap={2}>
          <Text dimColor>Recommended</Text>
          <Text color="cyan" bold>→</Text>
          <Text bold color="white">{rec.label}</Text>
        </Box>
        <Box paddingLeft={14}>
          <Text dimColor>{rec.reason}</Text>
        </Box>
      </Box>

      <Divider />

      {/* Prompt */}
      <Box paddingLeft={2} paddingTop={1} paddingBottom={1}>
        <Text dimColor>What do you want to do?</Text>
      </Box>

      {/* Menu */}
      <SelectInput
        items={items}
        onSelect={({ value }) => {
          if (value.startsWith('---')) return;
          onSelect(value);
        }}
        itemComponent={MenuItem}
        indicatorComponent={Indicator}
        limit={12}
      />

      <Box paddingBottom={1} />
    </Box>
  );
}

// ── After-action / sub-menu screen ────────────────────────────────────────────

function ChoiceScreen({ prompt, choices, onSelect }: {
  prompt: string;
  choices: Array<{ label: string; detail: string; value: string }>;
  onSelect: (value: string) => void;
}) {
  const items = choices.map(c => ({
    label: c.label + SEP + c.detail,
    value: c.value,
  }));

  return (
    <Box flexDirection="column">
      <Box paddingLeft={2} paddingY={1}>
        <Text dimColor>{prompt}</Text>
      </Box>
      <SelectInput
        items={items}
        onSelect={({ value }) => onSelect(value)}
        itemComponent={MenuItem}
        indicatorComponent={Indicator}
      />
      <Box paddingBottom={1} />
    </Box>
  );
}

// ── Item builders ─────────────────────────────────────────────────────────────

export function buildMainMenuItems(state: AppState, rec: Rec) {
  const noScan   = !state.hasScan;
  const noCreds  = !state.hasCreds;
  const recShort = rec.reason.length > 46 ? rec.reason.slice(0, 45) + '…' : rec.reason;

  return [
    { label: `→ ${rec.label}${SEP}${recShort}`, value: '__rec__' },
    sep(),
    mitem('Scan inbox',
      state.hasScan
        ? `${n(state.totalMessages)} msgs · ${state.scanComplete ? 'complete' : 'partial'}`
        : 'first scan',
      noCreds),
    mitem('Nuke senders',  `${n(state.nukeCount)} senders · ${n(state.nukeEmails)} emails`, noScan),
    mitem('Unsubscribe',   `${n(state.pendingUnsub)} pending`,     noScan),
    mitem('Create filters',`${n(state.actionCount)} candidates`,   noScan),
    mitem('Dashboard',     'live counts · trends · history',       noCreds),
    sep('2'),
    mitem('Advanced',      'preview · perm. delete · re-auth'),
    mitem('Exit',          ''),
  ];
}

export function buildAdvancedMenuItems(state: AppState) {
  return [
    mitem('Preview cleanup plan',    'dry run — no changes made'),
    mitem('Permanent delete',        '⚠  bypasses Trash, cannot undo'),
    mitem('Re-process unsubscribes', 'including already-handled senders'),
    mitem('Archive-only filters',    'skip inbox, keep in All Mail'),
    mitem('Fresh rescan',            'discard cache · start over', !state.hasCreds),
    sep(),
    mitem('Reconnect account',       'clear token · re-authorize'),
    mitem('Google setup',            'connect ZeroBox to Gmail'),
    sep('2'),
    mitem('← Back',                  ''),
  ];
}

// ── Public API ────────────────────────────────────────────────────────────────

export function renderMenu(state: AppState, account: string | null, rec: Rec): Promise<string> {
  const items = buildMainMenuItems(state, rec);

  return new Promise(resolve => {
    const { unmount } = render(
      <HomeScreen
        state={state}
        account={account}
        rec={rec}
        items={items}
        onSelect={value => {
          unmount();
          resolve(value === '__rec__' ? rec.value : value);
        }}
      />
    );
  });
}

export function renderAdvancedMenu(state: AppState): Promise<string> {
  const items = buildAdvancedMenuItems(state);

  return new Promise(resolve => {
    const { unmount } = render(
      <ChoiceScreen
        prompt="Advanced options"
        choices={items.map(i => {
          const [label = '', detail = ''] = i.label.split(SEP);
          return { label, detail, value: i.value };
        })}
        onSelect={value => {
          unmount();
          resolve(value);
        }}
      />
    );
  });
}

export function renderAfterAction(
  choices: Array<{ label: string; detail: string; value: string }>
): Promise<string> {
  if (choices.length === 0) return Promise.resolve('home');

  return new Promise(resolve => {
    const { unmount } = render(
      <ChoiceScreen
        prompt="What's next?"
        choices={choices}
        onSelect={value => {
          unmount();
          resolve(value);
        }}
      />
    );
  });
}
