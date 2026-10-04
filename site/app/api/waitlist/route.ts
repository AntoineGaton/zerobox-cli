import { createClient } from "@supabase/supabase-js";
import { MAX_BODY_BYTES, normalizeEmail } from "@/lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(status: number, body: Record<string, unknown>) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return json(503, { ok: false, error: "waitlist_closed", message: "Signups are not open yet." });
  }

  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) {
    return json(413, { ok: false, error: "too_large", message: "Request body too large." });
  }
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) {
    return json(413, { ok: false, error: "too_large", message: "Request body too large." });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json(400, { ok: false, error: "bad_json", message: "Send JSON: {\"email\": \"you@example.com\"}." });
  }
  if (!body || typeof body !== "object") {
    return json(400, { ok: false, error: "bad_json", message: "Send JSON: {\"email\": \"you@example.com\"}." });
  }
  const { email: rawEmail, website } = body as { email?: unknown; website?: unknown };

  // Honeypot: real users never see or fill the "website" field. Pretend success.
  if (typeof website === "string" && website.trim() !== "") {
    return json(200, { ok: true });
  }

  const email = normalizeEmail(rawEmail);
  if (!email) {
    return json(400, { ok: false, error: "invalid_email", message: "That email address doesn't look right." });
  }

  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await supabase.from("waitlist").insert({ email });
  // 23505 = unique_violation: already on the list, which is a success for the visitor.
  if (error && error.code !== "23505") {
    console.error("waitlist insert failed", error.code, error.message);
    return json(500, { ok: false, error: "server_error", message: "Something went wrong. Try again later." });
  }
  return json(200, { ok: true });
}

export function GET() {
  return json(405, { ok: false, error: "method_not_allowed" });
}
