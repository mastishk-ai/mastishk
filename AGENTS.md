## Mastishk memory

This project uses Mastishk for persistent shared agent memory.
Memory lives in `.mastishk/` — do not edit these files manually.
Multiple agents work on this project. Mastishk is the single brain they share.

**At the start of every session — do this first, before anything else:**
Run `mastishk session start --agent <your-agent-id> --task "<task>"`.
Read the full output: it contains the handoff from the previous session,
what changed since you were last here, goals, current state, constraints,
the codebase map, and open issues. Do not start work until you have read it.

**During the session:**
- If you complete a task: update its status in `state/`
- If you hit an error: log it with `mastishk log`
- If you learn something about the architecture: add it to `knowledge/`
- If a `map/` entry you rely on is marked (stale): verify it against the code and refresh it

**At the end of every session:**
Run `mastishk session end` and write a handoff covering:
Done / In flight / Watch out / Next.

**Memory layers:**
- `.mastishk/intent/` — goals, constraints, resources. Never modify without human confirmation.
- `.mastishk/state/` — tasks, plans, progress, handoffs. Update freely (append-only).
- `.mastishk/knowledge/` — architecture and decisions. Add as you learn.
- `.mastishk/map/` — which file does what. Keep fresh; trust is everything here.
- `.mastishk/issues/` — errors and blockers. Always log, never delete.
