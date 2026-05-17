# RELAY-NEXT — Session 2 targets

## Priority 1 — Release hygiene

### [P1] Decide package version and release target [reasoning-heavy]

- **Why it matters:** The branch is a v1 milestone, but `package.json` still says `0.1.0`; publishing without deciding this will confuse users.
- **Success criteria:** Either keep `0.1.0` intentionally with a README note, or bump to `1.0.0`; run `npm test`, `npm run check`, and `npm pack --dry-run --json`; commit and push if changed.
- **Depends on:** User approval for semver choice.
- **Hint:** If publishing as the first public stable replacement for two memory extensions, `1.0.0` is clearer.

### [P1] Live Hindsight smoke test [execution-heavy]

- **Why it matters:** Local-first dogfood passed, but final stats pass did not re-test the live Hindsight server.
- **Success criteria:** In an isolated `PI_CODING_AGENT_DIR`, configure `hindsight.source: "mcp"` or REST to the user's Hindsight server, run `vibe_memory_doctor`, store a test memory, sync it, and recall it through Hindsight without leaking credentials.
- **Depends on:** Hindsight server reachable and MCP OAuth callback port free.
- **Hint:** If `pi-mcp-adapter` OAuth callback fails, set `MCP_OAUTH_CALLBACK_PORT` to a free port.

## Priority 2 — Integration workflow

### [P2] Choose branch workflow [reasoning-heavy]

- **Why it matters:** User chose not to merge locally because this parent repo also has OMP worktrees.
- **Success criteria:** Decide one: keep branch install-only, create GitHub PR, or make a clean standalone clone for release work. Do not merge into the mixed parent without explicit confirmation.
- **Depends on:** User preference.

### [P2] Prepare install instructions from GitHub branch [creative-heavy]

- **Why it matters:** Users need a safe path before npm publish.
- **Success criteria:** README or release note includes a branch install command and warns not to run legacy memory owners beside `pi-vibe-memory` owner mode.
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
| Live Hindsight production smoke | Dogfood session | ⏭️ Open | Local-first verified; live server not rerun after final changes. |
| Branch not merged | Finalization session | ⏭️ Intentional | User chose keep-as-is to avoid mixed OMP workspace confusion. |
