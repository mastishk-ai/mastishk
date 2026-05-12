---
id: fact-append-only-rule
type: decision
layer: knowledge
status: active
confidence: 1
created_by: human
created_at: '2026-05-12T13:21:57.157Z'
last_updated_by: human
last_updated_at: '2026-05-12T13:21:57.168Z'
dependencies:
  - goal-mastishk-launch
contradictions: []
tags:
  - spec
  - state
  - write
---
State layer writes MUST be append-only. New content appended with ### {ISO} — {agent} header. Never overwrite existing body. See spec section 7.2.
