# ZeroBox landing site

The marketing site for ZeroBox: a Next.js (App Router, TypeScript) app that lives in `site/`,
separate from the CLI package at the repo root. It has its own `package.json` and lockfile and is
not part of the published `zerobox-cli` package.

## Run locally

```bash
cd site
npm ci
npm run dev        # http://localhost:3000
npm run lint
npm run build && npm start
```

Without Supabase env vars the site works fully, and the waitlist form shows
"Signups are not open yet" (the API returns `503`).

## Structure

| Path | What |
|---|---|
| `app/page.tsx` | The page (server component) |
| `app/layout.tsx` | Fonts (Sora, JetBrains Mono via `next/font`), metadata, icons, Open Graph |
| `app/globals.css` | All styles, ported from the approved mock |
| `components/InboxDemo.tsx` | Interactive sample inbox (keys `j k d u w r`, scoped to the demo) |
| `components/CopyCommand.tsx` | `npx zerobox-cli` copy button |
| `components/WaitlistForm.tsx` | Waitlist form (with a honeypot field) |
| `app/api/waitlist/route.ts` | `POST /api/waitlist` |
| `public/` | Favicons, apple-touch-icon, social preview (copied from `../assets`) |

## Waitlist API

`POST /api/waitlist` with JSON `{"email": "you@example.com"}`.

| Status | Meaning |
|---|---|
| 200 `{"ok":true}` | Added, or already on the list |
| 400 | Invalid JSON or invalid email |
| 413 | Body over 1 KB |
| 503 | `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` not set |
| 500 | Supabase error (logged server-side) |

The table is created by `../supabase/migrations/002_waitlist.sql`
(`waitlist (id, email unique, created_at)`, RLS enabled, no public policies; only the
service role can write).

## Environment variables

See `.env.example`. Both are **server-only** (never prefix them with `NEXT_PUBLIC_`).

| Variable | Where to get it |
|---|---|
| `SUPABASE_URL` | Supabase dashboard → Project Settings → API → Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase dashboard → Project Settings → API keys → `service_role` secret |
| `NEXT_PUBLIC_SITE_URL` (optional) | Canonical origin for Open Graph URLs, e.g. `https://zerobox.example`. Defaults to the Vercel production URL. |

## Deploying on Vercel

1. Import the GitHub repo `AntoineGaton/zerobox-cli` as a new Vercel project.
2. Set **Root Directory** to `site`. The framework preset (Next.js), install and build
   commands are detected automatically; no `vercel.json` is needed.
3. Add `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` under Project Settings → Environment
   Variables (Production, and Preview if you want previews to accept signups).
4. Apply `supabase/migrations/002_waitlist.sql` to the Supabase project.
5. Optionally set `NEXT_PUBLIC_SITE_URL` once a custom domain is attached.

## Before launch

- The support link points at GitHub Sponsors (`LINKS.sponsor` in `lib/links.ts`).
- Docs and Changelog links point at the GitHub README and `CHANGELOG.md` (`lib/links.ts`).

## Deploy

Production is the Vercel project `zerobox` (team Code Monkey Studios), served at
https://zerobox-orpin.vercel.app. Deploy from `site/`:

```bash
cd site
vercel deploy --prod --scope code-monkey-studios
```

`og:url` comes from `VERCEL_PROJECT_PRODUCTION_URL` at build time. Set `NEXT_PUBLIC_SITE_URL`
once a custom domain exists. The npm footer link 404s until `zerobox-cli` is published to npm.
