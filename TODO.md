# Mastishk — What's Left

> Generated 2026-08-10, last updated 2026-08-10 (phases 9, 10 + 11 closed out).
> Baseline: 578 tests green, 31 test files, typecheck clean, core/cli/mcp all build.
> Spec: `MASTISHK-SPEC.md` v0.3 draft. Phase table: `CLAUDE.md`.

---

## 0. ~~Do this first — the repo is undefended~~ ✅ DONE 2026-08-10

Phases 9 and 10 had been sitting uncommitted since 2026-06-12. Now committed.

- [x] Commit Phase 9 (referee, trust, lock, atomic, commit, agents)
- [x] Commit Phase 10 (session, catchup, session-cmd, catchup-cmd, compliance 09)
- [x] Commit `docs/RESEARCH.md` (untracked since Phase 8)
- [x] Add LaTeX build artifacts to `.gitignore`; `docs/paper.pdf` tracked

---

## 1. ~~Bookkeeping — claims that no longer match code~~ ✅ DONE 2026-08-10

- [x] Verify session start/end + catchup against spec §15 clause by clause. **Result:**
      compliant on §15.1–15.4, §4.2, §6.4. One deviation found and recorded as a SPEC-GAP —
      catchup computes from node timestamps only, not the git history of `.mastishk/` that
      §15.4 also specifies. Timestamps answer every ordered section; git history would add
      deleted-node detection and per-commit attribution.
- [x] Phase 9 re-verified against §8.3 (Referee), §17.1 (atomic), §17.2 (lock), §17.3 (trust) —
      compliant, no gaps
- [x] `.mastishk/state/progress.msk.md` — Phase 10 entry appended
- [x] `.mastishk/state/task-v03-implementation.msk.md` — Phase 10 result appended
- [x] `CLAUDE.md` — Phase 10 row ⬜ → ✅
- [x] `MASTISHK-SPEC.md` §15 + §4.2 — "not yet in reference implementation" markers dropped
- [x] `MASTISHK-SPEC.md` — implementation-status banner rewritten, changelog row added
- [x] `README.md` — 🚧 removed from session / catchup / handoff / `sessions/`
- [x] 🚧 kept on `map/`, `next`, `doctor`, MCP v0.3 tools — genuinely unbuilt
- [x] **Found while verifying:** README claimed `init` writes `AGENTS.md`. It does not —
      `init.ts` writes `CLAUDE.md` only. Claim marked 🚧 rather than left false (Phase 12 fixes it).

---

## 2. ~~Phase 11 — map layer + plan nodes~~ ✅ DONE 2026-08-10

All of §4.4, §16.1 step 4, and the §11 `map` / `next` / `doctor` commands are implemented,
with compliance suites 10 and 11. 578 tests green.

### 2.1 Map nodes (spec §4.4) ✅
- [x] `core/map.ts` — `readMapEntries`, `markStaleByPaths`, `refreshMapNode`, `makeMapNode`, `pathIsCovered`
- [x] inject renders a **Codebase map** section when map nodes match (already in place from Phase 9)
- [x] inject renders stale map nodes with a visible `(stale)` marker
- [x] `memory-map.json` caches `path` and `stale` so the hook matches changed paths without
      opening every node file

### 2.2 scan → map (spec §11) ✅
- [x] `scan` walks source files and emits map nodes (`confidence: 0.6`, `scanned: true`)
- [x] Summary prefers a leading file comment, falls back to the exported surface, and says
      "Purpose not inferred" rather than inventing one
- [x] Skips `node_modules`/`dist`/vendor dirs and `*.test.*` / `*.spec.*`
- [x] De-duplicates truncated IDs so §3.1 uniqueness holds on deep paths

### 2.3 Staleness contract (spec §16.1 step 4) ✅
- [x] `cli hook` reads changed paths via `git log -1 --name-only`
- [x] Flags every map node whose `path` covers a changed file
- [x] **Runs on every commit, not just `feat:`/`fix:`/`wip:`** — a `chore:` refactor rots the
      map exactly as much as a feature does
- [x] Path matching respects segment boundaries: `src/auth` never stales `src/authz`
- [x] Tested against a real git repo, not a mock

### 2.4 `mastishk map` (spec §11) ✅
- [x] `map`, `map --stale`, `map --refresh <id>`

### 2.5 Plan nodes + `mastishk next` (spec §11) ✅
- [x] `next` returns the first unblocked step of the most recently updated active plan
- [x] Prints exactly `No active plan.` when none exists
- [x] Distinguishes "no plan" from "active plan, nothing unblocked" — the second would
      otherwise send an agent hunting for a plan that exists

### 2.6 `mastishk doctor` (spec §11) ✅
- [x] Validates schema, layer/type pairing, graph constraints, ID uniqueness
- [x] Surfaces expired nodes, stale map entries, long-running sessions
- [x] Also catches index drift: nodes on disk missing from `memory-map.json`, and index
      entries pointing at files that do not exist
- [x] `violation` vs `warning` severity; non-zero exit only on MUST-level violations
- [x] **Found a real defect on first run:** `progress-phase-1` — the node CLAUDE.md tells every
      agent to update — was missing from this project's own `memory-map.json`, so `inject`
      had never surfaced it. Now indexed; doctor reports the folder healthy.

---

## 3. Phase 12 — onboarding + MCP + compliance

### 3.1 AGENTS.md canonical (spec §14)
Zero references to `AGENTS.md` anywhere in `src/packages/cli/src/`. `init` writes `CLAUDE.md`
only, so the canonical file is the one that doesn't get written.
- [ ] `init` writes the briefing to `AGENTS.md` (canonical), mirrors into `CLAUDE.md`
- [ ] Injection rules §14.2: append if file exists without `## Mastishk memory`; create if absent;
      leave unchanged on `init` if already present
- [ ] `instruct` MAY replace an existing section with the current canonical format
- [ ] Section format per §14.3 (heading, session-start instruction, layers, end-of-session)

### 3.2 MCP v0.3 tools (spec §10)
Server exposes only the 5 v0.2 tools. Three are missing.
- [ ] `mastishk_session_start` — `agent`, `task` → presence + catchup + inject
- [ ] `mastishk_session_end` — `handoff` → handoff node, deregister, checkpoint
- [ ] `mastishk_catchup` — `agent` → changes since that agent's last session
- [ ] Tool descriptions are protocol surface — write them for an agent seeing them cold
- [ ] Single-writer mode (§16.2) — serialise writes through the server

### 3.3 Compliance
- [x] `10-map-staleness.compliance.test.ts` — §4.4 + §16.1 (16 tests)
- [x] `11-plans-doctor.compliance.test.ts` — §11 `next` / `doctor` (18 tests)
- [x] `07-cli-commands` extended with `next` / `map` / `doctor`, renumbered §10 → §11
- [ ] `12-onboarding.compliance.test.ts` — §14 AGENTS.md rules
- [ ] Extend `06-mcp-tools.compliance.test.ts` to the 8-tool table
- [x] Spec §18 compliance list updated to match

---

## 4. Phase 13 — RelayBench (the phase that unlocks publication)

Per `docs/RESEARCH.md`. **Nothing here exists yet, and nothing publishable exists until it does.**

- [ ] **E0 pilot** — exploration-token measurement on one repo. Cheapest possible signal
      that the core effect is real. Do this before building the full harness.
- [ ] Harness: multi-session, multi-agent relay execution
- [ ] 4 conditions: no memory / flat file / RAG / Mastishk
- [ ] 7 ablations (isolates *which* mechanism pays — reviewers will demand this)
- [ ] E1–E4 per RESEARCH.md
- [ ] Task suite + repo selection, frozen before data collection
- [ ] Cost/token accounting per condition
- [ ] Statistical plan: effect sizes + CIs, not bare p-values; pre-register n
- [ ] Release harness + tasks + raw logs as an artifact (see §6)

---

## 5. Phase 14 — paper rewrite

`docs/paper.tex` builds cleanly to an 8-page PDF, but it is **the v0.2 paper**: dated May 2026,
structured around "The Six Methodology Claims", zero mentions of the session protocol, shared
memory, catchup, or RelayBench. It does not describe the project as it now exists.

- [ ] Reframe around the two core claims (project-owned shared memory; structure-aware injection)
- [ ] Replace §"The Six Methodology Claims" with the two-claims + nine-mechanisms structure
- [ ] Replace §"Empirical Hypotheses" with **actual RelayBench results** — this is the whole game
- [ ] Add the multi-agent relay motivation absent from the current draft
- [ ] Related work: refresh against 2026 agent-memory literature
- [ ] Threats to validity section (currently none — automatic reviewer complaint)
- [ ] Keep the `\lstdefinelanguage` yaml/json fix at `docs/paper.tex:19` (build depends on it)

---

## 6. Publication track

See the venue analysis below. Ordering matters more than venue choice.

- [ ] arXiv preprint of the **current** v0.3 protocol paper — prior-art timestamp, do early,
      does not consume a venue submission
- [ ] Run Phase 13 **before** any journal submission
- [ ] Consider a **registered report** to EMSE/ICSE-RR — hypotheses are already pre-specified
      in RESEARCH.md, which is exactly the artifact that track wants, and it locks in
      credibility before results exist
- [ ] Artifact package: spec + reference impl + compliance suite + RelayBench harness + raw data
      (targets ACM/IEEE *Artifacts Available + Reusable* badges; the compliance suite is an
      unusually strong artifact story — lean on it)
- [ ] Submit to primary venue (see recommendation), hold JSS/IST as the fast fallback

### Venue shortlist (Q1)

| Venue | IF (approx) | Fit | Note |
|---|---|---|---|
| **Empirical Software Engineering** (EMSE, Springer) | ~4.0 | ★★★★★ | Benchmark + empirical eval + tool is exactly its remit. **Has a registered-report track.** Primary target. |
| **ACM TOSEM** | ~4.4 | ★★★★★ | Protocol + formal compliance notion + eval. Highest prestige realistically reachable. Slow. |
| **IEEE TSE** | ~6.5 | ★★★★☆ | Top SE journal. Needs the strongest possible eval; thin empirics get desk-rejected. |
| **Journal of Systems and Software** (JSS) | ~3.7 | ★★★★☆ | Systems/tool friendly, faster turnaround. Solid fallback. |
| **Information and Software Technology** (IST) | ~3.8 | ★★★★☆ | Similar to JSS. Fallback. |
| **ACM TIST** | ~7.2 | ★★★☆☆ | Only if framed as an intelligent-agent-systems paper rather than SE. |
| **ACM TOIS** | ~5.4 | ★★★☆☆ | Only if the paper leads with retrieval — "causal traversal vs. vector similarity". |

Do **not** target Nature Machine Intelligence or ACM Computing Surveys — wrong paper type.

### Conference alternative
In software engineering, **ICSE / FSE / ASE** carry more weight than most Q1 journals and are
much faster. If "Q1 journal" is a hard institutional requirement, ignore this; otherwise
FSE or ASE is arguably the better home for this work, with an EMSE extension afterwards.

---

## Status snapshot

| Phase | What | Status |
|---|---|---|
| 0–8 | Spec, core, CLI, MCP, scan, compliance v0.2, v0.3 restructure | ✅ committed |
| 9 | v0.3 core: schema, Referee, atomic writes, trust | ✅ verified vs §8.3/§17, committed 2026-08-10 |
| 10 | v0.3 sessions: start/end, catchup, handoff, presence | ✅ verified vs §15, committed 2026-08-10 |
| 11 | map layer, scan→map, staleness, plans, `next`, `doctor` | ✅ verified vs §4.4/§11/§16.1, committed 2026-08-10 |
| 12 | AGENTS.md canonical, MCP v0.3 tools, compliance §14/§16 | ⬜ **next up** — the only v0.3 gaps left |
| 13 | RelayBench E0 → full harness | ⬜ not started |
| 14 | Empirical paper rewrite | ⬜ blocked on 13 |

**Also still open from Phase 7 (human actions):** npm publish (`@mastishk/core`, `@mastishk/cli`,
`@mastishk/mcp`), arXiv upload, mastishk.dev DNS/hosting.
