---
id: issue-npm-not-on-path
type: issue
layer: issues
status: resolved
confidence: 1.0
created_by: claude-code
created_at: 2026-06-12T10:00:00Z
last_updated_by: claude-code
last_updated_at: 2026-06-12T15:30:00Z
dependencies:
  - task-v03-implementation
contradictions: []
tags: [environment, blocker, npm, tests]
---

npm/node are not on PATH in the current agent environment (checked Git Bash and PowerShell,
Program Files, AppData, nvm locations — 2026-06-12). The test suite (`npm test`, ~380 vitest
tests) cannot be run, so src/ changes are blocked per the "never end a session with failing
tests" rule. Phase 8 (docs/spec restructure) proceeded; phases 9+ need Node.js installed or
PATH fixed. Resolve by installing Node 20+ or exposing the existing install on PATH, then
verify with `npm test` before starting Phase 9.

RESOLVED 2026-06-12: Node.js 24.16.0 LTS installed via `winget install OpenJS.NodeJS.LTS`
(user granted full access). Baseline verified (380 tests green) before any src/ change.
