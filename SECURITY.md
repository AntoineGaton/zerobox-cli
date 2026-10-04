# Security policy

## Reporting a vulnerability

Please report security issues privately, not in public issues:
**[Report a vulnerability](https://github.com/AntoineGaton/zerobox-cli/security/advisories/new)**
(GitHub private vulnerability reporting, under the repository's Security tab).

Include what you found, how to reproduce it, and what an attacker could do with
it. You should get a reply within a few days. Please give us a reasonable time
to fix the issue before you disclose it.

## Supported versions

ZeroBox is in beta. Only the latest release on npm (`zerobox-cli`) gets fixes.

## Scope

ZeroBox runs on your computer and talks only to Google and to the unsubscribe
links of senders you choose. Issues we especially want to hear about:

- anything that could leak the OAuth token, `credentials.json` or scan data
  from the data folder (`ZEROBOX_HOME`)
- a way for an email (headers, unsubscribe links) to make ZeroBox run code,
  write files, or send requests you did not ask for
- bulk actions touching starred or protected senders

Never include your own `credentials.json`, token or real mail data in a report.
