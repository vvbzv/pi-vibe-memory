# SCRATCHPAD — 2026-05-19

- Current uncommitted change: active-safe meditation defaults in repo + docs/tests. Final verification/commit/push still needed.
- User-global `/Users/vvbz/.pi/agent/settings.json` was updated externally; do not commit it. Top-level `vibeMemory.mode` remains `"owner"`.
- Live user config now uses nested `meditation.mode: "passive"`, `minObservations: 4`, `minIntervalMinutes: 10`, `maxCandidates: 3`, `sameSession: true`, and `instincts.minEvidence: 2` with durable approval required.
- Keep `pi-lean-ctx` additive/default, `captureToolOutput: "off"`, Hindsight MCP bootstrap, and `hindsight.timeoutMs: 30000` in recommended user config.
- User removed `/Users/vvbz/.pi/agent/extensions/pi-rtk-optimizer`; do not reintroduce RTK unless explicitly asked.
- Hindsight direct retain took ~25.8s; 8s was not enough, 30s succeeded. `/vibe-memory-sync` later reached 0 pending / 0 failed.
- Next useful action after this push: release hygiene, especially semver (`0.1.0` vs `1.0.0`) and optional isolated Hindsight smoke.
