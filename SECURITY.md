# Security

## Reporting a problem
Please report security problems **privately**: on GitHub, open the repository's **Security** tab and choose **Report a vulnerability**. Do not open a public issue. You get an answer within a few days.

## Supported versions
Only the newest version gets fixes. Agents World updates itself: when a fix is released, the app shows **Update now**.

## What Agents World protects
Agents World runs AI coding agents that can read and change files on your computer, so it is careful about who can control it:
- The server listens only on this computer (127.0.0.1). Other computers on your network cannot reach it.
- Requests addressed to any other host name are refused. This stops "DNS rebinding", where a website tries to reach your local server under its own name.
- Changes (sending a message, changing settings, starting an update) are refused when the browser says they come from another website (Origin and Sec-Fetch-Site checks). The pages also have a strict Content Security Policy and cannot be embedded by other sites.
- The access mode you pick limits what an agent may do, and the agents Bella starts can never get more access than her own chat (checked with a secret per-run token, not with anything the agent says).
- Updates come only from github.com/ysfxjo55/agents-world over HTTPS. A download is refused if it is not newer, or if any file path would leave the app folder. Installing runs `npm ci --ignore-scripts`, and your `data/` folder is never touched.
- Your settings, chats, memory and board live in `data/`, which git ignores. The settings file is readable only by you.

## What it does not protect
- Programs already running on your computer as you can use Agents World like you can. Anything that can run code as you is already trusted.
- An agent in **Full access** mode can do anything you can. Use it only for work you trust, and check what it did.
- The AI programs themselves (Claude Code, Codex, OpenCode, Antigravity) send your messages to their providers. Agents World does not send your data anywhere else.
- Private remote access through Tailscale is optional; see the README. Never expose port 4321 to the internet.
