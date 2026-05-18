# SCRATCHPAD — 2026-05-19

- User chose to keep `pi-vibe-memory-v1` branch/worktree as-is; do not merge into parent mixed OMP workspace.
- Live user config now uses `pi-vibe-memory` owner mode, `pi-lean-ctx` installed/additive by default, `captureToolOutput: "off"`, Hindsight MCP bootstrap, and `hindsight.timeoutMs: 30000`.
- User removed `/Users/vvbz/.pi/agent/extensions/pi-rtk-optimizer`; do not reintroduce RTK unless explicitly asked.
- Hindsight direct retain took ~25.8s; 8s was not enough, 30s succeeded. `/vibe-memory-sync` later reached 0 pending / 0 failed.
- Next useful action after this docs push: release hygiene, especially semver (`0.1.0` vs `1.0.0`) and optional isolated Hindsight smoke.
