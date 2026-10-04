"use client";

import { useState, type FormEvent } from "react";

type Phase = "idle" | "sending" | "joined";

const LOOKS_LIKE_EMAIL = /.+@.+\..+/;

export function WaitlistForm() {
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");

  async function join(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (phase === "sending") return;
    if (!LOOKS_LIKE_EMAIL.test(email.trim())) {
      setError("Enter a valid email address.");
      return;
    }
    setError("");
    setPhase("sending");
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), website }),
      });
      if (res.ok) {
        setPhase("joined");
        return;
      }
      if (res.status === 503) setError("Signups are not open yet.");
      else if (res.status === 400) setError("That email address doesn't look right.");
      else setError("Something went wrong. Try again later.");
    } catch {
      setError("Network error. Try again.");
    }
    setPhase("idle");
  }

  if (phase === "joined") {
    return (
      <div className="wl-done" role="status">
        You&apos;re on the list.
      </div>
    );
  }

  return (
    <form className="wl-form" onSubmit={join} noValidate>
      <div className="wl-row">
        <label className="wl-label">
          Email
          <input
            className="wl-input"
            type="email"
            name="email"
            autoComplete="email"
            required
            maxLength={254}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "wl-err" : undefined}
          />
        </label>
        <div className="wl-hp" aria-hidden="true">
          <label>
            Website
            <input type="text" name="website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
          </label>
        </div>
        <button className="wl-submit cta" type="submit" disabled={phase === "sending"}>
          {phase === "sending" ? "Joining…" : "Join the waitlist →"}
        </button>
      </div>
      <p id="wl-err" className="wl-err" role="alert">
        {error}
      </p>
    </form>
  );
}
