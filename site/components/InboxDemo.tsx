"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  bodyHeight, buildPlan, currentStage, demoData, fakeStage, initialState, layout, reduce,
  renderScreen, screenSize, stageDone, visibleRows, type Key, type Meta, type UiState,
} from "@/lib/tui-demo";

/** The sender list starts on this screen line: header, rule, column titles. */
const LIST_TOP = 3;
/** Terminal rows: enough for the wide detail pane, fewer on phones. */
const ROWS_WIDE = 24;
const ROWS_NARROW = 20;
const APPLY_MS = 1000;
const TICK_MS = 50;

const FOREVER = Date.parse("2026-10-01T12:00:00Z");

/** Browser key → the (input, key) pair Ink gives the terminal app. */
function toInk(e: KeyboardEvent): { input: string; key: Key } | null {
  const named: Record<string, Key> = {
    ArrowUp: { upArrow: true }, ArrowDown: { downArrow: true }, ArrowLeft: { leftArrow: true }, ArrowRight: { rightArrow: true },
    Enter: { return: true }, Escape: { escape: true }, Backspace: { backspace: true }, Delete: { delete: true },
    PageUp: { pageUp: true }, PageDown: { pageDown: true }, Home: { home: true }, End: { end: true },
  };
  if (e.metaKey || e.altKey) return null;
  if (named[e.key]) return { input: "", key: { ...named[e.key], shift: e.shiftKey } };
  if (e.key.length !== 1) return null;
  if (e.ctrlKey) return /^[a-z]$/i.test(e.key) ? { input: e.key.toLowerCase(), key: { ctrl: true } } : null;
  return { input: e.key, key: { shift: e.key !== e.key.toLowerCase() } };
}

/** On-screen keys for touch screens and mouse users. */
const PADS: { label: string; title: string; ev: { input: string; key: Key } }[] = [
  { label: "↑", title: "Up", ev: { input: "", key: { upArrow: true } } },
  { label: "↓", title: "Down", ev: { input: "", key: { downArrow: true } } },
  { label: "Space", title: "Select for cleanup", ev: { input: " ", key: {} } },
  { label: "A", title: "Select all in view", ev: { input: "A", key: { shift: true } } },
  { label: "Del", title: "Mark for trash", ev: { input: "", key: { delete: true } } },
  { label: "R", title: "Review", ev: { input: "R", key: { shift: true } } },
  { label: "Enter", title: "Enter", ev: { input: "", key: { return: true } } },
  { label: "Esc", title: "Escape", ev: { input: "", key: { escape: true } } },
  { label: "?", title: "Help", ev: { input: "?", key: { shift: true } } },
];

type Data = { rows: unknown[]; meta: Meta };

function freshData(): Data {
  return demoData(FOREVER);
}

/**
 * The real ZeroBox screen, running in the browser: lib/tui-demo.js is the
 * app's own screen, model and key code (bundled from src/tui/demo.js), with a
 * sample inbox. Applying a review fakes Gmail; nothing leaves the page.
 * Keys are handled only on this element, never on window/document.
 */
export function InboxDemo() {
  const boxRef = useRef<HTMLDivElement>(null);
  const probeRef = useRef<HTMLSpanElement>(null);
  const [cols, setCols] = useState(120);
  const [data, setData] = useState<Data>(freshData);
  const [state, setState] = useState<UiState>(() => initialState(data.rows));
  // The latest state for timers and handlers; update() keeps it in step
  const stateRef = useRef(state);
  // Senders a faked apply trashed or unsubscribed: gone or marked on reload, as after a real run
  const done = useRef({ trashed: new Set<string>(), unsubbed: new Set<string>() });
  const stop = useRef(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Columns that fit: the box width over one monospace cell
  useLayoutEffect(() => {
    const box = boxRef.current;
    const probe = probeRef.current;
    if (!box || !probe) return;
    const measure = () => {
      const cell = probe.getBoundingClientRect().width / 100;
      const pad = parseFloat(getComputedStyle(box).paddingLeft) + parseFloat(getComputedStyle(box).paddingRight);
      if (cell > 0) setCols(Math.max(40, Math.floor((box.clientWidth - pad) / cell)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    return () => ro.disconnect();
  }, []);

  useEffect(() => () => {
    if (timer.current) clearInterval(timer.current);
  }, []);

  const wide = layout(cols).wide;
  const size = screenSize(cols, wide ? ROWS_WIDE : ROWS_NARROW);
  const ctx = { height: bodyHeight(size.rows), wide };

  const update = useCallback((next: UiState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const resetDemo = useCallback((flash = "") => {
    if (timer.current) clearInterval(timer.current);
    done.current = { trashed: new Set(), unsubbed: new Set() };
    const fresh = freshData();
    setData(fresh);
    update({ ...initialState(fresh.rows), flash });
  }, [update]);

  /** Fake one stage of the apply: a progress bar, then the app's own result handling. */
  const apply = () => {
    const s = stateRef.current;
    const kind = currentStage(s);
    if (!kind) return;
    const plan = buildPlan(s.rows, s.marks);
    const fake = fakeStage(plan, kind);
    let ticks = 0;
    stop.current = false;
    timer.current = setInterval(() => {
      const t = Math.min(1, (++ticks * TICK_MS) / APPLY_MS);
      const total = Math.max(1, fake.total);
      if (t < 1 && !stop.current) {
        update({ ...stateRef.current, progress: { label: fake.label, done: Math.round(total * t), total, rate: total / (APPLY_MS / 1000) } });
        return;
      }
      if (timer.current) clearInterval(timer.current);
      if (kind === "trash") for (const p of plan.trash) done.current.trashed.add(p.email);
      if (kind === "unsub") for (const p of plan.unsub) if (p.method !== "web") done.current.unsubbed.add(p.email);
      update(stageDone(stateRef.current, kind, stop.current ? { ...fake.result, stopped: true } : fake.result));
    }, TICK_MS);
  };

  /** After the result screen: rows as a fresh scan would show them. */
  const reload = () => {
    const base = freshData();
    const rows = (base.rows as { email: string; count: number }[])
      .filter((r) => !done.current.trashed.has(r.email))
      .map((r) => (done.current.unsubbed.has(r.email) ? { ...r, unsubDone: true } : r));
    const meta = { ...base.meta, senderCount: rows.length, totalEmails: rows.reduce((n, r) => n + r.count, 0) };
    setData({ rows, meta });
    const s = stateRef.current;
    const marks = Object.fromEntries(Object.entries(s.marks).filter(([email]) => rows.some((r) => r.email === email)));
    const next = { ...s, rows, marks };
    update({ ...next, cursor: Math.min(next.cursor, Math.max(0, visibleRows(next).length - 1)) });
  };

  const send = (ev: { input: string; key: Key }) => {
    const { state: next, effect } = reduce(stateRef.current, ev, ctx);
    update(next);
    if (effect === "apply") apply();
    else if (effect === "reload") reload();
    else if (effect === "cancel") stop.current = true;
    else if (effect === "quit") resetDemo("Demo restarted. In your terminal, this quits ZeroBox.");
    else if (effect === "rescan") resetDemo("Demo restarted. In your terminal, this scans your Gmail again.");
    // save-settings and save-protect: the state already holds the change; there is no file to write
  };

  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Tab") return; // keep Tab for moving focus off the demo
    const ev = toInk(e);
    if (!ev) return;
    e.preventDefault();
    send(ev);
  }

  /** Click a sender line to move the cursor there; click it again to open it on narrow screens. */
  function onClick(line: number) {
    boxRef.current?.focus();
    const s = stateRef.current;
    if (s.mode !== "normal" || (s.detail && !wide)) return;
    const index = s.top + line - LIST_TOP;
    if (line < LIST_TOP || index >= visibleRows(s).length) return;
    if (index === s.cursor && !wide) send({ input: "", key: { return: true } });
    else update({ ...s, cursor: index, flash: "" });
  }

  const lines = renderScreen(state, size, { ...data.meta, now: FOREVER });

  return (
    <div className="tui-demo">
      <div
        ref={boxRef}
        className="tui-screen"
        tabIndex={0}
        onKeyDown={onKey}
        role="group"
        aria-roledescription="terminal demo"
        aria-label="ZeroBox demo with sample mail. Up and down arrows move, Space selects a sender, A selects all, Delete marks for trash, R reviews, Enter confirms, Escape goes back, question mark shows help."
      >
        <span ref={probeRef} className="tui-probe" aria-hidden="true">{"M".repeat(100)}</span>
        {lines.map((segs, i) => (
          <div key={i} className="tui-line" onClick={() => onClick(i)}>
            {segs.map((s, j) => (
              <span key={j} style={{ color: s.fg, background: s.bg, fontWeight: s.bold ? 700 : undefined }}>{s.t}</span>
            ))}
          </div>
        ))}
      </div>
      <div className="sr-only" aria-live="polite">{state.flash}</div>
      <div className="tui-pads">
        {PADS.map((p) => (
          <button key={p.label} type="button" className="key" title={p.title} onClick={() => { send(p.ev); boxRef.current?.focus(); }}>
            {p.label}
          </button>
        ))}
        <button type="button" className="key key-reset" onClick={() => { resetDemo(); boxRef.current?.focus(); }}>
          Reset demo
        </button>
      </div>
    </div>
  );
}
