---
id: fact-scan-map-quality
type: fact
layer: knowledge
status: active
confidence: 0.9
created_by: claude-code
created_at: 2026-08-11T00:00:00Z
last_updated_by: claude-code
last_updated_at: 2026-08-11T00:00:00Z
dependencies: []
contradictions: []
tags: [scan, map, quality, relaybench, measured]
---

Measured quality of `mastishk scan`'s codebase-map inference on real third-party code.

Benchmark: sindresorhus/got at commit e3924aa, cloned fresh, scanned with @mastishk/cli 0.3.0.

Before the 2026-08-11 precision fix: 40 map entries, of which 15 (37%) were `test/`,
`benchmark/` and `documentation/examples/` files — not the codebase's substance. One entry
falsely claimed `Exports: Returns` for a *non-exported local generic type*, which is precisely
the "map that lies" failure the staleness contract exists to prevent.

After the fix (skip test/bench/docs/example dirs; separate genuine `export` detection from
top-level definitions in export-less languages; never report a local `type` as an export):
25 entries, all under `source/`. Of those, **11 carry a useful summary and 12 say "Purpose not
inferred — refine this entry"**.

What that means, stated plainly: on an unfamiliar TypeScript repo with few leading file
comments, scan seeds slightly under half the map with something an agent can use. The rest are
honest placeholders at confidence 0.6. This is the designed behaviour — scan seeds, agents
refine during sessions (spec §4.4) — but it bounds how much of the "agents stop re-exploring"
benefit is available on turn one, before any agent has worked in the repo.

Relevant to RelayBench (Phase 13): the C3-with-map condition should NOT be evaluated purely on
a freshly scanned map, or it measures comment-density in the target repo rather than the
protocol. Either let leg 1 refine the map (the realistic case), or report scan-only and
refined-map numbers separately. The comment density of the chosen repo is a confound and
should be recorded as a property of each benchmark repo.
