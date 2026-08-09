# METHODOLOGY.md
# Mastishk Protocol — Methodology and Prior Art Declaration

**Authors:** Mastishk Protocol Contributors
**Organisation:** github.com/mastishk-ai
**Published:** 2026-05-12 · **Revised:** 2026-06-12 (claims 7–9 added)
**License:** Apache 2.0
**Document type:** Defensive publication — prior art establishment

---

## Purpose of this document

This document establishes public, timestamped prior art for the Mastishk protocol methodology. It is a defensive publication intended to prevent any party from patenting the ideas described herein against the open source community.

By publishing this document alongside the reference implementation and protocol specification, the authors place all described methodologies in the public domain as prior art. Any patent application filed after this publication date that claims these methodologies as novel would be invalid under prior art doctrine in most jurisdictions.

This document is a prior-art declaration, not a research paper. The empirical research programme — hypotheses, benchmark design, and evaluation — is maintained separately in `docs/RESEARCH.md` and will be published as an empirical paper once experiments are complete.

---

## The problem

AI coding agents — Claude Code, Cursor, GitHub Copilot, GPT-based agents — are stateless by default. Each session starts with no memory of prior decisions, architecture choices, errors encountered, or goals set. When multiple agents work on the same project, each holds at best a private, vendor-siloed memory invisible to the others.

The current workarounds all fail in predictable ways:

**Flat context injection** — developers manually maintain a `CLAUDE.md` or `RULES.md` file. This hits token limits, degrades attention as files grow, and goes stale because no agent updates it reliably.

**Vector RAG retrieval** — memory is embedded and retrieved by semantic similarity. This optimises for *proximity*, not *causality*. A goal node and a task node that depends on it may have low cosine similarity but a critical dependency relationship.

**Proprietary memory layers** — services like Mem0 store memory in their own infrastructure: tied to one vendor, inaccessible to other agents, not human-inspectable or git-versionable.

**No standard, no handoff** — there is no open format for agent memory, and no mechanism by which the understanding one agent builds in a session transfers to the next session or to a different agent.

---

## The two core claims

The Mastishk methodology reduces to two core claims; the numbered methodology claims below are mechanisms in their service.

**Core claim A — Project-owned shared memory.** Agent memory belongs to the project repository, not to any agent or vendor. All agents read and write the same memory through an explicit session protocol, making multi-agent collaboration a designed behaviour rather than an accident of file co-location.

**Core claim B — Structure-aware context injection.** Context for a task is assembled by traversing a typed dependency graph of memory nodes. Retrieval-by-similarity may select entry points, but causal graph structure — not similarity — determines what context an agent receives.

---

## The nine methodology claims

Each of the following is claimed as prior art as of the publication or revision date of this document.

### Claim 1 — Three-layer semantic memory architecture

Agent memory is divided into three semantically distinct layers with different persistence, update frequency, and agent trust levels:

- **intent/** — long-term goals, constraints, and resources. Set by humans. Rarely changed. Agents must not modify without confirmation.
- **state/** — current tasks, plans, progress, handoffs. Changes every session. Append-only writes.
- **knowledge/** — architecture decisions, technical facts, learned understanding. Grows over time. Replaceable with newer versions; git history is the version record.

This mirrors how human teams organise project knowledge — strategy (intent), execution (state), and accumulated learning (knowledge) — and maps to how agents should weight and trust different types of memory.

### Claim 2 — DAG traversal for context injection

When an agent needs context for a task, relevant memory is identified by traversing a directed acyclic graph of dependency-linked memory nodes. Seed selection (matching the task to entry nodes) is pluggable — keyword, BM25, or embedding similarity — but context composition follows dependency edges outward from the seeds, filtered by status and confidence, preserving causal structure: if Task A serves Goal B which is bound by Constraint C, all three are returned together because they are causally related, not because they are semantically similar.

### Claim 3 — Filesystem-native markdown nodes with YAML frontmatter

Every unit of agent memory is a `.msk.md` file — markdown with structured YAML frontmatter (id, type, layer, status, confidence, timestamps, dependencies, contradictions) and a human-readable markdown body. The format is human-editable, git-versionable, portable, and agent-native. Any tool that reads and writes this format correctly is a compliant Mastishk implementation.

### Claim 4 — Git as episodic memory

The git history of the `.mastishk/` folder is the project's episodic memory — a timestamped, immutable, content-addressed record of how understanding evolved. Memory checkpoints are git commits; version history of knowledge nodes is git history; the catch-up operation (Claim 8) is computed from this record.

### Claim 5 — Confidence-weighted nodes with a deterministic conflict Referee

Every node carries a `confidence` field (0.0–1.0): 1.0 human-set, 0.8 human-verified, 0.6 agent-inferred, 0.3 unverified. Before any write commits, a **Referee** checks the incoming node against declared `contradictions` references in both directions and applies a configured conflict strategy (flag / require human / accept-latest-and-deprecate), creating a conflict issue node for human resolution. Semantic (model-based) contradiction detection is an optional, pluggable extension of the same Referee interface. This prevents silent contradictions — the central failure mode of multi-agent shared memory.

### Claim 6 — Ambient memory capture via git hooks and agent tool use

Memory stays current without depending on developer or agent discipline: a post-commit git hook converts conventional commit messages into state updates and flags codebase-map entries whose files changed as stale; agent tool calls through MCP read and write memory as a natural part of task execution. Memory degrades gracefully rather than going catastrophically stale.

### Claim 7 — Session protocol for multi-agent shared memory *(added v0.3)*

Agent interaction with shared project memory is governed by an explicit session lifecycle: **session start** registers the agent's presence (agent ID, task, timestamp) in a shared registry and returns catch-up plus task context; **session end** writes a structured handoff and deregisters. Concurrent sessions are visible to each other (presence awareness); crashed sessions expire by timeout. Trust levels per registered agent are enforced at write time (confidence caps, layer restrictions, draft-gating for low-trust writers).

### Claim 8 — Catch-up: episodic diff as session onboarding *(added v0.3)*

When an agent begins a session, it receives a compact summary of everything that changed in shared memory since that specific agent's previous session — computed by diffing the memory folder's git history and node timestamps against the agent's recorded last-session time. The catch-up output is ordered: latest handoff, resolved tasks, new issues, changed knowledge, stale map entries, next unblocked plan step. This makes cross-agent and cross-session continuity a single read operation.

### Claim 9 — Codebase map with an ambient staleness contract *(added v0.3)*

A dedicated memory store maps repository files and modules to their purpose, key entry points, and gotchas — eliminating per-session re-exploration of the codebase. Each map node carries the file path it describes; the ambient capture hook marks a map node stale whenever a commit touches its path. Stale entries are visibly flagged in all context output and are never served as authoritative, ensuring agents trust the map only while it is verifiably current.

---

## How this differs from prior work

| System | Storage | Structure | Shared across agents | Session/handoff protocol | Open protocol |
|---|---|---|---|---|---|
| Mem0 | Hosted vector DB | Flat | No | No | No |
| Graphiti | Graph DB (Neo4j) | Graph | No | No | No |
| MemGPT / Letta | In-process | Hierarchical | No | No | No |
| LangMem | Vector + SQL | Flat | No | No | No |
| agentmemory | Markdown files | Flat | No | No | No |
| **Mastishk** | **Filesystem (markdown)** | **Typed DAG, 3 layers + map** | **Yes** | **Yes** | **Yes** |

*Characterisations reflect publicly documented capabilities as of mid-2026.*

The key differences:

1. **Filesystem-native** — no database as primary storage. The files ARE the memory.
2. **Protocol-first** — a specification with a compliance suite; any implementation in any language can be compliant.
3. **Multi-agent by design** — sessions, presence, catch-up, handoff, and conflict resolution are protocol-level constructs, not conventions.
4. **Open and portable** — Apache 2.0, no vendor dependency, runs on any filesystem.

---

## Empirical validation

The research programme validating these claims — including the multi-session, multi-agent **relay benchmark** (task continuity across agent handoffs), exploration-token-cost measurements for the codebase map, and ablations of individual mechanisms — is specified in `docs/RESEARCH.md`. Results will be published as a separate empirical paper; this document's purpose is limited to establishing the methodology as prior art.

---

## Prior art timestamp record

This document is published simultaneously at:

- GitHub: `github.com/mastishk-ai/mastishk` (commit timestamps for v1.0 and each revision)
- arXiv: cs.AI submission (pending — submission date establishes timestamp)

The combination of a public GitHub commit and an arXiv submission creates a robust, independently verifiable prior art record with dual timestamps from two trusted, permanently archived sources.

---

## Patent dedication

The authors hereby dedicate all described methodologies to the public domain as prior art and grant a royalty-free, irrevocable licence to implement, use, and distribute any system conforming to this methodology, subject to the terms of the Apache 2.0 licence covering the reference implementation.

Any entity that initiates patent litigation against a Mastishk user or contributor claiming that the methodologies described in this document constitute patentable inventions will, upon such initiation, forfeit all rights granted under the Apache 2.0 licence to use, copy, or distribute the reference implementation.

---

## How to cite this document

```
Mastishk Protocol Contributors. (2026). Mastishk: An Open Protocol for Structured,
Persistent, Filesystem-Native Shared Memory in AI Coding Agents.
github.com/mastishk-ai/mastishk. arXiv:XXXX.XXXXX [cs.AI].
```
