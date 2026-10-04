# Contributing

Thanks for helping. Bug reports, small fixes and docs improvements are all
welcome. For a bigger change, please open an issue first so we can agree on
the approach.

## Setup

```bash
git clone https://github.com/AntoineGaton/zerobox-cli.git && cd zerobox-cli
npm ci
npm start          # run the CLI from source
npm run build      # bundle to dist/zerobox.js
npm test           # unit tests and CLI smoke tests (build first)
```

To try it against Gmail you need your own Google client: run `zerobox setup`
(or `npm start -- setup`). Use `ZEROBOX_HOME=/some/temp/dir` to keep a test
setup apart from your real one.

The landing site lives in `site/` with its own `package.json`
(`cd site && npm ci && npm run lint && npm run build`).

## Guidelines

- Keep logic pure and tested where possible: `src/tui/model.js`, `keys.js`
  and `view.js`, `src/protect.js`, `src/setup.js` have no I/O.
- Never commit real email addresses or mail data. Use `example.com` or
  `*.example` placeholders in tests and docs.
- Never commit `credentials.json`, `token.json` or `.env` files.
- Use [Conventional Commits](https://www.conventionalcommits.org/)
  (`fix(scan): ...`, `feat(tui): ...`), one logical change per commit.
- Add an entry under "Unreleased" in `CHANGELOG.md` for user-facing changes.
- CI runs the tests on Linux, macOS and Windows with Node 20 and 22.

Security issues: see [SECURITY.md](SECURITY.md), not public issues.

By contributing you agree that your work is licensed under the MIT License.
