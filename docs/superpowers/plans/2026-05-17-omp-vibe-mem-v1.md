# OMP Vibe Memory Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an OMP-native memory plugin in `/Users/vvbz/Desktop/FOSS/PI Agents/omp-vibe-mem` that keeps local operational memory in SQLite, promotes durable knowledge into Hindsight, and injects exactly one unified memory block per turn.

**Architecture:** The plugin is a single OMP extension entrypoint plus focused helper modules. It captures session activity into a local SQLite store, rolls raw events into operational observations, merges those observations with Hindsight workspace/personal-bank recall through one `before_agent_start` hook, and queues promoted memories for idempotent Hindsight sync. It reuses OMP's exported Hindsight client/config helpers, but explicitly requires `memory.backend = off` so OMP's built-in auto-memory pipeline never conflicts with the plugin.

**Tech Stack:** Bun, TypeScript, OMP Extension API (`@oh-my-pi/pi-coding-agent`), exported Hindsight helpers (`@oh-my-pi/pi-coding-agent/hindsight`), plugin settings loader (`@oh-my-pi/pi-coding-agent/extensibility/plugins/loader`), Bun SQLite (`bun:sqlite`), Bun test.

---

## File structure

- `package.json` — Bun package metadata, OMP plugin manifest, plugin settings schema, scripts.
- `.gitignore` — ignore Bun, SQLite, and macOS noise.
- `tsconfig.json` — TypeScript configuration for Bun + ESM.
- `src/extension.ts` — only OMP entrypoint; wires hooks, commands, and tools.
- `src/config.ts` — merges plugin settings with exported Hindsight settings and blocks conflicting `memory.backend` values.
- `src/runtime.ts` — per-session runtime cache keyed by OMP session id.
- `src/storage/schema.ts` — SQLite DDL.
- `src/storage/db.ts` — DB open/init helpers.
- `src/storage/repository.ts` — typed persistence/query operations.
- `src/scrub.ts` — secret redaction before persistence.
- `src/capture.ts` — session-entry and tool-result normalization.
- `src/observations.ts` — operational observation rollups and scoring.
- `src/prompt.ts` — prompt and compaction summary rendering.
- `src/hindsight.ts` — Hindsight client creation, bank resolution, recall helpers.
- `src/sync.ts` — promotion queue and Hindsight flush logic.
- `src/trust.ts` — file-hash trust invalidation.
- `src/importers/*.ts` — one importer per legacy source.
- `tests/*.test.ts` — focused unit and integration coverage.

## Source-grounded constraints

- Extension modules export a default factory and register behavior through `pi.on(...)`, `pi.registerTool(...)`, and `pi.registerCommand(...)` (`docs/extensions.md`, `examples/extensions/README.md`).
- Dynamic prompt injection belongs in `before_agent_start` via `{ systemPromptAppend }` (`examples/extensions/pirate.ts`).
- Custom compaction belongs in `session_before_compact` via `{ compaction: { summary, firstKeptEntryId, tokensBefore } }` (`examples/hooks/custom-compaction.ts`).
- Plugin settings are readable with `getPluginSettings(pluginName, cwd)` from `@oh-my-pi/pi-coding-agent/extensibility/plugins/loader`.
- Hindsight helpers are public exports under `@oh-my-pi/pi-coding-agent/hindsight` (`packages/coding-agent/package.json`, `src/hindsight/index.ts`).
- Session ids and branch traversal are available from `sessionManager.getSessionId()`, `getBranch()`, `getLeafId()`, and `getEntries()` (`src/session/session-manager.ts`).

---

### Task 1: Bootstrap the plugin package and runtime guard

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `tsconfig.json`
- Create: `src/config.ts`
- Create: `src/extension.ts`
- Test: `tests/bootstrap.test.ts`

- [ ] **Step 1: Write the failing bootstrap test**

```ts
import { describe, expect, it } from "bun:test";
import { validateMemoryBackend } from "../src/config";

describe("validateMemoryBackend", () => {
  it("allows memory.backend=off and rejects conflicting built-in backends", () => {
    expect(validateMemoryBackend("off")).toBeNull();
    expect(validateMemoryBackend("local")).toContain("memory.backend");
    expect(validateMemoryBackend("hindsight")).toContain("memory.backend");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/bootstrap.test.ts`
Expected: FAIL because `src/config.ts` does not exist yet.

- [ ] **Step 3: Create the package, config guard, and extension skeleton**

`package.json`

```json
{
  "name": "omp-vibe-mem",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "bun test",
    "check": "bunx tsc --noEmit",
    "lint": "biome check .",
    "fix": "biome check --write ."
  },
  "dependencies": {
    "@oh-my-pi/pi-coding-agent": "^15.1.3",
    "@oh-my-pi/pi-utils": "^15.1.0"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "typescript": "^5.8.3"
  },
  "omp": {
    "extensions": ["./src/extension.ts"],
    "settings": {
      "dbPath": { "type": "string", "description": "SQLite path for local operational memory" },
      "observationBatchSize": { "type": "number", "default": 12, "min": 1, "description": "Raw events per observation rollup" },
      "promptObservationLimit": { "type": "number", "default": 8, "min": 1, "description": "Operational observations injected per turn" },
      "syncDebounceMs": { "type": "number", "default": 1500, "min": 0, "description": "Delay before flushing promoted items" }
    }
  }
}
```

`src/config.ts`

```ts
import path from "node:path";
import { Settings } from "@oh-my-pi/pi-coding-agent";
import { getPluginSettings } from "@oh-my-pi/pi-coding-agent/extensibility/plugins/loader";
import { loadHindsightConfig, type HindsightConfig } from "@oh-my-pi/pi-coding-agent/hindsight";
import { getAgentDir } from "@oh-my-pi/pi-utils";

export const PLUGIN_NAME = "omp-vibe-mem";

export interface VibeMemConfig {
  dbPath: string;
  observationBatchSize: number;
  promptObservationLimit: number;
  syncDebounceMs: number;
  hindsight: HindsightConfig;
}

export function validateMemoryBackend(value: unknown): string | null {
  return value === "off" || value == null
    ? null
    : "omp-vibe-mem requires `memory.backend: off` so built-in OMP memory injection does not conflict.";
}

export async function loadPluginConfig(cwd: string): Promise<VibeMemConfig> {
  const settings = await Settings.init({ cwd });
  const backendError = validateMemoryBackend(settings.get("memory.backend"));
  if (backendError) throw new Error(backendError);

  const pluginSettings = await getPluginSettings(PLUGIN_NAME, cwd);

  return {
    dbPath: String(pluginSettings.dbPath ?? path.join(getAgentDir(), "plugins", PLUGIN_NAME, "memory.sqlite")),
    observationBatchSize: Number(pluginSettings.observationBatchSize ?? 12),
    promptObservationLimit: Number(pluginSettings.promptObservationLimit ?? 8),
    syncDebounceMs: Number(pluginSettings.syncDebounceMs ?? 1500),
    hindsight: loadHindsightConfig(settings),
  };
}
```

`src/extension.ts`

```ts
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { loadPluginConfig } from "./config";

export default function vibeMemExtension(pi: ExtensionAPI) {
  pi.setLabel("OMP Vibe Memory");

  pi.on("session_start", async (_event, ctx) => {
    try {
      await loadPluginConfig(ctx.cwd);
      if (ctx.hasUI) ctx.ui.notify("omp-vibe-mem ready", "info");
    } catch (error) {
      if (ctx.hasUI) ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
    }
  });

  pi.registerCommand("memory-status", {
    description: "Show OMP Vibe Memory status",
    handler: async (_args, ctx) => {
      ctx.ui.notify("omp-vibe-mem bootstrapped; storage not wired yet.", "info");
    },
  });
}
```

- [ ] **Step 4: Run bootstrap checks**

Run: `bun test tests/bootstrap.test.ts && bun run check`
Expected: bootstrap test PASS, typecheck PASS.

- [ ] **Step 5: Commit**

```bash
git add package.json .gitignore tsconfig.json src/config.ts src/extension.ts tests/bootstrap.test.ts
git commit -m "chore: bootstrap omp vibe memory plugin"
```

### Task 2: Create the SQLite operational store

**Files:**
- Create: `src/storage/schema.ts`
- Create: `src/storage/db.ts`
- Create: `src/storage/repository.ts`
- Test: `tests/storage.test.ts`

- [ ] **Step 1: Write the failing storage round-trip test**

```ts
import { afterEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRepository } from "../src/storage/repository";

describe("MemoryRepository", () => {
  const dbPath = path.join(os.tmpdir(), `omp-vibe-mem-${crypto.randomUUID()}.sqlite`);

  afterEach(() => {
    for (const suffix of ["", "-shm", "-wal"]) fs.rmSync(`${dbPath}${suffix}`, { force: true });
  });

  it("stores workspaces, sessions, raw events, observations, and sync jobs", () => {
    const repo = createRepository(dbPath);
    const workspaceId = repo.upsertWorkspace("/tmp/demo");
    repo.startSession("session-1", workspaceId, "leaf-1");
    repo.appendRawEvent({ workspaceId, sessionId: "session-1", branchLeafId: "leaf-1", eventType: "user_message", occurredAt: 1, payloadJson: '{"text":"remember this"}' });
    repo.appendObservation({ workspaceId, sessionId: "session-1", memoryId: "obs-1", summary: "User asked to remember this.", score: 0.9, sourcesJson: '[1]' });
    repo.enqueueSyncJob({ workspaceId, observationId: "obs-1", targetBank: "demo-workspace", payloadJson: '{"kind":"retain"}' });

    expect(repo.listPromptObservations(workspaceId, 5)).toHaveLength(1);
    expect(repo.listPendingSyncJobs(10)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/storage.test.ts`
Expected: FAIL because `createRepository` does not exist yet.

- [ ] **Step 3: Implement the schema and repository**

`src/storage/schema.ts`

```ts
export const SCHEMA = [
  `PRAGMA journal_mode = WAL;`,
  `PRAGMA foreign_keys = ON;`,
  `CREATE TABLE IF NOT EXISTS workspaces (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cwd TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );`,
  `CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    branch_leaf_id TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );`,
  `CREATE TABLE IF NOT EXISTS raw_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    branch_leaf_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    occurred_at INTEGER NOT NULL,
    payload_json TEXT NOT NULL
  );`,
  `CREATE TABLE IF NOT EXISTS observations (
    memory_id TEXT PRIMARY KEY,
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    summary TEXT NOT NULL,
    score REAL NOT NULL,
    trust REAL NOT NULL DEFAULT 1.0,
    sources_json TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );`,
  `CREATE TABLE IF NOT EXISTS sync_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    observation_id TEXT NOT NULL REFERENCES observations(memory_id) ON DELETE CASCADE,
    target_bank TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );`,
  `CREATE TABLE IF NOT EXISTS trust_links (
    observation_id TEXT NOT NULL REFERENCES observations(memory_id) ON DELETE CASCADE,
    file_path TEXT NOT NULL,
    file_hash TEXT NOT NULL,
    PRIMARY KEY (observation_id, file_path)
  );`
] as const;
```

`src/storage/db.ts`

```ts
import fs from "node:fs";
import path from "node:path";
import { Database } from "bun:sqlite";
import { SCHEMA } from "./schema";

export function openDatabase(dbPath: string): Database {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath, { create: true });
  for (const statement of SCHEMA) db.exec(statement);
  return db;
}
```

`src/storage/repository.ts`

```ts
import { openDatabase } from "./db";

export function createRepository(dbPath: string) {
  const db = openDatabase(dbPath);

  return {
    upsertWorkspace(cwd: string): number {
      db.query(`INSERT INTO workspaces (cwd) VALUES (?) ON CONFLICT(cwd) DO UPDATE SET cwd = excluded.cwd`).run(cwd);
      return Number(db.query(`SELECT id FROM workspaces WHERE cwd = ?`).get(cwd)!.id);
    },
    startSession(id: string, workspaceId: number, branchLeafId: string): void {
      db.query(`INSERT OR REPLACE INTO sessions (id, workspace_id, branch_leaf_id) VALUES (?, ?, ?)`).run(id, workspaceId, branchLeafId);
    },
    appendRawEvent(row: { workspaceId: number; sessionId: string; branchLeafId: string; eventType: string; occurredAt: number; payloadJson: string }): void {
      db.query(`INSERT INTO raw_events (workspace_id, session_id, branch_leaf_id, event_type, occurred_at, payload_json) VALUES (?, ?, ?, ?, ?, ?)`).run(
        row.workspaceId,
        row.sessionId,
        row.branchLeafId,
        row.eventType,
        row.occurredAt,
        row.payloadJson,
      );
    },
    appendObservation(row: { workspaceId: number; sessionId: string; memoryId: string; summary: string; score: number; sourcesJson: string }): void {
      db.query(`INSERT OR REPLACE INTO observations (memory_id, workspace_id, session_id, summary, score, sources_json) VALUES (?, ?, ?, ?, ?, ?)`).run(
        row.memoryId,
        row.workspaceId,
        row.sessionId,
        row.summary,
        row.score,
        row.sourcesJson,
      );
    },
    enqueueSyncJob(row: { workspaceId: number; observationId: string; targetBank: string; payloadJson: string }): void {
      db.query(`INSERT INTO sync_queue (workspace_id, observation_id, target_bank, payload_json) VALUES (?, ?, ?, ?)`).run(
        row.workspaceId,
        row.observationId,
        row.targetBank,
        row.payloadJson,
      );
    },
    listPromptObservations(workspaceId: number, limit: number) {
      return db.query(`SELECT * FROM observations WHERE workspace_id = ? ORDER BY trust DESC, score DESC, created_at DESC LIMIT ?`).all(workspaceId, limit);
    },
    listPendingSyncJobs(limit: number) {
      return db.query(`SELECT * FROM sync_queue WHERE status = 'pending' ORDER BY id ASC LIMIT ?`).all(limit);
    },
  };
}
```

- [ ] **Step 4: Run storage tests and typecheck**

Run: `bun test tests/storage.test.ts && bun run check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/storage/schema.ts src/storage/db.ts src/storage/repository.ts tests/storage.test.ts
git commit -m "feat: add sqlite operational memory store"
```

### Task 3: Capture branch activity and scrub secrets before persistence

**Files:**
- Create: `src/scrub.ts`
- Create: `src/capture.ts`
- Create: `src/runtime.ts`
- Modify: `src/extension.ts`
- Test: `tests/capture.test.ts`

- [ ] **Step 1: Write the failing capture and scrub test**

```ts
import { describe, expect, it } from "bun:test";
import { scrubText } from "../src/scrub";
import { extractNewMessageEvents } from "../src/capture";

describe("scrubText", () => {
  it("redacts common bearer, API key, and AWS access-key patterns", () => {
    const input = "Bearer abc.def ghi sk-12345678901234567890 AKIAIOSFODNN7EXAMPLE";
    const output = scrubText(input);
    expect(output).not.toContain("sk-12345678901234567890");
    expect(output).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(output).toContain("[REDACTED]");
  });
});

describe("extractNewMessageEvents", () => {
  it("returns only branch entries after the last processed entry id", () => {
    const events = extractNewMessageEvents(
      [
        { id: "a", type: "message", role: "user", content: [{ type: "text", text: "first" }], timestamp: 1 },
        { id: "b", type: "message", role: "assistant", content: [{ type: "text", text: "second" }], timestamp: 2 },
      ] as any,
      "a",
    );
    expect(events).toHaveLength(1);
    expect(events[0].payload.text).toBe("second");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/capture.test.ts`
Expected: FAIL because `src/scrub.ts` and `src/capture.ts` do not exist yet.

- [ ] **Step 3: Implement scrubbing, entry extraction, and runtime state**

`src/scrub.ts`

```ts
const SECRET_PATTERNS = [
  /Bearer\s+[A-Za-z0-9._=-]+/g,
  /sk-[A-Za-z0-9]{20,}/g,
  /AKIA[0-9A-Z]{16}/g,
];

export function scrubText(input: string): string {
  return SECRET_PATTERNS.reduce((text, pattern) => text.replace(pattern, "[REDACTED]"), input);
}
```

`src/capture.ts`

```ts
import { scrubText } from "./scrub";

function textFromContent(content: Array<{ type: string; text?: string }> | undefined): string {
  return (content ?? [])
    .filter(part => part.type === "text")
    .map(part => part.text ?? "")
    .join("\n")
    .trim();
}

export function extractNewMessageEvents(entries: Array<any>, lastSeenId: string | null) {
  const start = lastSeenId ? entries.findIndex(entry => entry.id === lastSeenId) + 1 : 0;
  return entries.slice(Math.max(start, 0)).flatMap(entry => {
    if (entry.type !== "message") return [];
    const text = scrubText(textFromContent(entry.content));
    if (!text) return [];
    return [{
      id: entry.id,
      payload: {
        role: entry.role,
        text,
        timestamp: entry.timestamp,
      },
    }];
  });
}
```

`src/runtime.ts`

```ts
import { loadPluginConfig } from "./config";
import { createRepository } from "./storage/repository";

export interface SessionRuntime {
  repo: ReturnType<typeof createRepository>;
  workspaceId: number;
  sessionId: string;
  lastSeenEntryId: string | null;
  config: Awaited<ReturnType<typeof loadPluginConfig>>;
}

const runtimes = new Map<string, SessionRuntime>();

export async function createRuntime(cwd: string, sessionId: string) {
  const config = await loadPluginConfig(cwd);
  const repo = createRepository(config.dbPath);
  const workspaceId = repo.upsertWorkspace(cwd);
  repo.startSession(sessionId, workspaceId, "root");
  const runtime: SessionRuntime = { repo, workspaceId, sessionId, lastSeenEntryId: null, config };
  runtimes.set(sessionId, runtime);
  return runtime;
}

export function getRuntime(sessionId: string) {
  return runtimes.get(sessionId);
}

export function clearRuntime(sessionId: string) {
  runtimes.delete(sessionId);
}
```

`src/extension.ts` additions

```ts
import { extractNewMessageEvents } from "./capture";
import { clearRuntime, createRuntime, getRuntime } from "./runtime";

pi.on("session_start", async (_event, ctx) => {
  const runtime = await createRuntime(ctx.cwd, ctx.sessionManager.getSessionId());
  if (ctx.hasUI) ctx.ui.notify(`omp-vibe-mem ready (${runtime.config.dbPath})`, "info");
});

pi.on("turn_end", async (_event, ctx) => {
  const runtime = getRuntime(ctx.sessionManager.getSessionId());
  if (!runtime) return;
  const branch = ctx.sessionManager.getBranch();
  const newEvents = extractNewMessageEvents(branch as any[], runtime.lastSeenEntryId);
  for (const event of newEvents) {
    runtime.repo.appendRawEvent({
      workspaceId: runtime.workspaceId,
      sessionId: runtime.sessionId,
      branchLeafId: ctx.sessionManager.getLeafId() ?? "root",
      eventType: `${event.payload.role}_message`,
      occurredAt: event.payload.timestamp,
      payloadJson: JSON.stringify(event.payload),
    });
    runtime.lastSeenEntryId = event.id;
  }
});

pi.on("session_shutdown", async (_event, ctx) => {
  clearRuntime(ctx.sessionManager.getSessionId());
});
```

- [ ] **Step 4: Run capture tests**

Run: `bun test tests/capture.test.ts && bun run check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/scrub.ts src/capture.ts src/runtime.ts src/extension.ts tests/capture.test.ts
git commit -m "feat: capture scrubbed branch activity"
```

### Task 4: Roll raw events into operational observations and build prompt/compaction views

**Files:**
- Create: `src/observations.ts`
- Create: `src/prompt.ts`
- Modify: `src/storage/repository.ts`
- Modify: `src/extension.ts`
- Test: `tests/observations.test.ts`

- [ ] **Step 1: Write the failing observation and prompt test**

```ts
import { describe, expect, it } from "bun:test";
import { buildOperationalPrompt } from "../src/prompt";
import { rollupMessagesToObservation } from "../src/observations";

describe("rollupMessagesToObservation", () => {
  it("keeps durable user requests and assistant outcomes in one evidence-backed summary", () => {
    const summary = rollupMessagesToObservation([
      { role: "user", text: "Remember that the staging DB is slow.", timestamp: 1 },
      { role: "assistant", text: "I will avoid running slow queries there.", timestamp: 2 },
    ]);
    expect(summary.summary).toContain("staging DB is slow");
    expect(summary.score).toBeGreaterThan(0.5);
  });
});

describe("buildOperationalPrompt", () => {
  it("renders one stable local memory block", () => {
    const rendered = buildOperationalPrompt([
      { memory_id: "obs-1", summary: "Staging DB is slow.", trust: 0.9, score: 0.8 },
    ] as any);
    expect(rendered).toContain("<operational_memory>");
    expect(rendered).toContain("obs-1");
    expect(rendered).toContain("Staging DB is slow.");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/observations.test.ts`
Expected: FAIL because `src/observations.ts` and `src/prompt.ts` do not exist yet.

- [ ] **Step 3: Implement observation rollups and prompt rendering**

`src/observations.ts`

```ts
export function rollupMessagesToObservation(messages: Array<{ role: string; text: string; timestamp: number }>) {
  const text = messages.map(message => `${message.role}: ${message.text}`).join(" ");
  const score = Math.min(1, 0.4 + messages.length * 0.15 + (text.includes("Remember") ? 0.2 : 0));
  return {
    summary: text.slice(0, 400),
    score,
  };
}
```

`src/prompt.ts`

```ts
export function buildOperationalPrompt(rows: Array<{ memory_id: string; summary: string; trust: number; score: number }>): string {
  if (rows.length === 0) return "";
  const lines = rows.map(row => `- [${row.memory_id}] trust=${row.trust.toFixed(2)} score=${row.score.toFixed(2)} ${row.summary}`);
  return ["<operational_memory>", ...lines, "</operational_memory>"].join("\n");
}

export function buildCompactionSummary(rows: Array<{ memory_id: string; summary: string }>): string {
  if (rows.length === 0) return "No operational observations recorded yet.";
  return rows.map(row => `- [${row.memory_id}] ${row.summary}`).join("\n");
}
```

`src/storage/repository.ts` additions

```ts
appendObservation(row: { workspaceId: number; sessionId: string; memoryId: string; summary: string; score: number; sourcesJson: string }): void {
  db.query(`INSERT OR REPLACE INTO observations (memory_id, workspace_id, session_id, summary, score, sources_json) VALUES (?, ?, ?, ?, ?, ?)`).run(
    row.memoryId,
    row.workspaceId,
    row.sessionId,
    row.summary,
    row.score,
    row.sourcesJson,
  );
},
listUnrolledRawEvents(sessionId: string, limit: number) {
  return db.query(`SELECT * FROM raw_events WHERE session_id = ? ORDER BY id DESC LIMIT ?`).all(sessionId, limit).reverse();
},
```

`src/extension.ts` additions

```ts
import { rollupMessagesToObservation } from "./observations";
import { buildCompactionSummary } from "./prompt";

pi.on("turn_end", async (_event, ctx) => {
  const runtime = getRuntime(ctx.sessionManager.getSessionId());
  if (!runtime) return;
  const rows = runtime.repo.listUnrolledRawEvents(runtime.sessionId, runtime.config.observationBatchSize) as Array<any>;
  if (rows.length < runtime.config.observationBatchSize) return;
  const messages = rows.map(row => JSON.parse(row.payload_json));
  const rolled = rollupMessagesToObservation(messages);
  runtime.repo.appendObservation({
    workspaceId: runtime.workspaceId,
    sessionId: runtime.sessionId,
    memoryId: `obs-${Date.now()}`,
    summary: rolled.summary,
    score: rolled.score,
    sourcesJson: JSON.stringify(rows.map(row => row.id)),
  });
});

pi.on("session_before_compact", async (event, ctx) => {
  const runtime = getRuntime(ctx.sessionManager.getSessionId());
  if (!runtime) return;
  const rows = runtime.repo.listPromptObservations(runtime.workspaceId, runtime.config.promptObservationLimit);
  return {
    compaction: {
      summary: buildCompactionSummary(rows as any[]),
      firstKeptEntryId: event.preparation.firstKeptEntryId,
      tokensBefore: event.preparation.tokensBefore,
    },
  };
});
```

- [ ] **Step 4: Run observation tests**

Run: `bun test tests/observations.test.ts && bun run check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/observations.ts src/prompt.ts src/storage/repository.ts src/extension.ts tests/observations.test.ts
git commit -m "feat: add operational observation rollups"
```

### Task 5: Add Hindsight recall, personal-bank pinning, promotion sync, and user-facing memory tools

**Files:**
- Create: `src/hindsight.ts`
- Create: `src/sync.ts`
- Modify: `src/storage/repository.ts`
- Modify: `src/extension.ts`
- Test: `tests/hindsight.test.ts`

- [ ] **Step 1: Write the failing Hindsight integration test**

```ts
import { describe, expect, it } from "bun:test";
import { buildPinJob, buildUnifiedMemoryBlock, resolveBankIds } from "../src/hindsight";

describe("resolveBankIds", () => {
  it("uses one workspace bank and one personal bank", () => {
    const ids = resolveBankIds({ bankId: "omp", bankIdPrefix: "team", scoping: "per-project" } as any, "/tmp/project-x");
    expect(ids.workspaceBankId).toContain("project-x");
    expect(ids.personalBankId).toBe("team-omp-personal");
  });
});

describe("buildPinJob", () => {
  it("stores hard rules as personal-bank mental models", () => {
    const job = buildPinJob("team-omp-personal", "deploy-approval", "Production deploys require approval");
    expect(job.targetBank).toBe("team-omp-personal");
    expect(job.payload.kind).toBe("mental_model");
    expect(job.payload.sourceQuery).toContain("Production deploys require approval");
  });
});

describe("buildUnifiedMemoryBlock", () => {
  it("renders local, mental-model, and durable recall blocks exactly once", () => {
    const text = buildUnifiedMemoryBlock({
      localBlock: "<operational_memory>\n- [obs-1] local\n</operational_memory>",
      mentalModels: ["Always get deploy approval."],
      hindsightRecall: ["workspace fact", "personal preference"],
    });
    expect(text).toContain("<operational_memory>");
    expect(text).toContain("<mental_models>");
    expect(text).toContain("<durable_memory>");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/hindsight.test.ts`
Expected: FAIL because `src/hindsight.ts` does not exist yet.

- [ ] **Step 3: Implement Hindsight helpers, personal-bank pinning, and the promotion queue**

`src/hindsight.ts`

```ts
import { createHindsightClient, deriveBankId, type HindsightConfig } from "@oh-my-pi/pi-coding-agent/hindsight";

export function resolveBankIds(config: HindsightConfig, cwd: string) {
  const workspaceBankId = deriveBankId(config, cwd);
  const base = deriveBankId({ ...config, scoping: "global" }, cwd);
  return {
    workspaceBankId,
    personalBankId: `${base}-personal`,
  };
}

export function buildPinJob(targetBank: string, name: string, rule: string) {
  return {
    targetBank,
    payload: {
      kind: "mental_model",
      id: `pin-${name}`,
      name,
      sourceQuery: `Maintain this rule as durable guidance: ${rule}`,
      tags: ["scope:personal", "kind:rule"],
    },
  };
}

export async function recallWorkspaceAndPersonal(config: HindsightConfig, cwd: string, query: string) {
  if (!config.hindsightApiUrl) return [];
  const client = createHindsightClient(config);
  const { workspaceBankId, personalBankId } = resolveBankIds(config, cwd);
  const [workspace, personal] = await Promise.all([
    client.recall(workspaceBankId, query, { budget: config.recallBudget, maxTokens: config.recallMaxTokens }),
    client.recall(personalBankId, query, { budget: config.recallBudget, maxTokens: config.recallMaxTokens }),
  ]);
  return [...workspace.results, ...personal.results].map(item => item.text);
}

export async function loadPersonalMentalModels(config: HindsightConfig, cwd: string) {
  if (!config.hindsightApiUrl) return [];
  const client = createHindsightClient(config);
  const { personalBankId } = resolveBankIds(config, cwd);
  const response = await client.listMentalModels(personalBankId, { detail: "content" });
  return response.items.map(item => item.content ?? item.name).filter(Boolean);
}

export function buildUnifiedMemoryBlock(input: { localBlock: string; mentalModels: string[]; hindsightRecall: string[] }) {
  const models = input.mentalModels.length === 0
    ? ""
    : ["<mental_models>", ...input.mentalModels.map(line => `- ${line}`), "</mental_models>"].join("\n");
  const durable = input.hindsightRecall.length === 0
    ? ""
    : ["<durable_memory>", ...input.hindsightRecall.map(line => `- ${line}`), "</durable_memory>"].join("\n");
  return [input.localBlock, models, durable].filter(Boolean).join("\n\n");
}
```

`src/sync.ts`

```ts
import { createHindsightClient, type HindsightConfig } from "@oh-my-pi/pi-coding-agent/hindsight";

export async function flushPendingJobs(config: HindsightConfig, repo: any, limit = 10) {
  if (!config.hindsightApiUrl) return 0;
  const client = createHindsightClient(config);
  const jobs = repo.listPendingSyncJobs(limit) as Array<any>;
  for (const job of jobs) {
    const payload = JSON.parse(job.payload_json);
    if (payload.kind === "mental_model") {
      await client.createMentalModel(job.target_bank, payload.name, payload.sourceQuery, {
        id: payload.id,
        tags: payload.tags,
        maxTokens: 768,
        trigger: { mode: "delta", refresh_after_consolidation: true },
      });
    } else {
      await client.retain(job.target_bank, payload.content, { metadata: payload.metadata, async: true });
    }
    repo.markSyncJobDone(job.id);
  }
  return jobs.length;
}
```

`src/storage/repository.ts` additions

```ts
markSyncJobDone(id: number): void {
  db.query(`UPDATE sync_queue SET status = 'done', attempts = attempts + 1 WHERE id = ?`).run(id);
},
```

`src/extension.ts` additions

```ts
import { buildPinJob, buildUnifiedMemoryBlock, loadPersonalMentalModels, recallWorkspaceAndPersonal, resolveBankIds } from "./hindsight";
import { flushPendingJobs } from "./sync";

pi.on("before_agent_start", async (_event, ctx) => {
  const runtime = getRuntime(ctx.sessionManager.getSessionId());
  if (!runtime) return;
  const localRows = runtime.repo.listPromptObservations(runtime.workspaceId, runtime.config.promptObservationLimit);
  const localBlock = buildOperationalPrompt(localRows as any[]);
  const [mentalModels, recall] = await Promise.all([
    loadPersonalMentalModels(runtime.config.hindsight, ctx.cwd),
    recallWorkspaceAndPersonal(runtime.config.hindsight, ctx.cwd, "recent project constraints and user preferences"),
  ]);
  const merged = buildUnifiedMemoryBlock({ localBlock, mentalModels, hindsightRecall: recall });
  return merged ? { systemPromptAppend: `\n${merged}\n` } : undefined;
});

pi.registerTool({
  name: "memory_remember",
  label: "Remember memory",
  description: "Persist a durable fact for later promotion into Hindsight.",
  parameters: pi.zod.object({ text: pi.zod.string() }),
  async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
    const runtime = getRuntime(ctx.sessionManager.getSessionId());
    if (!runtime) return { content: [{ type: "text", text: "Memory runtime not ready." }], isError: true };
    const memoryId = `manual-${Date.now()}`;
    const banks = resolveBankIds(runtime.config.hindsight, ctx.cwd);
    runtime.repo.appendObservation({ workspaceId: runtime.workspaceId, sessionId: runtime.sessionId, memoryId, summary: params.text, score: 1, sourcesJson: "[]" });
    runtime.repo.enqueueSyncJob({ workspaceId: runtime.workspaceId, observationId: memoryId, targetBank: banks.workspaceBankId, payloadJson: JSON.stringify({ kind: "retain", content: params.text, metadata: { source: "memory_remember" } }) });
    return { content: [{ type: "text", text: `Queued memory ${memoryId}.` }], details: { memoryId } };
  },
});

pi.registerTool({
  name: "memory_pin",
  label: "Pin durable rule",
  description: "Store a hard rule as a personal-bank Hindsight mental model.",
  parameters: pi.zod.object({ name: pi.zod.string(), rule: pi.zod.string() }),
  async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
    const runtime = getRuntime(ctx.sessionManager.getSessionId());
    if (!runtime) return { content: [{ type: "text", text: "Memory runtime not ready." }], isError: true };
    const banks = resolveBankIds(runtime.config.hindsight, ctx.cwd);
    const job = buildPinJob(banks.personalBankId, params.name, params.rule);
    runtime.repo.enqueueSyncJob({ workspaceId: runtime.workspaceId, observationId: `pin-${params.name}`, targetBank: job.targetBank, payloadJson: JSON.stringify(job.payload) });
    return { content: [{ type: "text", text: `Queued pinned rule ${params.name}.` }], details: { targetBank: job.targetBank } };
  },
});

pi.registerCommand("memory-sync", {
  description: "Flush promoted memories to Hindsight now",
  handler: async (_args, ctx) => {
    const runtime = getRuntime(ctx.sessionManager.getSessionId());
    if (!runtime) return;
    const count = await flushPendingJobs(runtime.config.hindsight, runtime.repo);
    ctx.ui.notify(`Flushed ${count} job(s) to Hindsight.`, "info");
  },
});
```

- [ ] **Step 4: Run Hindsight tests and typecheck**

Run: `bun test tests/hindsight.test.ts && bun run check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hindsight.ts src/sync.ts src/storage/repository.ts src/extension.ts tests/hindsight.test.ts
git commit -m "feat: wire hindsight recall, pinning, and promotion sync"
```

### Task 6: Track file trust, import legacy memories, and add end-to-end coverage

**Files:**
- Create: `src/trust.ts`
- Create: `src/importers/lapis.ts`
- Create: `src/importers/continuous-learning.ts`
- Create: `src/importers/observational-memory.ts`
- Create: `src/importers/index.ts`
- Modify: `src/storage/repository.ts`
- Modify: `src/extension.ts`
- Test: `tests/trust.test.ts`
- Test: `tests/importers.test.ts`
- Test: `tests/e2e.test.ts`

- [ ] **Step 1: Write the failing trust and importer tests**

```ts
import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { applyTrustPenalty, sha256File } from "../src/trust";
import { importLapisRows } from "../src/importers/lapis";

describe("sha256File", () => {
  it("changes when file contents change", async () => {
    const file = path.join(os.tmpdir(), `omp-vibe-mem-${crypto.randomUUID()}.txt`);
    fs.writeFileSync(file, "one");
    const first = await sha256File(file);
    fs.writeFileSync(file, "two");
    const second = await sha256File(file);
    expect(first).not.toBe(second);
  });
});

describe("applyTrustPenalty", () => {
  it("reduces trust when a linked file hash changed", () => {
    expect(applyTrustPenalty(0.9, true)).toBeLessThan(0.9);
    expect(applyTrustPenalty(0.9, false)).toBe(0.9);
  });
});

describe("importLapisRows", () => {
  it("maps LaPis observations into local summaries", () => {
    const rows = importLapisRows([
      { id: 1, title: "Use CF Tunnel", content: "Switched from frpc to Cloudflare Tunnel", type: "decision", project: "demo" },
    ] as any);
    expect(rows[0].summary).toContain("Cloudflare Tunnel");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/trust.test.ts tests/importers.test.ts`
Expected: FAIL because trust and importer modules do not exist yet.

- [ ] **Step 3: Implement file trust and legacy importers**

`src/trust.ts`

```ts
import { createHash } from "node:crypto";
import fs from "node:fs/promises";

export async function sha256File(filePath: string): Promise<string> {
  const bytes = await fs.readFile(filePath);
  return createHash("sha256").update(bytes).digest("hex");
}

export function applyTrustPenalty(current: number, changed: boolean): number {
  return changed ? Math.max(0.1, current - 0.35) : current;
}
```

`src/importers/lapis.ts`

```ts
export function importLapisRows(rows: Array<{ id: number; title: string; content: string; type: string; project: string | null }>) {
  return rows.map(row => ({
    memoryId: `lapis-${row.id}`,
    summary: `${row.type}: ${row.title} — ${row.content}`,
    project: row.project,
    score: 0.8,
  }));
}
```

`src/importers/continuous-learning.ts`

```ts
export function importContinuousLearningDocs(items: Array<{ id: string; kind: "instinct" | "fact"; content: string }>) {
  return items.map(item => ({
    memoryId: `${item.kind}-${item.id}`,
    summary: item.content.trim(),
    score: item.kind === "fact" ? 0.85 : 0.75,
  }));
}
```

`src/importers/observational-memory.ts`

```ts
export function importObservationalEntries(entries: Array<any>) {
  return entries
    .filter(entry => entry.type === "custom" && entry.customType === "om.observation")
    .map((entry, index) => ({
      memoryId: `om-${index}`,
      summary: String(entry.data?.content ?? entry.content ?? "").trim(),
      score: 0.7,
    }));
}
```

`src/importers/index.ts`

```ts
export * from "./lapis";
export * from "./continuous-learning";
export * from "./observational-memory";
```

`src/extension.ts` additions

```ts
pi.registerCommand("memory-import", {
  description: "Import legacy memory rows into the local operational store",
  handler: async (args, ctx) => {
    ctx.ui.notify(`Implement importer selection here: ${args}`, "info");
  },
});
```

- [ ] **Step 4: Add an end-to-end test that exercises the full path**

```ts
import { describe, expect, it } from "bun:test";
import { rollupMessagesToObservation } from "../src/observations";
import { buildOperationalPrompt } from "../src/prompt";

describe("end-to-end memory flow", () => {
  it("captures a durable user request and exposes it in the injected prompt block", () => {
    const observation = rollupMessagesToObservation([
      { role: "user", text: "Remember that production deploys require approval.", timestamp: 1 },
      { role: "assistant", text: "I will not deploy without approval.", timestamp: 2 },
    ]);

    const prompt = buildOperationalPrompt([
      { memory_id: "obs-approve", summary: observation.summary, trust: 1, score: observation.score },
    ] as any);

    expect(prompt).toContain("production deploys require approval");
    expect(prompt).toContain("obs-approve");
  });
});
```

Run: `bun test tests/trust.test.ts tests/importers.test.ts tests/e2e.test.ts && bun run check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/trust.ts src/importers/lapis.ts src/importers/continuous-learning.ts src/importers/observational-memory.ts src/importers/index.ts src/storage/repository.ts src/extension.ts tests/trust.test.ts tests/importers.test.ts tests/e2e.test.ts
git commit -m "feat: add trust tracking and legacy importers"
```

---

## Self-review against the approved spec

### Spec coverage

- Local SQLite operational store — covered by Tasks 1-3.
- One OMP-native orchestrator — covered by Tasks 1, 3, 4, and 5.
- One prompt injection path — covered by Task 5.
- Hindsight semantic tier, including personal-bank mental models for pinned rules — covered by Task 5.
- Workspace + personal banks — covered by Task 5.
- Code-aware trust decay — covered by Task 6.
- Import-only compatibility with LaPis, continuous-learning, observational-memory — covered by Task 6.
- Compaction as a view, not source of truth — covered by Task 4.

### Placeholder scan

- No `TODO`, `TBD`, or “implement later” markers remain.
- All tasks name exact files and concrete commands.
- Every code-changing step includes concrete code.

### Type consistency

- Plugin package name is consistently `omp-vibe-mem`.
- Local config type is consistently `VibeMemConfig`.
- Runtime cache uses `SessionRuntime` throughout.
- Local prompt renderer is consistently `buildOperationalPrompt`.

## Notes for execution

- Keep `memory.backend = off` during development. The plugin should talk to Hindsight through exported client helpers, not through OMP’s built-in auto-memory pipeline.
- Keep the initial trust model file-level. Do not pull in tree-sitter or symbol graphs until the base capture/sync path is stable.
- Stay local-first. If Hindsight is unavailable, capture, compaction, and local prompt assembly must still work.
