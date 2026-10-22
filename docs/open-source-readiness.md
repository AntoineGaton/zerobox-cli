# Open-source readiness

Scan date: 2026-10-04. Repository: `AntoineGaton/ZeroBox` (private), all refs.

## How the public repo relates to this one

`AntoineGaton/zerobox-cli` (public) is a single squashed commit
(`8628648`, "ZeroBox v0.1.0: clean your Gmail from the terminal"). Its tree
is byte-identical to ZeroBox `main` at `21d3e05`. It does **not** carry this
repository's history, so anything that only exists in old ZeroBox commits is
not published through zerobox-cli.

## Scans run

| Scan | Command | Result |
|---|---|---|
| gitleaks, full history | `docker run --rm -v $PWD:/repo zricethezav/gitleaks:latest detect -s /repo --log-opts=--all --no-banner` | 57 commits, ~1.29 MB scanned, **no leaks found** |
| Credential files ever added | `git log --all --diff-filter=A --name-only` filtered for `credentials.json`, `token.json`, `.env` | `credentials.json`, `token.json` and `.env` were **never committed**. Only `.env.example` files (see below) |
| Personal email addresses in patches | `git log --all -p` grep for consumer mail domains | Only the author address `antoinegaton@gmail.com` (commit metadata, already public on GitHub) |

## Findings

| Finding | Commit | Action | Inherited by zerobox-cli? |
|---|---|---|---|
| `.env.example` with non-secret scan settings (`SCAN_LIMIT`, `BATCH_SIZE`, `LOG_FILE`, `DEBUG`) | `98593bc` | None. No secrets | Yes, current file, harmless |
| `web/.env.example` with empty Supabase, Google OAuth and Stripe keys | `3fb84a1` | None. Values are blank. The web app later moved to `zerobox-web` (`4219739`) | No |
| `site/.env.example` with empty `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | `9f8f3fd` | None. Values are blank | Yes, harmless |
| Real inbox sender addresses in protection tests, plus `.claude/plan.md` with a personal address | before `5393f05` | Already replaced with placeholders in `5393f05`. Nothing to rotate. Rewrite only if this private repo is ever made public | No |

## Verdict

Nothing to rotate and no history rewrite needed. The public `zerobox-cli`
snapshot is clean. Keep this repository (`ZeroBox`) private, or publish only
through squashed snapshots as already done. Its history still contains the real
sender addresses removed in `5393f05`.

`.gitignore` covers `credentials.json`, `token.json`, `.env`, `.env.local`,
`.env*.local` and `.claude/`.
