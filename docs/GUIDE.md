# Mastishk — Plain English Guide

> What it is, how it works, and how to use it — no jargon.

---

## What problem does this solve?

You're working with an AI coding agent (Claude, Cursor, ChatGPT). You have a good session. The agent helps you build something great.

Next day, new session. **The agent remembers nothing.** You spend the first 20 minutes re-explaining:
- What the project is
- Why you made that architecture decision last week
- What you tried that didn't work
- What's left to do

This happens every single session. Every single time you switch tools. Claude Code doesn't know what Cursor did. Cursor doesn't know what you told ChatGPT.

**Mastishk fixes this.** It gives your project a memory folder — `.mastishk/` — that every agent reads from and writes to. One shared brain for all your agents.

---

## How it works — the simple version

Think of `.mastishk/` like a filing cabinet next to your code:

```
.mastishk/
  intent/      ← "What are we trying to build?" (rarely changes)
  state/       ← "What are we doing right now?" (changes every session)
  knowledge/   ← "What have we learned?" (grows over time)
  issues/      ← "What went wrong?" (never deleted)
```

Each drawer contains small files (`.msk.md`) — just markdown with some metadata at the top. Like sticky notes that never fall off.

```
---
id: goal-build-auth
type: goal
layer: intent
status: active
confidence: 1.0
---

Build JWT authentication before the v1 release.
Must support refresh token rotation.
```

When an agent needs context for a task, it doesn't dump everything into the prompt. It **traverses the connections** between notes — like following a thread — and returns only what's causally relevant.

> **Example:** You ask about a bug in the auth system. Mastishk finds the auth-related notes, follows their connections to the goal they serve and the decisions that shaped them, and returns that specific chain. Not everything — just what matters for this task.

---

## Installing

```bash
npm install -g @mastishk/cli
```

That's it. One global install. Works in any project.

---

## Using in a NEW project

**Step 1 — Initialise memory**

```bash
cd your-project
mastishk init
```

This creates `.mastishk/` with empty folders and config files. Commit this to git — it belongs to the project, not to you personally.

**Step 2 — Tell it what you're building**

Open `.mastishk/intent/` and create a goal file. Or let the agent do it for you (see MCP section below).

You can also scan the project automatically:

```bash
mastishk scan
```

This reads your `package.json`, `README.md`, and recent git commits and creates starter memory nodes. It asks you to confirm each one.

**Step 3 — Use inject before every agent task**

Before you type a task to your agent, run:

```bash
mastishk inject "build the login page"
```

You'll get a block of structured context. Paste it at the top of your message to the agent.

```
## Mastishk context — build the login page
Generated: 2026-05-12T10:00:00Z

### Goals
**goal-build-auth** [1.0] — Build JWT authentication before v1 release.

### Current state
**task-design-db-schema** [1.0] — Schema complete. users table has id, email, password_hash, refresh_token.

### Knowledge
**decision-use-bcrypt** [0.9] — Using bcrypt for password hashing. Argon2 considered but rejected due to native dependency issues on Windows.
```

Now the agent immediately knows the goal, what's already been done, and a decision that would otherwise get re-debated.

**Step 4 — Log issues and decisions**

When something goes wrong:
```bash
mastishk log "bcrypt peer dep conflict with Node 22"
mastishk log --error "refresh token not being invalidated on logout"
```

When you make an important decision, ask the agent to record it via MCP (see below) or add a file manually to `.mastishk/knowledge/`.

**Step 5 — Checkpoint at end of session**

```bash
mastishk checkpoint
```

This commits the current state of `.mastishk/` to git. Your memory is now versioned. If an agent makes a bad decision tomorrow, you can roll back.

---

## Using in an ONGOING project

You already have code, git history, a README. You just don't have the `.mastishk/` folder yet.

**Step 1 — Init**

```bash
cd your-existing-project
mastishk init
```

**Step 2 — Scan to bootstrap memory from what already exists**

```bash
mastishk scan
```

This infers memory from:
- `package.json` → what stack you're using, what dependencies you have
- `git log` → recent commits become state nodes (what was done)
- `README.md` → the project goal from your heading

Confirm, skip, or edit each suggestion. Takes 2 minutes.

**Step 3 — Fill the gaps manually**

Scan gives you a skeleton. It doesn't know *why* you made certain decisions. Take 10 minutes to add a few knowledge nodes for your most important decisions:

```bash
# Create .mastishk/knowledge/decision-why-we-chose-postgres.msk.md
# One paragraph explaining why you picked Postgres over MySQL
```

This is the highest-value thing you can do. The agent will reference this every time it touches the database.

**Step 4 — From here, same as new projects**

Use `inject` before tasks, `log` for issues, `checkpoint` at end of sessions.

---

## Using with Claude Desktop / Cursor / Windsurf (MCP)

Instead of manually running `inject` and pasting, you can connect Mastishk directly to your agent via MCP. The agent gets memory tools automatically.

**Install:**
```bash
npm install -g @mastishk/mcp
```

**Add to Claude Desktop** (`claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "mastishk": {
      "command": "npx",
      "args": ["mastishk-mcp"],
      "env": {
        "MASTISHK_DIR": "C:/path/to/your/project/.mastishk"
      }
    }
  }
}
```

**Add to Cursor** (`.cursor/mcp.json`):
```json
{
  "mastishk": {
    "command": "npx mastishk-mcp",
    "env": { "MASTISHK_DIR": "${workspaceFolder}/.mastishk" }
  }
}
```

Once connected, the agent has five tools it uses automatically:

| Tool | What it does |
|---|---|
| `mastishk_inject` | Gets relevant memory before starting a task |
| `mastishk_update` | Saves decisions and progress to memory |
| `mastishk_log` | Logs errors and blockers |
| `mastishk_status` | Checks memory health |
| `mastishk_checkpoint` | Commits memory to git |

You don't have to tell the agent to use these. It discovers them from the tool descriptions and uses them when relevant — especially at the start of a task and at the end of a session.

---

## How to test it's working

### Quick sanity check (2 minutes)

```bash
# 1. Init a test folder
mkdir msk-test && cd msk-test
mastishk init

# 2. Log something
mastishk log "test issue"

# 3. Check status — should show 1 node
mastishk status

# 4. Inject — should return header even with no matches
mastishk inject "some task"
```

If all four commands run without errors, the CLI is working.

### Check a node was actually saved

After `mastishk log "test issue"`:

```bash
ls .mastishk/issues/
# Should show: issue-1234567890.msk.md

cat .mastishk/issues/issue-1234567890.msk.md
# Should show the YAML frontmatter + your message
```

If the file is there and has proper YAML frontmatter (`id:`, `type:`, `layer:`, etc.) — it's working.

### Check memory-map.json is being updated

```bash
cat .mastishk/memory-map.json
```

Should show the node you just logged under `"nodes"`. If every log/update adds an entry here, the graph index is working.

### Check inject returns relevant context

```bash
# Add a node with a tag
mastishk log "auth system is broken"
# This creates an issue tagged with whatever you log

# Then inject with a matching word
mastishk inject "fix auth"
```

The inject output should contain the auth issue. If it does — the matching and traversal is working.

### Test MCP tools (if using MCP)

Create a file `test-mcp.mjs` in your project root:

```js
import { TOOL_DEFINITIONS, toolInject, toolStatus } from '@mastishk/mcp';
import { join } from 'node:path';

const ctx = { mastishkDir: join(process.cwd(), '.mastishk') };

// Should list 5 tools
console.log('Tools:', TOOL_DEFINITIONS.map(t => t.name).join(', '));

// Should return context header
const r = await toolInject({ task: 'test task' }, ctx);
console.log('Inject:', r.split('\n')[0]);

// Should return health summary
const s = await toolStatus({}, ctx);
console.log('Status:', s.split('\n')[0]);
```

Run it:
```bash
node test-mcp.mjs
```

---

## How memory accumulates over time

Session 1 — you tell the agent the project goal. It saves it to `intent/`.

Session 2 — you make a stack decision (Postgres over SQLite). Agent saves it to `knowledge/`.

Session 3 — you hit a bug. Agent logs it to `issues/`. You fix it. Agent marks it resolved.

Session 10 — new agent (or same agent, new session). It calls `mastishk_inject` for "build payment integration". It gets back:
- The project goal (because payment relates to the goal)
- The Postgres decision (because payment will use the DB)
- An old issue about transaction handling (because it's an open issue tagged "database")

The agent starts knowing all of that. Without Mastishk, you'd have to explain it again.

---

## Common questions

**Do I commit `.mastishk/` to git?**

Yes. That's the point. It belongs to the project. All teammates and agents share the same memory. Treat it like code — review changes, roll back if needed.

**What if two agents write conflicting things?**

Mastishk has a Referee: if a new write contradicts an existing node (via the `contradictions` field), the write is rejected and a conflict issue is created. You resolve it. No silent overwrites.

**What's the confidence score (the number in brackets)?**

```
**goal-build-auth** [1.0] — Build JWT auth...
```

- `1.0` — set by a human, fully trusted
- `0.8` — verified by a human after an agent created it
- `0.6` — inferred by an agent or scan, probably right
- `0.3` — speculative, needs verification

Nodes with confidence below 0.5 are excluded from inject output. This stops low-quality inferences from polluting agent context.

**What if I want to change or delete a memory node?**

Edit the `.msk.md` file directly in your editor — it's just a text file. Or use:
```bash
mastishk update <id> --status resolved
```
to mark something as done without deleting it (nothing in Mastishk is ever hard-deleted — the history is the value).

---

## The one-line summary

Mastishk is a `.mastishk/` folder in your project — structured notes that AI agents read before each task and write to after each session — so they never start from zero again.

---

*Protocol spec: [MASTISHK-SPEC.md](../MASTISHK-SPEC.md) · GitHub: [mastishk-ai/mastishk](https://github.com/mastishk-ai/mastishk) · npm: [@mastishk/cli](https://npmjs.com/package/@mastishk/cli)*
