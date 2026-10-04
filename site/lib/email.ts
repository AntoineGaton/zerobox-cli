/** Max request body accepted by POST /api/waitlist, in bytes. */
export const MAX_BODY_BYTES = 1024;

const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

/** Normalizes and validates an email. Returns null when it is obviously invalid. */
export function normalizeEmail(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const email = input.trim().toLowerCase();
  if (email.length < 6 || email.length > 254) return null;
  if (!EMAIL_RE.test(email)) return null;
  const [local, domain] = email.split("@");
  if (local.length > 64 || domain.includes("..") || domain.startsWith("-")) return null;
  return email;
}
