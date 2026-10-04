import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  DEFAULT_PROTECT, clampOpenedMin, loadSettings, mergeSettings, parseSettingValue, saveSettings,
} from '../src/settings.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'zerobox-settings-'));

test('a missing file gives the defaults without a warning', () => {
  const { settings, warning } = loadSettings(path.join(tmp(), 'settings.json'));
  assert.deepEqual(settings, { protect: { ...DEFAULT_PROTECT } });
  assert.equal(warning, null);
});

test('missing keys fall back to defaults, wrong types are ignored, unknown keys are kept', () => {
  const s = mergeSettings({ theme: 'dark', protect: { finance: false, opened: 'nope', openedMin: 7, future: 1 } });
  assert.equal(s.protect.finance, false);
  assert.equal(s.protect.opened, true);
  assert.equal(s.protect.openedMin, 10); // clamped
  assert.equal(s.protect.health, true);
  assert.equal(s.protect.future, 1);
  assert.equal(s.theme, 'dark');
  assert.deepEqual(mergeSettings(null).protect, DEFAULT_PROTECT);
  assert.deepEqual(mergeSettings({ protect: [] }).protect, DEFAULT_PROTECT);
});

test('a corrupt file falls back to the defaults with a one-line warning', () => {
  const dir = tmp();
  const file = path.join(dir, 'settings.json');
  for (const body of ['{ not json', '[1,2]', '"text"', '']) {
    fs.writeFileSync(file, body);
    const { settings, warning } = loadSettings(file);
    assert.deepEqual(settings.protect, DEFAULT_PROTECT);
    assert.match(warning, /not valid JSON; using default settings/);
    assert.ok(!warning.includes('\n'));
  }
});

test('saving is atomic, private (0600) and keeps unknown keys', () => {
  const dir = tmp();
  const file = path.join(dir, 'settings.json');
  fs.writeFileSync(file, JSON.stringify({ theme: 'dark', protect: { future: 'x' } }), { mode: 0o644 });
  const { settings } = loadSettings(file);
  settings.protect.financeMarketing = false;
  saveSettings(settings, file);
  const back = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(back.theme, 'dark');
  assert.equal(back.protect.future, 'x');
  assert.equal(back.protect.financeMarketing, false);
  assert.equal(back.protect.openedMin, 40);
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  // No temp files left behind
  assert.deepEqual(fs.readdirSync(dir), ['settings.json']);
  assert.deepEqual(loadSettings(file).settings, back);
});

test('a failed save leaves the old file and no temp file', () => {
  const dir = tmp();
  const file = path.join(dir, 'settings.json');
  saveSettings({ protect: { finance: false } }, file);
  // Renaming onto a directory fails
  const blocked = path.join(dir, 'blocked');
  fs.mkdirSync(path.join(blocked, 'x'), { recursive: true });
  assert.throws(() => saveSettings({}, blocked));
  assert.deepEqual(fs.readdirSync(dir).sort(), ['blocked', 'settings.json']);
  assert.equal(loadSettings(file).settings.protect.finance, false);
});

test('parseSettingValue validates keys and values for the CLI', () => {
  assert.deepEqual(parseSettingValue('financeMarketing', 'off'), { key: 'financeMarketing', value: false });
  assert.deepEqual(parseSettingValue('FINANCE', 'true'), { key: 'finance', value: true });
  assert.deepEqual(parseSettingValue('protect.openedMin', '55'), { key: 'openedMin', value: 55 });
  assert.throws(() => parseSettingValue('openedMin', '5'), /10 to 100/);
  assert.throws(() => parseSettingValue('openedMin', '4.5'), /whole number/);
  assert.throws(() => parseSettingValue('starred', 'false'), /Unknown setting "starred"/);
  assert.throws(() => parseSettingValue('health', 'maybe'), /true or false/);
  assert.equal(clampOpenedMin(103), 100);
  assert.equal(clampOpenedMin(42.4), 42);
});
