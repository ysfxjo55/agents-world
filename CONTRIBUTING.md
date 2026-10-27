# Contributing

Thank you for helping! Bug reports with screenshots are very welcome (use the **Bug report** form in Issues).

## Run it
1. Install Node.js 22.5 or newer.
2. `git clone https://github.com/ysfxjo55/agents-world.git && cd agents-world`
3. `npm ci`
4. `npm start`, then open http://localhost:4321. To test next to a running copy: `AGENTS_WORLD_PORT=4400 npm start`.

## Check your change
`npm run check` runs the linter, the type check and all tests. It must pass before a change is merged. GitHub runs the same checks on Windows, macOS and Linux for every pull request.

## How the code is laid out
- `server/`: the local web server (routes in `index.js`), the session readers in `server/sources/`, chat runs in `chat.js`, updates in `updater.js`.
- `public/`: the pages. Plain JavaScript, no build step, no frameworks.
- `test/`: one test file per feature, run with `node --test`. New behaviour needs a test.

## Rules
- Keep changes small and focused, one topic per pull request.
- Never commit personal data, keys or anything from `data/`.
- When you change what users see, add a line to `CHANGELOG.md`. Releases are made automatically when the version in `package.json` changes.
