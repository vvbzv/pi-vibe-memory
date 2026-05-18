# MEMORY — pi-vibe-memory

## Project identity — updated 2026-05-18

`pi-vibe-memory` is a Pi Agents extension/package intended to replace `npm:pi-observational-memory` and `npm:pi-continuous-learning` as a single memory owner. It must remain separate from OMP and must not import `@oh-my-pi/*`.

## Core architecture — updated 2026-05-18

The package is local-first with SQLite persistence, deterministic capture, bounded untrusted prompt injection, direct Hindsight REST integration, optional Hindsight MCP credential bootstrap, owner-mode mechanical compaction, typed memory kinds, non-deleting comparative revision, review workflow, continuous-learning importer, doctor diagnostics, and stats reporting.

## Safety conventions — updated 2026-05-19

Automatic memory operations are deterministic and must not call hidden internal LLM agents. Compaction must not call Hindsight or an LLM. Custom compaction is fail-open: require a valid `firstKeptEntryId`, filter low-value `Assistant summary: tool=... status=error` telemetry, and return `undefined` when only noisy telemetry exists so Pi can use its default compaction. Old knowledge is superseded/inhibited with provenance rather than deleted. Prompt rendering and tool output must be token-light and scrub secrets.

For the clean `pi-vibe-memory` + `pi-lean-ctx` setup, leave `pi-lean-ctx` in additive/default mode and prefer `captureToolOutput: "off"` so tool-error summaries do not pollute prompt memory. Slow self-hosted Hindsight retain paths may need `vibeMemory.hindsight.timeoutMs: 30000`; local SQLite remains the source of truth if Hindsight is offline or slow.

## Branch state — updated 2026-05-19

Primary implementation branch is `pi-vibe-memory-v1` at GitHub repo `https://github.com/vvbzv/pi-vibe-memory.git`. The user chose to keep this branch/worktree unmerged because the parent repo also contains OMP worktrees.
