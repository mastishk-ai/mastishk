# RESEARCH.md
# Mastishk Research Programme — Hypotheses, Benchmark, and Evaluation Plan

**Status:** Design — experiments not yet run
**Last revised:** 2026-06-12

This document specifies the empirical research programme for Mastishk. The protocol spec (`MASTISHK-SPEC.md`) defines *what* the system is; the methodology document (`METHODOLOGY.md`) establishes prior art; this document defines *how the claims will be tested*. The eventual paper is an **empirical paper** whose primary contribution is the benchmark and its results — the protocol is the artifact attached to it.

---

## 1. Research question

> **Does structured, project-owned, shared memory improve multi-session, multi-agent coding — and at what token cost?**

Sub-questions:

- **RQ1 (continuity):** do agents complete multi-session task sequences more reliably with shared structured memory than with flat context files or no memory?
- **RQ2 (efficiency):** how many tokens does memory save — especially repository re-exploration — net of the cost of reading and maintaining the memory itself?
- **RQ3 (consistency):** does shared memory with a conflict Referee reduce violations of previously established constraints and decisions?
- **RQ4 (portability):** does memory written by one agent transfer to a *different* agent — the claim no single-vendor memory system can test?

---

## 2. Why a new benchmark

Existing coding benchmarks (SWE-bench and variants) are **single-shot**: one task, one session, no carried state. No public benchmark measures:

1. multi-session task sequences where later tasks depend on decisions made in earlier sessions,
2. **agent handoffs** — session *n* performed by a different agent than session *n−1*,
3. memory-system overhead vs. benefit, token-accounted.

The benchmark itself is therefore a primary contribution. Working name: **RelayBench** (tasks are relay legs; memory is the baton).

---

## 3. RelayBench design

### 3.1 Task structure

- **5–10 real repositories** (varied size/language; at minimum TypeScript and Python), pinned to fixed commits.
- Per repository, a **relay** of 3–5 tasks designed to be executed in separate, context-isolated sessions, with explicit cross-session dependencies. Canonical leg pattern:
  1. **Establish** — implement a feature; the session sets constraints (e.g. "all routes must use the new auth middleware") recorded however the condition permits
  2. **Repair** — fix a bug in (or introduced by) leg 1's work
  3. **Extend** — build on leg 1 under leg 1's constraints
  4. **Refactor** — restructure without violating any prior decision
- Each leg has machine-checkable success criteria: provided test suites + static checks for constraint compliance.

### 3.2 The relay (handoff) manipulation

Each relay runs in two variants:

- **Same-agent relay** — every leg by a fresh instance of the same agent (e.g. Claude Code), no conversation carryover
- **Cross-agent relay** — legs alternate between different agents (e.g. Claude Code → a second harness/agent → Claude Code), testing memory *portability* (RQ4)

### 3.3 Conditions (between-relay)

| Condition | Description |
|---|---|
| C0 — No memory | Cold start every leg. Floor. |
| C1 — Flat context file | A maintained CLAUDE.md/AGENTS.md the agent is told to read and update. Current best practice; the bar to beat. |
| C2 — Vector RAG | Memory chunks embedded; top-k retrieval by similarity at session start. The obvious alternative. |
| C3 — Mastishk | Full protocol: session start/end, catchup, handoff, inject, map, hooks. |

### 3.4 Metrics

| Metric | Measures | RQ |
|---|---|---|
| Leg success rate (tests pass) | task completion | RQ1 |
| Relay completion (all legs pass) | compounding continuity | RQ1 |
| **Exploration tokens per leg** (tokens in read/grep/glob tool results before first edit) | re-exploration cost | RQ2 |
| Total tokens per leg, incl. memory read/write overhead | net efficiency | RQ2 |
| Constraint violations per leg (static checks against leg-1 decisions) | consistency | RQ3 |
| Cross-agent deltas on all of the above | portability | RQ4 |
| Wall-clock time per leg | secondary | — |

Each condition × relay × variant runs **n ≥ 3** seeds; report means with dispersion. All runs scripted and reproducible (fixed model versions, pinned repos, published harness).

### 3.5 Ablations (within C3)

The protocol bundles mechanisms; ablations identify which ones matter. Each removes exactly one mechanism from full Mastishk:

| Ablation | Removes | Tests claim |
|---|---|---|
| A1 | handoff nodes (session end writes nothing) | Claim 7/8 — is the handoff the high-value write? |
| A2 | catchup (session start = inject only) | Claim 8 |
| A3 | map/ layer | Claim 9 — expected to dominate RQ2 |
| A4 | DAG traversal (seeds only, no graph expansion) | Claim 2 |
| A5 | layers (all nodes in one flat folder) | Claim 1 |
| A6 | Referee (writes always accepted) | Claim 5 |
| A7 | ambient capture (no git hook) | Claim 6 |

Negative results are publishable and expected for some rows; honesty about which mechanisms carry the effect strengthens the paper.

---

## 4. Experiment sequence (cheapest first)

1. **E0 — Exploration-token pilot (days, not weeks).** One repo, 3 legs, C0 vs C3-with-map only, measuring exploration tokens. Validates instrumentation and gives the first headline number before committing to the full grid. **Pre-registration drafted: [E0-PROTOCOL.md](E0-PROTOCOL.md)** — awaiting decisions on harness, model/budget, and repository before it can be locked and run.
2. **E1 — Single-repo full grid.** All conditions and both relay variants on one repository. Validates the harness, surfaces design flaws in legs/metrics.
3. **E2 — Full RelayBench.** All repos, conditions, variants, n ≥ 3.
4. **E3 — Ablations.** A1–A7 on the two repos with the largest C3-vs-C1 effect.
5. **E4 — Write-up.** Empirical paper: benchmark + results + ablations; protocol spec as artifact.

## 5. Threats to validity (to address in the paper)

- **Prompt sensitivity** — condition instructions must be comparably optimised; publish all prompts.
- **Memory maintenance burden** — C1's flat file must be *actively maintained* by the agent (realistic best practice), not frozen, or C3's advantage is inflated.
- **Benchmark leakage** — pinned repos may be in model training data; mitigate with held-out/private repos for a subset.
- **Agent discipline** — agents may skip memory instructions; log tool-call traces and report adherence rates per condition.
- **Author-built benchmark** — publish the harness and invite third-party condition implementations (especially better RAG baselines).

## 6. Publication plan

- **Defensive publication** (METHODOLOGY.md → arXiv) — establishes prior art; can go out before experiments.
- **Empirical paper** — after E2/E3: *"RelayBench: Measuring Shared Memory for Multi-Session, Multi-Agent Coding"* (working title). Venue targets: ICSE/FSE tracks on AI for SE, NeurIPS/ICLR datasets & benchmarks track, or COLM.
- Artifacts: benchmark harness, task definitions, traces, and the reference implementation, all Apache 2.0.
