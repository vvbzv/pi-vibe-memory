---
## 2026-05-19 — Session 4 — pi coding agent — 🟡 Caveat

- **Accomplished:** Applied active-safe passive meditation/instinct defaults to the user's live Pi settings and updated repo defaults, tests, README, design docs, and relay docs to match.
- **Verified:** User settings JSON valid and normalized as owner mode with nested passive meditation (`minObservations: 4`, `minIntervalMinutes: 10`, `maxCandidates: 3`) and review-gated instincts (`minEvidence: 2`, `maxPromptItems: 2`). Full repo verification is still pending for this uncommitted change.
- **Not verified:** `npm run check`, `npm test`, `npm pack --dry-run --json`, final commit, and push are still pending.
- **Root cause note:** Prior defaults (12 observations / 20 minutes / 5 candidates / 3 instinct evidence) were too conservative for same-session reflection to appear often in normal use.
- **Safety behavior now documented:** Top-level owner mode stays enabled; only nested meditation mode is passive. Reflected instincts remain working/review-gated and require explicit durable approval.
- **Mode:** routed
- **Next model hint:** final verification / commit-push

---
## 2026-05-19 — Session 3 — pi coding agent — 🟢 Clean

- **Accomplished:** Audited the user's live Pi settings for `pi-vibe-memory` + `pi-lean-ctx`, set `captureToolOutput: "off"`, increased Hindsight timeout to `30000`, confirmed the RTK optimizer extension folder was removed, updated README and relay docs.
- **Verified:** Settings JSON valid; normalized `pi-vibe-memory` settings derive Hindsight REST from MCP as `http://192.168.1.112:8888` bank `pi-agent`; direct Hindsight retain succeeded with 30s timeout after ~25.8s; `/vibe-memory-doctor` ok; `/vibe-memory-sync` drained backlog; `/vibe-memory-stats` ended with `sync: 0 pending, 0 failed`, `compaction: owner owner-active`, `health: 0 conflicts`; `npm run check` clean; `npm test` 137/137 passing; `npm pack --dry-run --json` clean with 25 files.
- **Root cause note:** The earlier sync failures were not memory loss; local SQLite was safe. Hindsight retain calls were slower than the default `1500ms` timeout, so queued jobs remained until timeout was raised and sync retried.
- **Safety behavior now documented:** Recommended config includes `npm:pi-lean-ctx` in additive/default mode, `captureToolOutput: "off"` to avoid tool-error memory pollution, and `hindsight.timeoutMs: 30000` for slow self-hosted/LAN Hindsight servers.
- **Mode:** routed
- **Next model hint:** release hygiene / final verification

---
## 2026-05-18 — Session 2 — pi coding agent — 🟢 Clean

- **Accomplished:** Diagnosed the repeated over-window compaction loop risk, hardened owner compaction to fail open on malformed/noisy context, fixed observation lifecycle sync payloads, updated README and relay docs.
- **Verified:** `npm run check` clean; `npm test` 137/137 passing after the compaction/lifecycle fix commit. Documentation-only update pending final verification in the current pass.
- **Root cause note:** A custom memory-only compaction summary containing only low-value rows like `Assistant summary: tool=ctx_find ... status=error` can prevent Pi's default compaction from recovering enough real conversation context, causing repeated `input exceeds context window` failures.
- **Safety behavior now documented:** Custom compaction requires `firstKeptEntryId`, filters tool-error telemetry, and returns `undefined` when no useful continuity remains so Pi falls back to default compaction.
- **Mode:** routed
- **Next model hint:** release hygiene / docs review

---
## 2026-05-18 — Session 1 — pi coding agent — 🟢 Clean

- **Accomplished:** Built, audited, dogfooded, pushed, and documented `pi-vibe-memory` v1 replacement branch; added readable stats tool/command and relay handoff docs.
- **Verified:** `npm test` 130/130 passing; `npm run check` clean; `npm pack --dry-run --json` clean; isolated Pi dogfood verified `vibe_memory_stats`.
- **Not verified:** Live Hindsight retain/recall against the user's server after the stats commit; npm publish; PR creation.
- **Handoff quality delta:** First structured relay for the repo; captures exact branch/SHA, risks, next tasks, and non-retry list.
- **Debt retired:** Root `/relay` scratch artifacts are now ignored; canonical relay docs are under `docs/relay/`.
- **New debt:** Relay docs must be reviewed before future pushes if they include private operational details.
- **Mode:** routed
- **Next model hint:** any model suitable for release hygiene and live smoke testing
