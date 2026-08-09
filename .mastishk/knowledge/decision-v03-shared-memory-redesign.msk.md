---
id: decision-v03-shared-memory-redesign
type: decision
layer: knowledge
status: active
confidence: 1.0
created_by: claude-code
created_at: 2026-06-12T10:00:00Z
last_updated_by: claude-code
last_updated_at: 2026-06-12T10:00:00Z
dependencies:
  - goal-mastishk-launch
contradictions: []
tags: [v0.3, redesign, sessions, shared-memory, relaybench]
verified: true
---

Spec v0.3 redesign (2026-06-12, human-approved): Mastishk is framed as a shared-memory
session protocol — check in → catch up → work → hand off — not just a memory folder.
Two core claims replace the six-claim framing: (A) project-owned shared memory with an
explicit session protocol, (B) structure-aware injection where seeding is pluggable and
causality decides inclusion. New mechanisms: map/ codebase store with staleness contract,
plan + handoff + resource node types, catchup from git history, deterministic Referee core,
trust enforcement, AGENTS.md as canonical onboarding. Research strategy is benchmark-first
(RelayBench, docs/RESEARCH.md); the paper becomes empirical, written after experiments.
Rule established: claims must match code — unimplemented spec sections carry an explicit marker.
