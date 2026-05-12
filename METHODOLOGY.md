# METHODOLOGY.md
# Mastishk Protocol — Methodology and Prior Art Declaration

**Authors:** Mastishk Protocol Contributors  
**Organisation:** github.com/mastishk  
**Published:** 2026-05-12  
**License:** Apache 2.0  
**Document type:** Defensive publication — prior art establishment  

---

## Purpose of this document

This document establishes public, timestamped prior art for the Mastishk protocol methodology. It is a defensive publication intended to prevent any party from patenting the ideas described herein against the open source community.

By publishing this document alongside the reference implementation and protocol specification, the authors place all described methodologies in the public domain as prior art. Any patent application filed after this publication date that claims these methodologies as novel would be invalid under prior art doctrine in most jurisdictions.

This document is intended to be submitted to arXiv (cs.AI) and referenced in all subsequent academic and technical publications about Mastishk.

---

## The problem

AI coding agents — Claude Code, Cursor, GitHub Copilot, GPT-based agents — are stateless by default. Each session starts with no memory of prior decisions, architecture choices, errors encountered, or goals set.

The current workarounds all fail in predictable ways:

**Flat context injection** — developers manually maintain a `CLAUDE.md` or `RULES.md` file and paste it into every session. This hits token limits quickly, degrades attention as files grow, and goes stale because no agent updates it reliably.

**Vector RAG retrieval** — memory is embedded and retrieved by semantic similarity. This optimises for *proximity*, not *causality*. A goal node and a task node that depends on it may have low cosine similarity but a critical dependency relationship. RAG cannot represent this.

**Proprietary memory layers** — services like Mem0 store memory in their own infrastructure. Memory is tied to one vendor, inaccessible to other agents, and not human-inspectable or git-versionable.

**No standard** — there is no open, portable, interoperable format for agent memory. An agent built with one memory system cannot share memory with an agent built on another.

---

## The six methodology claims

The following six ideas constitute the Mastishk methodology. Each is claimed as prior art as of the publication date of this document.

### Claim 1 — Three-layer semantic memory architecture

Agent memory is divided into three semantically distinct layers with different persistence, update frequency, and agent trust levels:

- **intent/** — long-term goals and constraints. Set by humans. Rarely changed. Agents must not modify without confirmation.
- **state/** — current tasks, progress, blockers, outcomes. Changes frequently. Append-only writes.
- **knowledge/** — architecture decisions, technical facts, learned understanding. Grows over time. Replaceable with newer versions.

This three-layer separation is the core architectural insight. It mirrors how human teams organise project knowledge — strategy (intent), execution (state), and accumulated learning (knowledge) — and maps naturally to how agents should weight and trust different types of memory.

### Claim 2 — DAG traversal for context injection

When an agent needs context for a task, the relevant memory is identified by traversing a directed acyclic graph of dependency-linked memory nodes — not by vector similarity, recency, or keyword search.

The traversal starts from nodes matched to the task description, follows dependency edges outward up to a configurable depth, filters by node status and confidence, and returns a compact, structured context string.

This approach preserves causal structure. If Task A depends on Goal B which is constrained by Constraint C, all three are returned together — because they are causally related to the task, not just semantically similar to it. RAG cannot produce this result reliably because it optimises for proximity in embedding space, not graph reachability.

### Claim 3 — Filesystem-native markdown nodes with YAML frontmatter

Every unit of agent memory is stored as a `.msk.md` file — a markdown file with structured YAML frontmatter containing metadata (id, type, layer, status, confidence, timestamps, dependencies, contradictions) and a markdown body containing the human-readable content.

This format is:
- **Human-readable and editable** — developers can inspect and modify memory without special tools
- **Git-versionable** — the entire memory folder can be committed, diffed, branched, and rolled back
- **Portable** — no database, no binary format, no vendor dependency
- **Agent-native** — markdown with structured metadata is well within the reasoning capabilities of current LLMs

The `.msk.md` format is the physical manifestation of the protocol. Any tool that reads and writes this format correctly is a compliant Mastishk implementation.

### Claim 4 — Git as episodic memory

The git history of the `.mastishk/` folder is treated as the agent's episodic memory — a timestamped, immutable record of how the project's understanding evolved over time.

`mastishk checkpoint` commits the current memory state with a structured commit message. The git log of `.mastishk/` is therefore queryable as a timeline of agent cognition: what was known when, what changed, what was decided.

This is not a metaphor. The git object store is a content-addressed, cryptographically verifiable record of every memory state. It is more reliable than any purpose-built episodic memory system.

### Claim 5 — Confidence-weighted nodes with contradiction detection via a Referee layer

Every memory node carries a `confidence` field (0.0–1.0) representing the reliability of its content:

- `1.0` — set by a human explicitly
- `0.8` — verified by a human after agent creation
- `0.6` — inferred by an agent from project context (e.g. via `mastishk scan`)
- `0.3` — unverified, speculative

Before any agent write is committed, a **Referee** layer checks the incoming node against existing nodes in the graph. If the incoming content contradicts an existing node (via explicit `contradictions` references or confidence-weighted semantic comparison), the write is rejected and a conflict issue is created for human resolution.

This prevents the most common failure mode of multi-agent memory systems: silent contradictions where Agent A and Agent B both write conflicting beliefs into the same memory without either knowing.

### Claim 6 — Ambient memory capture via git hooks and agent tool use

Memory stays current without developer overhead through two ambient mechanisms:

**Post-commit git hooks** — when `mastishk init` is run, a post-commit hook is installed. Every git commit triggers an automatic scan of the commit message and diff, creating or updating memory nodes in `state/` without the developer taking any explicit action. The commit workflow developers already use becomes the memory writing mechanism.

**Agent tool use via MCP** — when agents call `mastishk_inject`, `mastishk_update`, and `mastishk_log` through the MCP server, memory is read and written as a natural part of the agent's task execution. No human intervention required for routine memory maintenance.

These two mechanisms together mean memory degrades gracefully rather than going catastrophically stale. Even if a developer stops thinking about memory entirely, git commits keep state current and agent tool calls keep knowledge growing.

---

## How this differs from prior work

| System | Storage | Structure | Multi-agent | Open protocol |
|---|---|---|---|---|
| Mem0 | Hosted vector DB | Flat embeddings | No | No |
| Graphiti | Graph DB (Neo4j) | Graph | No | No |
| MemGPT / Letta | In-process | Hierarchical | No | No |
| LangMem | Vector + SQL | Flat | No | No |
| agentmemory | Markdown files | Flat | No | No |
| **Mastishk** | **Filesystem (markdown)** | **DAG (three-layer)** | **Yes** | **Yes** |

The key differences:

1. **Filesystem-native** — no database of any kind as primary storage. The files ARE the memory.
2. **Protocol-first** — Mastishk is a specification, not just a library. Any implementation in any language that passes the compliance suite is Mastishk-compliant.
3. **Multi-agent by design** — the memory folder belongs to the project, not to any agent. All agents read and write the same folder. Conflict resolution is built into the protocol.
4. **Open and portable** — Apache 2.0 licensed, no vendor dependency, runs on any filesystem.

---

## Research claims suitable for empirical validation

The following claims are testable and intended to be validated in the accompanying research paper:

**Hypothesis 1 — Task continuity** — an agent using Mastishk memory completes a multi-session coding task in fewer sessions and with fewer contradictions than an agent using flat context injection or no memory.

**Hypothesis 2 — Context efficiency** — `mastishk inject` delivers equivalent or better task performance at significantly lower token cost than full context injection, by traversing only the causally relevant subgraph.

**Hypothesis 3 — Contradiction reduction** — the Referee layer reduces the rate at which agents produce outputs that contradict prior decisions, compared to agents operating without structured memory.

These hypotheses are testable using the Claude API with reproducible task sets. The experimental methodology will be published alongside the reference implementation.

---

## Prior art timestamp record

This document is published simultaneously at:

- GitHub: `github.com/mastishk/mastishk` (commit timestamp)
- arXiv: cs.AI submission (pending — submission date establishes timestamp)

The combination of a public GitHub commit and an arXiv submission creates a robust, independently verifiable prior art record with dual timestamps from two trusted, permanently archived sources.

---

## Patent dedication

The authors hereby dedicate all described methodologies to the public domain as prior art and grant a royalty-free, irrevocable licence to implement, use, and distribute any system conforming to this methodology, subject to the terms of the Apache 2.0 licence covering the reference implementation.

Any entity that initiates patent litigation against a Mastishk user or contributor claiming that the methodologies described in this document constitute patentable inventions will, upon such initiation, forfeit all rights granted under the Apache 2.0 licence to use, copy, or distribute the reference implementation.

---

## How to cite this document

```
Mastishk Protocol Contributors. (2026). Mastishk: A Sanskrit-Rooted Open Protocol
for Structured, Persistent, Filesystem-Native Memory in AI Coding Agents.
github.com/mastishk/mastishk. arXiv:XXXX.XXXXX [cs.AI].
```
