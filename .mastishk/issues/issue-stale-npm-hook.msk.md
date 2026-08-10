---
id: issue-stale-npm-hook
type: issue
layer: issues
status: active
confidence: 1.0
created_by: claude-code
created_at: 2026-08-10T03:00:00Z
last_updated_by: claude-code
last_updated_at: 2026-08-10T03:00:00Z
dependencies:
  - task-phase-7-publish
contradictions: []
tags: [npm, publish, hook, ambient-capture, shipped-bug]
---

Ambient capture is broken for every user who installs from npm today.

`mastishk init` writes a post-commit hook containing `npx @mastishk/cli hook`. The published
package is 0.1.0 (2026-05-12), which predates the `hook` command, so npx downloads it and
fails with `error: unknown command 'hook'`. The commit still succeeds, so nothing surfaces the
failure — state memory is never appended and map entries are never flagged stale. A headline
mechanism silently does nothing.

Found 2026-08-10 by running the CLI in a throwaway demo repo rather than through the test
suite. The unit and compliance tests call `hookCommand()` directly, so they never exercise the
`npx` indirection the real hook depends on. That gap is why this survived four phases.

ROOT CAUSE: the published 0.1.0 tarball contains only seven command files — no `hook.js`, no
`instruct.js` — even though Phase 3b had added both hours before the publish. `files: ["dist"]`
packs whatever happens to be sitting in `dist/`, and nothing forced a rebuild, so the release
shipped a stale build that did not match the source tree at publish time. The publish note
claiming "verified from fresh install" was checking commands that predated the gap.
Fixed 2026-08-10 by adding `"prepublishOnly": "npm run build"` to all three packages, so a
publish can no longer ship a stale `dist/`.

Record correction: CLAUDE.md's phase table and `state/progress.msk.md` both said npm publish
was still a pending human action. It was not — all three packages went out at 0.1.0 on
2026-05-12 under npm user `karansharma1732`. Note that `state/task-phase-7-publish` recorded
this correctly all along; the hand-maintained tracker in CLAUDE.md was the thing that drifted.

FIX: publishing 0.3.0 resolves it, since that build has the `hook` command. Prepared
2026-08-10 (versions bumped, cross-package pins updated, READMEs rewritten, tarballs verified
by installing them and running the packed binary). Awaiting `npm login` + `npm publish` —
this machine is not authenticated.

Still open after publishing:
- Local development still resolves the hook through npx to the registry, so a dev working on
  the CLI tests the published build, not their working tree. Consider a path-based hook when
  init detects a local dev install.
- Consider a test that runs the installed binary end to end, so the next packaging regression
  is caught by CI rather than by hand.
