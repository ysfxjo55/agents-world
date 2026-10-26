# Starter files: make the agents yours

On the first start, Agents World copies these files to places it uses. It never overwrites a file that already exists.

| Starter file | Copied to | What it is |
|---|---|---|
| `../agents/bella.md` | `~/.claude/agents/bella.md` | Bella's instructions (Claude Code agent) |
| `../agents/deep-researcher.md` | `~/.claude/agents/deep-researcher.md` | The Research Lab agent |
| `bella/memory/MEMORY.md` | `data/bella/memory/MEMORY.md` | Bella's memory index |
| `interstellar/AGENTS.md` | `data/interstellar/AGENTS.md` | Interstellar's instructions (Codex) |
| `interstellar/memory/MEMORY.md` | `data/interstellar/memory/MEMORY.md` | Interstellar's memory index |

To change a name, personality or rule, edit the copied file (not the starter), then start a new chat.

## Your own agents
Any Claude Code agent file in `~/.claude/agents/` shows up in the world as a building. Create one with `/agents` inside Claude Code, or write a file like this:

```markdown
---
name: tester
description: Writes and runs tests, and explains failures in plain words.
---
You are a careful tester. ...
```

## About you
Put your name and a few lines about yourself in `data/config.json` (see `config.example.json`). The agents use them:

```json
"name": "Sam",
"about": "Beginner developer. English is my second language: short, plain sentences please."
```

The family chat names (Bella and Interstellar) are fixed in this version.
