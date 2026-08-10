---
id: progress-phase-1
type: task
layer: state
status: active
confidence: 1.0
created_by: claude-code
created_at: 2026-05-12T00:00:00Z
last_updated_by: claude-code
last_updated_at: 2026-08-10T00:00:00Z
dependencies: []
contradictions: []
tags: [phase-1, core, schema, validate]
---

Phase 1 + 2 — @mastishk/core: schema, validate, read, write, graph, traverse, inject — COMPLETE.
Phase 3 — @mastishk/cli: init, inject, update, log, status, checkpoint — COMPLETE.
Phase 4 — @mastishk/mcp: MCP server, 5 tools (inject, update, log, status, checkpoint) — COMPLETE.
Phase 5 — @mastishk/cli: scan command — COMPLETE.
Phase 6 — tests/compliance/: full compliance suite — COMPLETE.
Phase 7 — npm publish prep + arXiv paper + mastishk.dev — COMPLETE (human publish actions pending).

### 2026-08-10T03:00:00Z — claude-code

npm 0.3.0 release prepared (not yet published — this machine has no npm auth).
Bumped core/cli/mcp 0.1.0 → 0.3.0, matching the protocol version they implement, and updated
the exact cross-package pins (`"@mastishk/core": "0.3.0"`) — leaving those at 0.1.0 would have
shipped a cli@0.3.0 that pulls the OLD core. Author set to Karan Sharma. Rewrote all three
package READMEs, which were v0.2-era and are the npm landing pages: the CLI one documented 8
commands and omitted session/catchup/next/map/doctor; the MCP one listed 5 tools instead of 8.
Verified by packing all three, installing the tarballs into a clean project, and running the
packed binary: 15 commands present, core@0.3.0 resolved from the pin, init/scan/map/doctor all
work. 621 tests green.
Found a shipped bug while testing the CLI in a throwaway repo — see issue-stale-npm-hook.
The published 0.1.0 lacks `hook` and `instruct` because it was packed from a stale `dist/`,
so ambient capture has silently done nothing for every npm user since May. Added
`prepublishOnly: npm run build` to all three packages so a publish can never ship a stale
build again. Publishing 0.3.0 fixes the user-facing half.
Also corrected the record: CLAUDE.md and this file said npm publish was a pending human
action. It was not — task-phase-7-publish had it right all along. The Mastishk memory node was
accurate and the hand-maintained markdown tracker was the thing that drifted, which is a
tidy argument for the project's own thesis.
HUMAN ACTION: `npm login`, then publish core → cli → mcp in that order (cli and mcp pin
core@0.3.0 exactly, so core must exist on the registry first).

### 2026-08-10T02:00:00Z — claude-code

Phase 12 COMPLETE — **v0.3 is now fully implemented.** Every normative spec section has an
implementation and compliance coverage; the only recorded deviation is the §15.4 catchup source.
Delivered in @mastishk/cli: onboarding.ts — the canonical §14.3 briefing plus the §14.2
injection rules (create / append / leave alone / replace) shared by init and instruct. init now
writes AGENTS.md (canonical) and mirrors CLAUDE.md; instruct re-runs with replace:true so a
stale briefing gets refreshed. Replacement preserves project content following our section —
without that, re-running instruct would silently delete a project's own rules.
In @mastishk/mcp: mastishk_session_start / session_end / catchup, wired into the server
dispatch (8 tools total). session_end infers the agent when exactly one session is active and
refuses to guess when several are — it does not silently end the wrong one.
Also found and fixed: mastishk_update could not write map nodes (its layer enum predated the
map layer), so an agent could not refine a map entry via MCP even though §4.4 says agents do
exactly that. Added map + path; rewriting a map node now clears its stale flag, which is the
refresh cycle §4.4 describes.
616 tests green (32 files; new compliance 12-onboarding with 22 tests, 06-mcp-tools extended to
48), typecheck clean, core/cli/mcp build.
v0.2 behaviour changed deliberately (recorded in the spec changelog): the briefing now tells
agents to run `mastishk session start`, not `mastishk inject`. Five existing tests asserted the
old text and were updated in the same commit per the sequencing rule.
Cleared the last not-implemented markers from spec §10 and §14.2, and the last 🚧 from README
and CLAUDE.md. The implementation-status banner now says v0.3 is fully covered.
Next: Phase 13 — RelayBench. Start with the E0 exploration-token pilot on one repo before
building the full harness. Nothing publishable exists until Phase 13 produces results.

### 2026-08-10T01:00:00Z — claude-code

Phase 11 COMPLETE — v0.3 codebase map + plan nodes.
Delivered in @mastishk/core: map.ts (readMapEntries, markStaleByPaths, refreshMapNode,
makeMapNode, pathIsCovered), doctor.ts (full folder lint, violation/warning severity split,
ok flag driving the exit code). memory-map.json entries now cache `path` and `stale` so
ambient capture matches changed paths without opening every node file.
In @mastishk/cli: `map [--stale] [--refresh <id>]`, `next`, `doctor`; scan walks source files
and emits map nodes (confidence 0.6, scanned: true, tests and vendor dirs skipped); the
post-commit hook reads `git log -1 --name-only` and flags covering map nodes stale.
Inject already rendered the Codebase map section with (stale) markers from Phase 9.
578 tests green (31 files; new: map, doctor, cli-map-next-doctor, scan-map, compliance 10 and
11), typecheck clean, core/cli/mcp build.
Design notes worth keeping: path coverage matches on segment boundaries so `src/auth` never
stales `src/authz`; staleness flagging runs on EVERY commit, not just feat/fix/wip, because a
`chore:` refactor rots the map exactly as much as a feature does; scan de-duplicates truncated
map IDs to preserve §3.1 uniqueness.
Dogfooding found a real defect: `mastishk doctor` on this project's own memory reported
progress-phase-1 (the node CLAUDE.md tells every agent to update) missing from
memory-map.json — so inject had never surfaced it. Indexed it via nodeToMapEntry; doctor now
reports the folder healthy, 9 nodes, no findings. The tool earned its place on first run.
Also marked §14.2 (AGENTS.md canonical) and §10 (three session MCP tools) as not yet
implemented — both were specified without markers while the code does neither. Both are Phase 12.
Next: Phase 12 (AGENTS.md canonical instruct/init, MCP v0.3 tools, compliance for §14/§16).

### 2026-08-10T00:00:00Z — claude-code

Phase 10 COMPLETE — v0.3 session protocol. Verified clause-by-clause against spec §15 before
recording (not inferred from a green test run). Delivered in @mastishk/core: session.ts
(presence registry at sessions/active.json, §15.3 stale expiry via session_timeout_hours,
sessionStart = read + register only, sessionEnd = handoff node + last_session_at + deregister),
catchup.ts (§15.4 six-section ordered diff, 2000-char cap, findNextPlanStep). In @mastishk/cli:
session-cmd.ts (presence warning, TTY four-part handoff prompt, checkpoint that degrades
gracefully outside git), catchup-cmd.ts. Inject already renders the handoff section first (§6.4)
and marks stale map entries.
468 tests green (25 files, incl. compliance 09-sessions with 13 tests), typecheck clean,
core/cli/mcp all build.
SPEC-GAP recorded in catchup.ts: §15.4 specifies the diff is computed from git history of
.mastishk/ AND node timestamps; this implementation uses timestamps only. Timestamps answer
every ordered section and keep catchup working in an uncommitted memory folder. Git history
would add deleted-node detection and per-commit attribution — revisit if either becomes
load-bearing.
Also corrected claims that had drifted ahead of code: spec §15 and the §4.2 handoff paragraph
no longer carry "not yet in reference implementation"; README 🚧 removed from session/catchup/
handoff/sessions-dir; README 🚧 ADDED to AGENTS.md claims, which were false — init writes
CLAUDE.md only, AGENTS.md is Phase 12.
Phase 9 + 10 committed together — both had been sitting uncommitted since 2026-06-12.
Next: Phase 11 (map layer, scan→map nodes, hook staleness flagging, plan nodes, next, doctor).

### 2026-06-12T15:30:00Z — claude-code

Phase 9 COMPLETE — v0.3 core implemented with tests. See task-v03-implementation for detail.
Environment: Node 24 LTS installed (issue-npm-not-on-path resolved). 430 tests green,
typecheck clean, core/cli/mcp build. Spec §17 marker removed (now implemented).
The Referee is no longer a paper claim — it rejects contradicting writes, creates conflict
issue nodes, and honours flag/human/latest strategies, with compliance coverage.

### 2026-06-12T10:00:00Z — claude-code

Phase 8 COMPLETE — project restructured around the shared-memory session protocol (spec v0.3).
Strategic redesign from this session's discussion: pitch shifted from "a folder of markdown memory"
to "a session protocol for multi-agent collaboration" (check in → catch up → work → hand off);
six claims reframed as two core claims + nine mechanisms; research repositioned as benchmark-first.
Files created/modified (docs only — no src/ changes, see open issue on npm):
- MASTISHK-SPEC.md — rewritten as v0.3: session protocol (§15), catchup, handoff + plan node types,
  map/ codebase store with staleness contract (§4.4), resource type, deterministic Referee core +
  optional semantic extension (§8.3), concurrency + trust enforcement (§17), AGENTS.md canonical
  onboarding (§14), pluggable inject seeding + character budget (§6), testable ID uniqueness,
  knowledge history = git history. New sections marked "not yet in reference implementation".
- README.md — rewritten around session-protocol pitch, two core claims, honest 🚧 markers,
  catchup demo, comparison table softened + dated.
- METHODOLOGY.md — claims 7 (session protocol), 8 (catchup/episodic diff), 9 (codebase map +
  staleness) added as prior art; research content moved out to docs/RESEARCH.md.
- docs/RESEARCH.md — NEW: RelayBench design (multi-session multi-agent relay benchmark),
  4 conditions (no memory / flat file / RAG / Mastishk), 7 ablations, experiment sequence E0–E4.
- CLAUDE.md — two-claims framing, corrected source paths (src/packages/), new commands,
  phases 8–14 added to tracker, "claims must match code" rule added.
Next: Phase 9 (v0.3 core: schema, Referee, atomic writes, trust) — BLOCKED on npm availability.

### 2026-05-12T04:00:00.000Z — claude-code

Phase 3 CLI enhanced — enhanced init, instruct command, automated git hook pipeline — COMPLETE.
Files created/modified:
- src/packages/cli/src/commands/init.ts — interactive goal prompt, node writing, git hook install, richer CLAUDE.md
- src/packages/cli/src/commands/instruct.ts — agent-specific briefing (claude-code, cursor, windsurf, api)
- src/packages/cli/src/commands/hook.ts — git post-commit hook runner (auto-updates state memory)
- src/packages/cli/src/bin.ts — registered mastishk instruct and mastishk hook commands
- src/packages/mcp/src/bin.ts — added --memory-dir flag support
- src/packages/cli/package.json — added @inquirer/prompts dependency
- tests/unit/init.test.ts — 17 new tests for enhanced init (prompts, nodes, hook, CLAUDE.md)
- tests/unit/instruct.test.ts — 9 new tests for instruct command (all agents, memory summary)
- tests/unit/cli-init.test.ts — updated CLAUDE.md creation test for new behavior
SPEC-GAPs logged: interactive prompt (section 11), git hook (section 12), CLAUDE.md briefing format (section 13)
Total tests: 380 passing (18 test files).

### 2026-05-12T03:00:00.000Z — claude-code

Phase 7 complete (preparatory work). All packages bumped to 0.1.0, built clean.
Files created/modified:
- src/packages/core/package.json — v0.1.0, files[], keywords, repository, engines
- src/packages/cli/package.json — v0.1.0, same
- src/packages/mcp/package.json — v0.1.0, same
- src/packages/core/README.md — API docs
- src/packages/cli/README.md — CLI docs
- src/packages/mcp/README.md — MCP config docs
- README.md — full launch README
- docs/paper.tex — arXiv paper (LaTeX, cs.AI)
- docs/index.html — mastishk.dev website
Human actions required: npm publish (3 packages), arXiv upload, DNS/hosting for mastishk.dev.
357 tests still passing.

### 2026-05-12T02:00:00.000Z — claude-code

Phase 6 complete. Full compliance suite added at tests/compliance/.
Files created:
- tests/compliance/01-node-format.compliance.test.ts — section 3 (node format, required fields, round-trip)
- tests/compliance/02-layer-semantics.compliance.test.ts — section 4 (append-only, layer types)
- tests/compliance/03-graph-constraints.compliance.test.ts — section 5 (DAG, cycles, dangling refs, traversal)
- tests/compliance/04-inject-format.compliance.test.ts — section 6 (output format, first-sentence rule, layer ordering)
- tests/compliance/05-write-back.compliance.test.ts — section 7 (write contract, append headers, contradictions)
- tests/compliance/06-mcp-tools.compliance.test.ts — section 9 (tool names, descriptions, params, handlers)
- tests/compliance/07-cli-commands.compliance.test.ts — section 10 (all CLI commands)
Total tests: 357 passing.

### 2026-05-12T01:00:00.000Z — claude-code

Phase 5 complete. scan command added to @mastishk/cli.
Files created/modified:
- src/packages/cli/src/commands/scan.ts — scanInfer (package.json, git-log, readme), scanCommand
- src/packages/cli/src/bin.ts — added mastishk scan --yes
- tests/unit/cli-scan.test.ts — 17 tests, all pass
Total tests: 194 passing.

### 2026-05-12T00:00:00Z — claude-code

Started Phase 1. Scaffolding @mastishk/core package with schema.ts and validate.ts.
Files created:
- src/packages/core/package.json
- src/packages/core/tsconfig.json
- src/packages/core/src/schema.ts — MskNode, MskLayer, MskType, MskStatus, MskNodeSchema (zod)
- src/packages/core/src/validate.ts — validate(node: unknown): { valid, errors }
- src/packages/core/src/index.ts — re-exports
- tests/unit/schema.test.ts — full test suite for schema and validate
