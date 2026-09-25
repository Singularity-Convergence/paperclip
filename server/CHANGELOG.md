# @paperclipai/server

## Unreleased

### Patch Changes

- Bound full-tree workspace Git scans with process-wide concurrency, queue, timeout, cancellation, coalescing, and short-lived changed-file caching. Saturated or timed-out changed-file requests now return a retryable degraded response, and hidden file-browser panels no longer initiate scans.

## 0.3.1

### Patch Changes

- Stable release preparation for 0.3.1
- Updated dependencies
  - @paperclipai/adapter-utils@0.3.1
  - @paperclipai/adapter-claude-local@0.3.1
  - @paperclipai/adapter-codex-local@0.3.1
  - @paperclipai/adapter-cursor-local@0.3.1
  - @paperclipai/adapter-gemini-local@0.3.1
  - @paperclipai/adapter-openclaw-gateway@0.3.1
  - @paperclipai/adapter-opencode-local@0.3.1
  - @paperclipai/adapter-pi-local@0.3.1
  - @paperclipai/db@0.3.1
  - @paperclipai/shared@0.3.1

## 0.3.0

### Minor Changes

- Stable release preparation for 0.3.0

### Patch Changes

- Updated dependencies [6077ae6]
- Updated dependencies
  - @paperclipai/shared@0.3.0
  - @paperclipai/adapter-utils@0.3.0
  - @paperclipai/adapter-claude-local@0.3.0
  - @paperclipai/adapter-codex-local@0.3.0
  - @paperclipai/adapter-cursor-local@0.3.0
  - @paperclipai/adapter-openclaw-gateway@0.3.0
  - @paperclipai/adapter-opencode-local@0.3.0
  - @paperclipai/adapter-pi-local@0.3.0
  - @paperclipai/db@0.3.0

## 0.2.7

### Patch Changes

- Version bump (patch)
- Updated dependencies
  - @paperclipai/shared@0.2.7
  - @paperclipai/adapter-utils@0.2.7
  - @paperclipai/db@0.2.7
  - @paperclipai/adapter-claude-local@0.2.7
  - @paperclipai/adapter-codex-local@0.2.7
  - @paperclipai/adapter-openclaw@0.2.7

## 0.2.6

### Patch Changes

- Version bump (patch)
- Updated dependencies
  - @paperclipai/shared@0.2.6
  - @paperclipai/adapter-utils@0.2.6
  - @paperclipai/db@0.2.6
  - @paperclipai/adapter-claude-local@0.2.6
  - @paperclipai/adapter-codex-local@0.2.6
  - @paperclipai/adapter-openclaw@0.2.6

## 0.2.5

### Patch Changes

- Version bump (patch)
- Updated dependencies
  - @paperclipai/shared@0.2.5
  - @paperclipai/adapter-utils@0.2.5
  - @paperclipai/db@0.2.5
  - @paperclipai/adapter-claude-local@0.2.5
  - @paperclipai/adapter-codex-local@0.2.5
  - @paperclipai/adapter-openclaw@0.2.5

## 0.2.4

### Patch Changes

- Version bump (patch)
- Updated dependencies
  - @paperclipai/shared@0.2.4
  - @paperclipai/adapter-utils@0.2.4
  - @paperclipai/db@0.2.4
  - @paperclipai/adapter-claude-local@0.2.4
  - @paperclipai/adapter-codex-local@0.2.4
  - @paperclipai/adapter-openclaw@0.2.4

## 0.2.3

### Patch Changes

- Version bump (patch)
- Updated dependencies
  - @paperclipai/shared@0.2.3
  - @paperclipai/adapter-utils@0.2.3
  - @paperclipai/db@0.2.3
  - @paperclipai/adapter-claude-local@0.2.3
  - @paperclipai/adapter-codex-local@0.2.3
  - @paperclipai/adapter-openclaw@0.2.3

## 0.2.2

### Patch Changes

- Version bump (patch)
- Updated dependencies
  - @paperclipai/shared@0.2.2
  - @paperclipai/adapter-utils@0.2.2
  - @paperclipai/db@0.2.2
  - @paperclipai/adapter-claude-local@0.2.2
  - @paperclipai/adapter-codex-local@0.2.2
  - @paperclipai/adapter-openclaw@0.2.2

## 0.2.1

### Patch Changes

- Version bump (patch)
- Updated dependencies
  - @paperclipai/shared@0.2.1
  - @paperclipai/adapter-utils@0.2.1
  - @paperclipai/db@0.2.1
  - @paperclipai/adapter-claude-local@0.2.1
  - @paperclipai/adapter-codex-local@0.2.1
  - @paperclipai/adapter-openclaw@0.2.1

## 2026.916.1-sc1 (2026-09-25) — SC-fork hotfix vendor of SIN-2283 self-heal

**Vendored from**: `Singularity-Convergence/paperclip` SC fork commit `bc919d716f6310befcda5a5df5609a28a0a69915` ("fix(ui): self-heal stale :submission:v1 fence on composer mount (SIN-2283 / SIN-2284) (#1)").

**Production-code scope only** (per Phase 2 design revision `15b23b2e` on [SIN-2338](/SIN/issues/SIN-2338), `bc919d716` is an ancestor of the SC fork `master` HEAD `a21098d6869`):

- `ui/src/components/task-chat/TaskChatComposer.tsx` — composer-mount self-heal branch: `clearDraftSubmission(draftKey, retained.attemptId)` is called when the persisted `:submission:v1` attemptId no longer matches `pendingDraftRef.current.attemptId` and the attemptId is not in the server-acknowledged `confirmedSubmissionIds` set. Mount-effect dependency array expanded from `[draftKey]` to `[draftKey, confirmedSubmissionIds]`.
- `ui/src/components/IssueChatThread.tsx` — `IssueChatComposer` mirror of the same self-heal branch.

**Test files NOT vendored**: `TaskChatComposer.test.tsx` and `IssueChatThread.test.tsx` from `bc919d716` are intentionally excluded; the SC engineering SOPs §Phase 3 vendor rule keeps production-code changes minimal and the existing SC-side test artifacts cover AC-9..AC-12.

**Cross-fork upstream PR**: blocked at [SIN-2302](/SIN/issues/SIN-2302) — this hotfix is the SC-fork path; the upstream `paperclipai/paperclip:master` PR will be re-opened once Phase 5 release completes.

**Deployment**: Phase 5 release on [SIN-2341](/SIN/issues/SIN-2341) (Jordan Chen, Phase 5 owner); builds to `2026.916.1-sc1` and redeploys to `192.168.5.51:3100`.

**Rollback**: per [SIN-2338 plan revision `15b23b2e` §5](doc), `pkill -SIGTERM` prior npx cache → start `v2026.916.1` → verify `/api/health` → `git revert` the hotfix commit. Bounded at <91 s, 3× safety margin on the <5 min budget.
