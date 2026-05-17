# MEMORY — pi-vibe-memory

## Project identity — updated 2026-05-18

`pi-vibe-memory` is a Pi Agents extension/package intended to replace `npm:pi-observational-memory` and `npm:pi-continuous-learning` as a single memory owner. It must remain separate from OMP and must not import `@oh-my-pi/*`.

## Core architecture — updated 2026-05-18

The package is local-first with SQLite persistence, deterministic capture, bounded untrusted prompt injection, direct Hindsight REST integration, optional Hindsight MCP credential bootstrap, owner-mode mechanical compaction, typed memory kinds, non-deleting comparative revision, review workflow, continuous-learning importer, doctor diagnostics, and stats reporting.

## Safety conventions — updated 2026-05-18

Automatic memory operations are deterministic and must not call hidden internal LLM agents. Compaction must not call Hindsight or an LLM. Old knowledge is superseded/inhibited with provenance rather than deleted. Prompt rendering and tool output must be token-light and scrub secrets.

## Branch state — updated 2026-05-18

Primary implementation branch is `pi-vibe-memory-v1` at GitHub repo `https://github.com/vvbzv/pi-vibe-memory.git`. The user chose to keep this branch/worktree unmerged because the parent repo also contains OMP worktrees.
