#!/bin/zsh
# macOS: double-click to start Agent World and open it in your browser.
cd "$(dirname "$0")" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v node >/dev/null; then
  echo "Node.js is missing. Install it from https://nodejs.org (version 22.5 or newer)."; read -k 1 "?Press any key to close"; exit 1
fi
[ -d node_modules ] || npm install --no-audit --no-fund
# already running? just open the page
if curl -s -o /dev/null http://127.0.0.1:4321/; then open http://localhost:4321; exit 0; fi
(sleep 1.5; open http://localhost:4321) &
exec node server/index.js
