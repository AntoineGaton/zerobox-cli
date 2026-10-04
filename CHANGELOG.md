# Changelog

All notable changes to ZeroBox are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] - 2026-10-04

First public developer beta, published to npm as `zerobox-cli`.

### Added

- Full-screen terminal view (`zerobox`): every sender ranked by volume, open
  rate and reply rate, with Nuke, Review, Keep and Protect verdicts, search,
  views, and a details pane. A single-column layout for narrow terminals and
  phones over SSH.
- Familiar keys (`Space`, `A`, `Delete`, `U`, `F`, `R`, `/`, `V`), with Vim
  keys kept as aliases.
- Bulk cleanup: select a whole view, then review and apply in separate steps
  (unsubscribe, filters, trash), each with a plain question and a time
  estimate. Progress is checkpointed, so a stop or a dropped connection keeps
  what was done.
- Unsubscribe via RFC 8058 one-click links, unsubscribe emails (paced to
  Gmail's sending limits), or a list of web pages to open.
- Gmail filters so future mail from a sender skips the inbox.
- Protected senders: starred, replied, often opened, your own address, and
  built-in rules for finance, government, health, account security and
  utilities, plus your own `protected.txt` and `zerobox protect` /
  `zerobox unprotect`.
- Settings screen and `zerobox settings` to choose which rules protect
  senders, including the opened-rate threshold and finance marketing.
- `zerobox setup`: a guided, about 5 minute setup of your own Google client,
  offered automatically on first run.
- Sign-in from another device (`zerobox auth --no-browser`) for SSH and
  servers.
- Data kept in a per-user folder (`ZEROBOX_HOME`), so `zerobox` runs from any
  directory.
- Direct commands: `scan`, `clean`, `unsubscribe`, `filter`, `stats`,
  `protect`, `settings`, `auth`, `menu`.

### Fixed

- Messages were silently dropped when Gmail answered with 403 rate-limit
  errors. Scans and actions now retry and outlast Gmail's per-minute quota
  window.
- Bare `From` addresses (no display name) lost their first letter, which
  split one sender into two.
- Trash failures were counted as trashed. They are now reported.
- `clean` deleted permanently by default. It now moves mail to Trash
  (recoverable for 30 days), never touches starred mail, and needs
  `--permanent` to delete.
- Reply rates could exceed 100% when a thread had several replies.
- The menu crashed when the terminal reported 0 columns.

[Unreleased]: https://github.com/AntoineGaton/zerobox-cli/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/AntoineGaton/zerobox-cli/releases/tag/v0.1.0
