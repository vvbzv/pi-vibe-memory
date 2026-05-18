# RELAY-NEXT — Session 3 targets

## Priority 0 — Post-push confirmation

### [P0] Confirm docs-only push landed [execution-heavy]

- **Why it matters:** This pass should push README/relay docs to `origin/pi-vibe-memory-v1`.
- **Success criteria:** `git status --short` is clean and `git log -1 --oneline` shows the docs commit on both local and remote branch.
- **Depends on:** Current docs commit/push.
- **Hint:** Pre-push verification already ran `npm run check`, `npm test`, and `npm pack --dry-run --json` successfully.

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

### [P2] Prepare release/install notes [creative-heavy]

- **Why it matters:** Users need a safe path before npm publish.
- **Success criteria:** README or release note includes a branch install command, recommends `pi-lean-ctx` additive mode when used together, warns not to run legacy memory owners beside `pi-vibe-memory` owner mode, and explains when to use `captureToolOutput: "off"` and longer Hindsight `timeoutMs`.
- **Depends on:** Version/release decision.

## Priority 3 — Review / audit

### [P3] Audit package runtime against current Pi extension API [review-heavy]

- **Why it matters:** Pi APIs can drift; this package uses lifecycle hooks, tools, commands, and settings parsing.
- **Success criteria:** Read installed Pi docs/types, verify hook names and ToolDefinition shapes, run tests, and note any API compatibility issues.
- **Depends on:** None.

## Carry-forward ledger

| Item | First appeared | Status | Why still open |
|:-----|:---------------|:-------|:---------------|
| Semver mismatch (`0.1.0` vs v1 milestone) | Implementation session | ⏭️ Open | Needs user release decision. |
| Isolated Hindsight production smoke | Dogfood session | ⏭️ Open | User runtime sync passed; isolated release smoke remains useful. |
| Branch not merged | Finalization session | ⏭️ Intentional | User chose keep-as-is to avoid mixed OMP workspace confusion. |
| Slow Hindsight retain path | Session 3 | ⚠️ Known | User runtime needed `timeoutMs: 30000`; default remains lower unless changed later. |
