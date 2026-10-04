"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Logo } from "./Logo";
import { DATA, UNSUB, VCOLOR, fmt } from "@/lib/demo-data";

type Flags = Record<string, true>;
type State = {
  sel: number;
  trash: Flags;
  unsub: Flags;
  gone: Flags;
  unsubbed: Flags;
  msg: string;
  /** R was pressed: the plan is shown and waits for Enter (apply) or Esc. */
  confirm: boolean;
};

const INITIAL: State = { sel: 0, trash: {}, unsub: {}, gone: {}, unsubbed: {}, msg: "", confirm: false };

/**
 * Interactive sample inbox, with the same familiar keys as the terminal app:
 * ↑ ↓ move, Space selects for cleanup (unsubscribe + trash), Delete trashes,
 * U unsubscribes, R reviews and Enter applies. Esc cancels the review, or
 * resets the demo. The Vim keys j k d u w work too.
 * Keyboard shortcuts are handled only on this element (onKeyDown on the
 * terminal frame), never on window/document.
 */
export function InboxDemo() {
  const [s, setS] = useState<State>(INITIAL);
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const focusRow = useRef(false);

  const vis = DATA.filter((d) => !s.gone[d.id]);
  const sel = Math.max(0, Math.min(s.sel, vis.length - 1));
  const cur = vis[sel] ?? null;

  let tN = 0;
  let tE = 0;
  let uN = 0;
  for (const d of vis) {
    if (s.trash[d.id]) {
      tN++;
      tE += d.count;
    }
    if (s.unsub[d.id]) uN++;
  }
  const total = vis.reduce((a, d) => a + d.count, 0);

  // Keep keyboard focus on the highlighted row when j/k moves the selection.
  useEffect(() => {
    if (focusRow.current) {
      focusRow.current = false;
      rowRefs.current[sel]?.focus();
    }
  }, [sel]);

  const patch = (p: Partial<State>) => setS((prev) => ({ ...prev, ...p }));

  function toggle(key: "trash" | "unsub") {
    if (!cur) return;
    if (cur.verdict === "Protect") {
      patch({ msg: "Protected: bank, health and account mail is never bulk-trashed or unsubscribed.", confirm: false });
      return;
    }
    if (key === "unsub" && cur.unsub === "none") {
      patch({ msg: "No unsubscribe link for this sender. Account mail usually has none.", confirm: false });
      return;
    }
    const m: Flags = { ...s[key] };
    if (m[cur.id]) delete m[cur.id];
    else m[cur.id] = true;
    patch({ [key]: m, msg: "", confirm: false });
  }

  /** Space: select for cleanup (unsubscribe + trash), or unselect. */
  function select() {
    if (!cur) return;
    if (cur.verdict === "Protect") {
      patch({ msg: "Protected: bank, health and account mail is never bulk-trashed or unsubscribed.", confirm: false });
      return;
    }
    const canUnsub = cur.unsub !== "none" && !s.unsubbed[cur.id];
    const on = !(s.trash[cur.id] && (!canUnsub || s.unsub[cur.id]));
    const trash: Flags = { ...s.trash };
    const unsub: Flags = { ...s.unsub };
    if (on) {
      trash[cur.id] = true;
      if (canUnsub) unsub[cur.id] = true;
    } else {
      delete trash[cur.id];
      delete unsub[cur.id];
    }
    patch({ trash, unsub, msg: "", confirm: false });
  }

  /** R: show what will happen; Enter applies it. */
  function review() {
    if (!tN && !uN) {
      patch({ msg: "Nothing selected yet. Press Space on a sender first.", confirm: false });
      return;
    }
    const parts = [uN && `unsubscribe from ${uN}`, tN && `move ${fmt(tE)} emails to Trash`].filter(Boolean).join(" and ");
    patch({ msg: `${parts.charAt(0).toUpperCase()}${parts.slice(1)}? Enter do it · Esc cancel`, confirm: true });
  }

  function apply() {
    if (!tN && !uN) return;
    const gone: Flags = { ...s.gone };
    const unsubbed: Flags = { ...s.unsubbed };
    for (const d of vis) {
      if (s.trash[d.id]) gone[d.id] = true;
      if (s.unsub[d.id]) unsubbed[d.id] = true;
    }
    setS({
      gone,
      unsubbed,
      trash: {},
      unsub: {},
      sel: 0,
      msg: `Moved ${fmt(tE)} emails to Trash and unsubscribed from ${uN}. Restore any time in the next 30 days.`,
      confirm: false,
    });
  }

  const reset = () => setS(INITIAL);

  function move(delta: number) {
    focusRow.current = rowRefs.current.includes(document.activeElement as HTMLButtonElement);
    patch({ sel: Math.max(0, Math.min(vis.length - 1, sel + delta)), msg: "", confirm: false });
  }

  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;
    let handled = true;
    if (k === "ArrowDown" || k === "j") move(1);
    else if (k === "ArrowUp" || k === "k") move(-1);
    else if (k === " ") select();
    else if (k === "Delete" || k === "Backspace" || k === "d") toggle("trash");
    else if (k === "u" || k === "U") toggle("unsub");
    else if (k === "r" || k === "R" || k === "w") review();
    else if (k === "Enter" && s.confirm) apply();
    else if (k === "Escape") {
      if (s.confirm) patch({ msg: "Nothing changed. Your selection is kept.", confirm: false });
      else reset();
    } else handled = false;
    if (handled) e.preventDefault();
  }

  const status = tN || uN ? `${tN} marked → trash ${fmt(tE)} · unsub ${uN}` : "nothing marked";
  const posStr = vis.length ? `${sel + 1}/${vis.length}` : "0/0";

  return (
    // The frame is focusable so the shortcuts work before a row is clicked.
    <div
      className="tui"
      tabIndex={0}
      onKeyDown={onKey}
      role="group"
      aria-label="ZeroBox demo inbox. Keys: up and down arrows move, Space selects a sender for cleanup, Delete marks for trash, U marks for unsubscribe, R reviews and Enter applies, Escape resets."
    >
      <div className="tui-top">
        <span className="tui-top-l">
          <Logo width={20} height={15} />
          <span className="bright">zerobox</span> demo@example.com
        </span>
        <span>{fmt(total)} emails · sample data</span>
      </div>
      <div className="tui-grid">
        <div className="tui-list">
          <div className="tui-cols tui-head" aria-hidden="true">
            <span />
            <span>Sender</span>
            <span className="r">Emails</span>
            <span className="r">Read</span>
            <span className="r">Verdict</span>
          </div>
          {vis.map((d, i) => {
            const isT = !!s.trash[d.id];
            const isU = !!s.unsub[d.id];
            const mark = isT && isU ? "du" : isT ? "d" : isU ? "u" : "·";
            const markColor = isT ? "#FF8A7A" : isU ? "#28EAEC" : "#4A525C";
            const marked = [isT && "marked for trash", isU && "marked to unsubscribe"].filter(Boolean).join(", ");
            return (
              <button
                key={d.id}
                ref={(el) => {
                  rowRefs.current[i] = el;
                }}
                className="row-btn tui-cols"
                type="button"
                aria-current={i === sel ? "true" : undefined}
                aria-label={`${d.name}, ${fmt(d.count)} emails, ${d.read}% read, verdict ${d.verdict}${marked ? `, ${marked}` : ""}`}
                onClick={() => patch({ sel: i, msg: "", confirm: false })}
              >
                <span className="row-mark" style={{ color: markColor }}>
                  {mark}
                </span>
                <span className="ellipsis">{d.name}</span>
                <span className="r">{fmt(d.count)}</span>
                <span className="r c-2">{d.read}%</span>
                <span className="r" style={{ color: VCOLOR[d.verdict] }}>
                  {d.verdict}
                </span>
              </button>
            );
          })}
          {vis.length === 0 && <div className="tui-empty">Inbox zero. Press Esc to reset the demo.</div>}
        </div>
        <div className="tui-detail">
          {cur && (
            <>
              <div className="det-head">
                <div className="det-name">{cur.name}</div>
                <div className="det-addr">{cur.addr}</div>
              </div>
              <dl className="det-grid">
                <dt>emails</dt>
                <dd>{fmt(cur.count)}</dd>
                <dt>opened</dt>
                <dd>{cur.read}%</dd>
                <dt>verdict</dt>
                <dd style={{ color: VCOLOR[cur.verdict] }}>{cur.verdict}</dd>
                <dt>unsubscribe</dt>
                <dd>{s.unsubbed[cur.id] ? "unsubscribed ✓" : UNSUB[cur.unsub]}</dd>
              </dl>
              <div className="det-sub-h">Recent subjects</div>
              <ul className="det-subs">
                {cur.subjects.map((t) => (
                  <li key={t} className="ellipsis">
                    · {t}
                  </li>
                ))}
              </ul>
            </>
          )}
          <div className="keys">
            <button className="key" type="button" onClick={select}>
              <span className="c-red">Space</span> select
            </button>
            <button className="key" type="button" onClick={() => toggle("trash")}>
              <span className="c-red">Delete</span> trash
            </button>
            <button className="key" type="button" onClick={() => toggle("unsub")}>
              <span className="accent">U</span> unsubscribe
            </button>
            {s.confirm ? (
              <button className="key key-apply" type="button" onClick={apply}>
                <span className="accent">Enter</span> do it
              </button>
            ) : (
              <button className="key key-apply" type="button" onClick={review}>
                <span className="accent">R</span> review
              </button>
            )}
            <button className="key key-reset" type="button" onClick={reset}>
              Esc reset
            </button>
          </div>
        </div>
      </div>
      <div aria-live="polite">{s.msg && <div className="tui-msg">{s.msg}</div>}</div>
      <div className="tui-status">
        <span className="mode">NORMAL</span>
        <span className="st-main" aria-live="polite">
          {status}
        </span>
        <span className="st-help">↑↓ move · Space select · R review</span>
        <span className="st-pos">{posStr}</span>
      </div>
    </div>
  );
}
