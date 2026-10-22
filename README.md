<p align="center"><img src="https://raw.githubusercontent.com/AntoineGaton/zerobox-cli/main/assets/logo.png" alt="ZeroBox" width="320"></p>

# ZeroBox

**Clean your Gmail from the terminal.** ZeroBox ranks every sender in your inbox, then trashes, unsubscribes and filters the noisy ones in bulk. It runs on your machine; there is no ZeroBox server.

> Cleaned a 25,554-email inbox to 7,987: 17,583 to Trash, ~300 unsubscribes, 0 failures.

```text
 ZeroBox v0.1.0  3,994 emails · 523 senders · scanned 9m ago
──────────────────────────────────────────────────────────────────────────────────────────────────
     SENDER                                       EMAILS OPENED VERDICT │  DETAIL
 du  contact@mailer.example.com                      205     1% Nuke    │  news@editor.example.com
 ·   dan@newsletter.example.com                      157     1% Nuke    │
 df  hello@m.example.org                             128     1% Nuke    │  emails       100
▌·   news@editor.example.com                         100     0% Nuke    │  opened       0%
 ·   noreply@survey.example.com                       86     1% Nuke    │  replied      0%
──────────────────────────────────────────────────────────────────────────────────────────────────

 NORMAL  2 marked → trash 333 · unsub 1 · filter 1 │ R review · Space select · A all · ? help  4/523
```

**Developer beta (v0.1.0).** It works end to end, but setup needs a few minutes in Google Cloud (see below).

## Install

```bash
npm i -g zerobox-cli    # then run: zerobox
npx zerobox-cli         # or run it without installing
```

Node.js 20 or newer, on macOS, Linux or Windows. Works over SSH.

## Setup (about 5 minutes, once)

```bash
zerobox setup
```

The setup walks you through four steps in Google Cloud, with a link for each: create a project, enable the Gmail API, add yourself as a test user, and create a **Desktop app** client. Then you give it the downloaded JSON (or paste the Client ID and secret) and sign in. ZeroBox also offers the setup the first time you run it.

**Why your own Google client?** Apps that read Gmail need a Google security review before strangers can use them. Until ZeroBox has one, each user signs in through a client they own, so your mail goes only between your computer and Google.

**"Google hasn't verified this app."** You will see this screen when you sign in. It is expected: the app is your own, in testing mode. Choose **Continue**.

No browser on this machine (SSH, a server)? Pick "another device" at the end of `zerobox setup`, or run `zerobox auth --no-browser`: open the link on your phone, approve, and paste back the address you land on.

## Quick start

```bash
zerobox
```

1. `Ctrl-R` scans your inbox (headers only). The first scan of a large inbox takes a few minutes and resumes if stopped.
2. `V` to the **Nuke** view: high-volume senders you rarely open or reply to.
3. `A` selects every sender in the view for cleanup (protected senders are skipped). Narrow it first with `/` if you like.
4. `R` reviews the plan one step at a time (unsubscribe, filters if you marked any, then trash). In each step `Enter` does it, `S` skips it, `Esc` stops before the rest.

Nothing touches Gmail until you confirm a step. Progress is saved as it goes, so `Ctrl-C` or a dropped connection keeps what was done.

## Keys

| Key | Action |
| --- | --- |
| `↑` `↓`, `PageUp` `PageDown`, `Home` `End` | Move |
| `Space` | Select this sender for cleanup (unsubscribe + trash). Again to unselect |
| `A` | Select every sender in the view for cleanup (skips protected) |
| `Delete` / `Backspace` | Trash only |
| `U` | Unsubscribe only |
| `F` | Filter: future mail from the sender skips the inbox |
| `x`, `X` | Clear marks on this sender, on all |
| `R` | Review and apply: `Enter` do the step, `S` skip it, `Esc` stop |
| `/` | Search by name or address |
| `V` (`Tab` on wide screens) | Switch view: All, Nuke, Review, Keep, Protect |
| `P` | Protect or unprotect this sender |
| `S` | Settings: which rules protect senders |
| `Enter` / `→` | Narrow screens: open the details (`Esc` / `←` back) |
| `Ctrl-R` | Rescan |
| `Esc`, `q`, `?` | Back, quit (asks first if anything is selected), help |

<details>
<summary>Vim aliases and power keys</summary>

| Vim key | Same as |
| --- | --- |
| `j` `k`, `gg` `G`, `Ctrl-d` `Ctrl-u` | Move |
| `d`, `u`, `f` | Trash, unsubscribe, filter (one sender) |
| `w`, `:w` | Review; `y` `s` `n` inside a step |
| `Tab`, `l` / `h` | Open / close details on narrow screens |
| `v`, `p` | Views, protect |
| `,`, `:set` | Settings |
| `:scan` | Rescan |
| `:q`, `:q!` | Quit |

Power keys: `D` marks every sender in the view for trash only; `:U` and `:F` mark it for unsubscribe or filter only.

</details>

## Safety

- **Trash first.** Cleanup moves mail to Gmail Trash, which you can undo for 30 days. Permanent delete exists only as `zerobox clean --permanent`.
- **Starred mail is never trashed.**
- **Protected senders** are skipped by bulk actions: anything starred, senders you replied to, senders you open often (40% by default), your own address, and built-in rules for banks and payments, government and tax, health, account security and sign-in, and utilities. Add your own in `protected.txt` or with `P`.
- **Staged review.** Unsubscribe, filters and trash are separate steps, each with a plain question and an estimate before anything runs.
- **Your data stays local.** Scans, logs and settings live in your data folder (`ZEROBOX_HOME`, see below). ZeroBox talks only to Google, plus the unsubscribe links of senders you choose to unsubscribe from.
- **Gmail scopes**, and why:
  - `https://mail.google.com/`: read headers, move to Trash, send unsubscribe emails, and the optional permanent delete (Gmail allows that only with this scope).
  - `gmail.settings.basic`: create the filters that keep future mail out of your inbox.

Unsubscribe uses the sender's one-click link ([RFC 8058](https://www.rfc-editor.org/rfc/rfc8058)) when there is one, then an unsubscribe email (sent from your account, at most 400 a run), and otherwise lists the web page for you to open. Unsubscribing cannot be undone by ZeroBox.

## Commands

```bash
zerobox                   # Full-screen view: browse, mark, review, apply
zerobox setup             # Guided Google setup
zerobox auth              # Sign in again (--no-browser for SSH)
zerobox scan              # Scan the inbox and rank senders (--fresh, --limit n, --json)
zerobox clean --dry-run   # Preview what would move to Trash
zerobox clean             # Move mail from chosen senders to Trash
zerobox unsubscribe       # Handle List-Unsubscribe for chosen senders
zerobox filter            # Create Gmail filters
zerobox stats             # Inbox health dashboard
zerobox protect <who>     # Protect an address, @domain or *keyword* (--list to show)
zerobox unprotect <who>   # Remove one, or make an exception to the built-in rules
zerobox settings          # Show protection settings (settings set <key> <value>)
zerobox menu              # The older guided menu
```

## Settings

`S` in the full-screen view lists each protection rule, what it protects and how many of your senders it covers right now. From the shell: `zerobox settings` and, for example, `zerobox settings set openedMin 50`.

| Setting | Protects | Default |
| --- | --- | --- |
| `replied` | Senders you replied to | on |
| `opened`, `openedMin` | Senders whose mail you open at least `openedMin`% of the time | on, 40 |
| `government` | Tax, `.gov` and `.mil` agencies | on |
| `health` | Medical, pharmacy, patient portals | on |
| `finance` | Banks, cards, payments, investments, insurance | on |
| `financeMarketing` | Promotional mail from finance senders. Off: bulk-looking finance addresses lose protection; alerts, statements and account mail keep it | on |
| `accountSecurity` | Sign-in, codes, passwords, calendar invites | on |
| `utilities` | Power, internet and phone carriers | on |

`protected.txt` in the data folder overrides every setting, both ways:

```text
boss@work.example      # one address
@family.example        # a domain and its subdomains
*invoice*              # any address containing a word
!news@bank.example     # never protected, even by the built-in rules
```

## Privacy

ZeroBox has no account, no server and no analytics. Your Google client, sign-in token, scan cache, cleanup logs, `protected.txt` and `settings.json` stay in the data folder:

| OS | Data folder |
| --- | --- |
| Linux | `~/.config/zerobox` (or `$XDG_CONFIG_HOME/zerobox`) |
| macOS | `~/Library/Application Support/zerobox` |
| Windows | `%APPDATA%\zerobox` |

Set `ZEROBOX_HOME` to use another folder. The folder is private to your user, and `credentials.json` and the token are written readable only by you. Delete the folder to remove everything; revoke access any time at [myaccount.google.com/permissions](https://myaccount.google.com/permissions).

## Development

```bash
git clone https://github.com/AntoineGaton/zerobox-cli.git && cd zerobox-cli
npm ci
npm start          # run from source
npm run build      # bundle to dist/zerobox.js
npm test           # unit tests and CLI smoke tests (build first)
```

The landing page lives in [`site/`](site/README.md). See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).

## Support

ZeroBox is free and MIT licensed. If it saves you time, you can
[sponsor on GitHub](https://github.com/sponsors/AntoineGaton) or
[buy me a coffee](https://buymeacoffee.com/codemonkeystudios).

## License

[MIT](LICENSE) © 2026 Antoine Gaton
