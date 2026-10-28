# Changelog

Each version starts with "## <version>". The app shows these lines in its "A new version is ready" banner.

## 0.2.11
- Antigravity: each step it takes (reading files, running commands) now shows in the chat, and "Working" ends when the step ends.
- Antigravity: when it was not allowed to do something (for example run a command to move files), the chat says what was blocked and what to change, instead of looking finished.

## 0.2.10
- Security: the board ignores unsafe values in its data files, so an edited file cannot put code into the page.
- Security: OpenCode chats are not offered through Tailscale, because OpenCode cannot be held to read-only.
- Sessions started with the delegate tool from a Terminal or another agent now show on their own folder's island, not at Bella HQ. Only Bella's own agents go there.

## 0.2.9
- Security: other websites can no longer send commands to Agents World, even through a browser that hides where a request comes from.
- Security: updates are only installed when they are newer and safe to unpack, and without running extra install scripts.
- Your settings file is now readable only by you.

## 0.2.8
- New: Tasks & habits board (Today, Board, Sessions, reminders). Open it with Board in the World toolbar or in the Chat sidebar. Your tasks stay on your computer.

## 0.2.7
- With only Antigravity (or OpenCode), Bella, Interstellar and the Family chat are hidden, with a tip: Add Claude Code to get Bella, or Codex to get Interstellar.

## 0.2.6
- New: Google Antigravity CLI (agy). Its conversations show up in the world, and you can chat with it from the Chat page. Works with a free Google account.

## 0.2.5
- Chat: when a message can't be sent, it stays on screen with the red reason, instead of disappearing.
- Chat: a warning when the conversation is also open in a Terminal window (Mac and Linux).

## 0.2.4
- Agents World now lives at github.com/ysfxjo55/agents-world (public).

## 0.2.3
- Faster update checks (every hour and when you open the page) and a "Check for updates" button in the sidebar.
- Research Lab: Stop now really stops everything on Windows.
- More Windows fixes, found by the new automatic tests on Windows, Mac and Linux.

## 0.2.2
- Test release: checks that "Update now" really updates Agents World.

## 0.2.1
- New Instructions panel on the Chat page: edit Bella's and Interstellar's instructions and a few lines about you, with Reset to default.
- New guide step: tell your agents about you.
- Windows: Bella can save her memory and start agents (her tools now run with node).
- Windows: npm no longer changes package-lock.json, so updates and git pull work.

## 0.2.0
- Updates: Agents World tells you when a new version is ready and installs it with one click.
- First-steps guide: start with an empty world, connect your AI, and learn the app by doing.
- One subscription is enough: Claude Code gives you Bella, Codex gives you Interstellar.
- Windows fixes: the World page loads, and AI programs that are not on PATH are found.
