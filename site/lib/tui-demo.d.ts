// Types for the generated lib/tui-demo.js (see build-demo.mjs at the repo root).
// The UI state comes from src/tui/keys.js and stays loosely typed here.
/* eslint-disable @typescript-eslint/no-explicit-any */
export type Seg = { t: string; fg?: string; bg?: string; bold?: boolean };
export type Key = Partial<Record<
  "upArrow" | "downArrow" | "leftArrow" | "rightArrow" | "return" | "escape" | "tab" | "shift" | "ctrl" | "meta"
  | "backspace" | "delete" | "pageUp" | "pageDown" | "home" | "end", boolean>>;
export type UiState = any;
export type Ctx = { height: number; wide: boolean };
export type Meta = { version: string; totalEmails: number; senderCount: number; scannedAt: number; complete: boolean; now: number; hasCache: boolean };

export function demoData(now?: number): { rows: any[]; meta: Meta };
export function initialState(rows: any[]): UiState;
export function reduce(state: UiState, ev: { input: string; key: Key }, ctx: Ctx): { state: UiState; effect?: string };
export function renderScreen(state: UiState, size: { cols: number; rows: number }, meta: Meta): Seg[][];
export function screenSize(cols: number, rows: number): { cols: number; rows: number };
export function layout(cols: number): { wide: boolean };
export function bodyHeight(rows: number): number;
export function visibleRows(state: UiState): any[];
export function currentStage(state: UiState): "trash" | "unsub" | "filter" | null;
export function buildPlan(rows: any[], marks: any): any;
export function stageDone(state: UiState, kind: string, result: any): UiState;
export function fakeStage(plan: any, kind: string): { label: string; total: number; result: any };
