---
id: task-v03-implementation
type: task
layer: state
status: active
confidence: 1.0
created_by: claude-code
created_at: 2026-06-12T10:00:00Z
last_updated_by: claude-code
last_updated_at: 2026-08-10T00:00:00Z
dependencies:
  - decision-v03-shared-memory-redesign
contradictions: []
tags: [v0.3, implementation, phases-9-14]
---

### 2026-06-12T10:00:00Z — claude-code

Implement spec v0.3 in the reference implementation, in dependency order (CLAUDE.md phases 9–14):
Phase 9 — core: schema v0.3 (map/sessions layers, plan/handoff/resource/file types, path/stale/steps
fields), deterministic Referee, atomic writes + .lock, trust enforcement.
Phase 10 — sessions: session start/end, catchup, handoff nodes, presence registry, agents.json
last_session_at.
Phase 11 — map + plans: scan-generated map nodes, hook staleness flagging, `next`, `doctor`.
Phase 12 — onboarding + compliance: AGENTS.md canonical, new MCP tools, compliance tests for §15–§17.
Phase 13 — RelayBench E0 pilot (exploration tokens, one repo) then full harness per docs/RESEARCH.md.
Phase 14 — rewrite docs/paper.tex as the empirical paper after Phase 13 results.
Each phase lands with its tests in the same session; update spec changelog when v0.2 behaviour changes.
Currently BLOCKED by issue-npm-not-on-path.

### 2026-06-12T15:30:00Z — claude-code

Unblocked (Node 24 installed) and Phase 9 COMPLETE. Delivered in @mastishk/core:
schema v0.3 (map layer, resource/plan/handoff/file types, path/stale/steps fields,
layer-type pairing enforcement), atomic.ts (temp+rename writes), lock.ts (.mastishk/.lock,
stale-break 30s), agents.ts (typed agents.json, auto-registration), referee.ts
(deterministic core, all three conflict strategies), trust.ts (§17.3 enforcement),
commit.ts (commitNode canonical write path), nodeToMapEntry (indexes contradictions).
MCP toolUpdate/toolLog now route through commitNode. Default agents.json registers
mastishk-cli/mastishk-mcp as high trust. 430 tests green (50 new, incl. compliance file
08-referee-trust-concurrency), typecheck clean (fixed root "type": "module"), all
packages build. Next: Phase 10 (sessions, catchup, handoff).

### 2026-08-10T00:00:00Z — claude-code

Phase 10 COMPLETE. session.ts + catchup.ts in core, session-cmd.ts + catchup-cmd.ts in cli,
compliance 09-sessions (13 tests) covering §15.1–15.4 and handoff-first inject ordering.
468 tests green, typecheck clean, core/cli/mcp build. One SPEC-GAP recorded (catchup uses node
timestamps, not git history — see catchup.ts header). Stale "not yet implemented" markers cleared
from spec §15/§4.2 and README; false AGENTS.md claims in README marked 🚧 (that is Phase 12).
Phases 9 and 10 committed together after sitting uncommitted since June.
Remaining: Phase 11 (map + plans + next + doctor), Phase 12 (AGENTS.md canonical, MCP v0.3 tools,
compliance §14/§16), Phase 13 (RelayBench), Phase 14 (empirical paper). See TODO.md.

### 2026-08-10T01:00:00Z — claude-code

Phase 11 COMPLETE. core/map.ts + core/doctor.ts; cli map/next/doctor commands; scan emits map
nodes; post-commit hook flags staleness on every commit. memory-map.json entries now cache
path + stale (additive index change, old indexes still valid). Compliance 10 (map staleness,
16 tests) and 11 (plans + doctor, 18 tests) added; 07 extended and renumbered §10 → §11.
578 tests green, typecheck clean, all packages build.
Doctor's first real run found progress-phase-1 unindexed in this project's own memory — fixed.
Only v0.3 gaps left are Phase 12: AGENTS.md as canonical onboarding (§14.2) and the three
session MCP tools (§10). Both now carry explicit not-implemented markers in the spec.
