"use client";

import { useEffect, useRef, useState } from "react";

const COMMAND = "npx zerobox-cli";

export function CopyCommand({ id }: { id?: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  async function copy() {
    try {
      await navigator.clipboard?.writeText(COMMAND);
    } catch {
      // Clipboard can be blocked (insecure context, permissions). The command is visible either way.
    }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1600);
  }

  return (
    <div id={id} className="cmd">
      <code>
        <span className="accent">$</span> {COMMAND}
      </code>
      <button className="copy-btn" type="button" onClick={copy} aria-label={copied ? "Copied to clipboard" : `Copy ${COMMAND}`}>
        {copied ? "Copied" : "Copy"}
      </button>
      <span className="sr-only" aria-live="polite">
        {copied ? "Command copied to clipboard" : ""}
      </span>
    </div>
  );
}
