# RELAY-NEXT — Session 4 targets

## Priority 0 — Finish current change

### [P0] Verify active-safe defaults [execution-heavy]

- **Why it matters:** The current uncommitted changes alter package defaults and docs; they must be type-checked and tested before commit.
- **Success criteria:** `npm run check`, `npm test`, and `npm pack --dry-run --json` all pass. Record exact pass counts and package file count in `docs/relay/RELAY.md` or final response.
- **Depends on:** Current uncommitted code/docs.
- **Hint:** Expect tests to cover `src/config.ts`, `tests/config.test.ts`, and `tests/meditation.test.ts` default threshold changes.

### [P0] Commit and push active-safe defaults [execution-heavy]

- **Why it matters:** User asked to make these defaults/docs/tests official and push to GitHub.
- **Success criteria:** `git status --short` is clean after commit, `git log -1 --oneline` shows a commit like `Tune passive meditation defaults`, and `git push origin pi-vibe-memory-v1` succeeds.
- **Depends on:** Verification passing.
- **Hint:** Do not include `/Users/vvbz/.pi/agent/settings.json` or MCP credentials; only commit repo files.

## Priority 1 — Release hygiene

### [P1] Decide package version and release target [reasoning-heavy]

- **Why it matters:** The branch is a v1 milestone, but `package.json` still says `0.1.0`; publishing without deciding this will confuse users.
- **Success criteria:** Either keep `0.1.0` intentionally with a README note, or bump to `1.0.0`; run `npm test`, `npm run check`, and `npm pack --dry-run --json`; commit and push if changed.
- **Depends on:** User approval for semver choice.
- **Hint:** If publishing as the first public stable replacement for two memory extensions, `1.0.0` is clearer.

### [P1] Live Hindsight smoke in isolated Pi agent dir [execution-heavy]

- **Why it matters:** The user's live runtime was fixed and synced, but a clean isolated `PI_CODING_AGENT_DIR` smoke is still useful before release docs claim production readiness.
- **Success criteria:** In an isolated `PI_CODING_AGENT_DIR`, configure `hindsight.source: "mcp"` or REST to the user's Hindsight server, run `vibe_memory_doctor`, store a test memory, sync it, and recall it through Hindsight without leaking credentials.
- **Depends on:** Hindsight server reachable and MCP/OAuth config available.
- **Hint:** For slow self-hosted Hindsight retain paths, include `vibeMemory.hindsight.timeoutMs: 30000`.

## Priority 2 — Integration workflow

### [P2] Choose branch workflow [reasoning-heavy]

- **Why it matters:** User chose not to merge locally because this parent repo also has OMP worktrees.
- **Success criteria:** Decide one: keep branch install-only, create GitHub PR, or make a clean standalone clone for release work. Do not merge into the mixed parent without explicit confirmation.
- **Depends on:** User preference.

### [P2] Dogfood candidate quality [review-heavy]

- **Why it matters:** Meditation now triggers sooner. Candidate quality should be watched so working instincts remain useful rather than noisy.
- **Success criteria:** After a normal long session, run `/vibe-memory-review` or `vibe_memory_review` and inspect candidate counts/content; document whether thresholds need adjustment.
- **Depends on:** Active-safe defaults installed and used in a fresh Pi runtime.

## Priority 3 — Review / audit

### [P3] Audit package runtime against current Pi extension API [review-heavy]

- **Why it matters:** Pi APIs can drift; this package uses lifecycle hooks, tools, commands, and settings parsing.
- **Success criteria:** Read installed Pi docs/types, verify hook names and ToolDefinition shapes, run tests, and note any API compatibility issues.
- **Depends on:** None.

## Carry-forward ledger

| Item | First appeared | Status | Why still open |
|:-----|:---------------|:-------|:---------------|
| Commit active-safe meditation defaults | Session 4 | ⏳ Pending | Needs final verification first. |
| Semver mismatch (`0.1.0` vs v1 milestone) | Implementation session | ⏭️ Open | Needs user release decision. |
| Isolated Hindsight production smoke | Dogfood session | ⏭️ Open | User runtime sync passed; isolated release smoke remains useful. |
| Branch not merged | Finalization session | ⏭️ Intentional | User chose keep-as-is to avoid mixed OMP workspace confusion. |
| Slow Hindsight retain path | Session 3 | ⚠️ Known | User runtime needed `timeoutMs: 30000`; package default remains lower unless changed later. |
