import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { buildHindsightMemoryItem, enqueueObservationSync, flushSyncQueue } from "../src/hindsight/sync.js";
import { openVibeMemoryDb } from "../src/storage/db.js";
import { VibeMemoryRepository } from "../src/storage/repository.js";

async function tempDbPath() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "pvm-sync-"));
  return path.join(dir, "memory.db");
}

test("buildHindsightMemoryItem uses deterministic document ids, replace mode, and safety tags", () => {
  const item = buildHindsightMemoryItem({
    id: "obs1",
    workspaceId: "ws1",
    sessionId: "s1",
    kind: "decision",
    scope: "project",
    title: "Deployment shape",
    content: "Use an installable Pi package.",
    sourceEventIds: [],
    tags: ["decision"],
    confidence: 0.8,
    trust: 0.9,
    status: "active",
    createdAt: "2026-05-17T00:00:00.000Z",
    updatedAt: "2026-05-17T00:00:00.000Z",
  });

  assert.equal(item.documentId, "pi-observation:obs1");
  assert.equal(item.updateMode, "replace");
  assert.deepEqual(item.tags, [
    "pi",
    "pi-vibe-memory",
    "workspace:ws1",
    "session:s1",
    "kind:decision",
    "status:active",
    "decision",
  ]);
  assert.match(item.content, /Status: active/);
  assert.match(item.content, /Kind: decision/);
});

test("buildHindsightMemoryItem preserves artifact tags without adding graph-analysis claims", () => {
  const item = buildHindsightMemoryItem({
    id: "obs-art1",
    workspaceId: "ws1",
    sessionId: "s1",
    kind: "code_reference",
    scope: "project",
    title: "Runtime reference",
    content: "Referenced code artifact src/runtime.ts during runtime design.",
    sourceEventIds: [],
    tags: ["code_reference", "doc_reference", "artifact:src-runtime-ts"],
    confidence: 0.7,
    trust: 0.8,
    status: "active",
    createdAt: "2026-05-17T00:00:00.000Z",
    updatedAt: "2026-05-17T00:00:00.000Z",
  });

  assert.equal(item.documentId, "pi-observation:obs-art1");
  assert.ok(item.tags?.includes("code_reference"));
  assert.ok(item.tags?.includes("doc_reference"));
  assert.ok(item.tags?.includes("artifact:src-runtime-ts"));
  assert.doesNotMatch(item.content, /call graph|PageRank|dead code/i);
});

test("buildHindsightMemoryItem labels superseded and historical observations so they are not active facts", () => {
  const superseded = buildHindsightMemoryItem({
    id: "old",
    workspaceId: "ws1",
    kind: "fact",
    scope: "project",
    title: "Old storage location",
    content: "Memory should use the LaPis database.",
    sourceEventIds: [],
    tags: ["fact"],
    confidence: 0.5,
    trust: 0.4,
    status: "superseded",
    createdAt: "2026-05-17T00:00:00.000Z",
    updatedAt: "2026-05-17T00:01:00.000Z",
  });

  assert.ok(superseded.tags?.includes("status:superseded"));
  assert.match(superseded.content, /Status: superseded/);
  assert.match(superseded.content, /not an active fact/i);

  const historical = buildHindsightMemoryItem({
    id: "hist",
    workspaceId: "ws1",
    kind: "summary",
    scope: "session",
    title: "Historical summary",
    content: "Earlier context retained for provenance.",
    sourceEventIds: [],
    tags: [],
    confidence: 0.5,
    trust: 0.4,
    status: "historical",
    createdAt: "2026-05-17T00:00:00.000Z",
    updatedAt: "2026-05-17T00:01:00.000Z",
  });

  assert.ok(historical.tags?.includes("status:historical"));
  assert.match(historical.content, /Status: historical/);
  assert.match(historical.content, /not an active fact/i);
});

test("enqueueObservationSync stores a retain payload for the observation bank", async () => {
  const db = openVibeMemoryDb(await tempDbPath());
  try {
    const repository = new VibeMemoryRepository(db);
    repository.upsertWorkspace({ id: "ws1", name: "Project", rootPath: "/tmp/project" });
    repository.addObservation({
      id: "obs1",
      workspaceId: "ws1",
      kind: "decision",
      scope: "project",
      title: "Deployment shape",
      content: "Use an installable Pi package.",
      tags: ["decision"],
      status: "active",
    });
    const observation = repository.getObservation("obs1");
    assert.ok(observation);

    enqueueObservationSync(repository, observation, "pi");

    const [job] = repository.listPendingSyncJobs(5);
    assert.equal(job?.id, "sync:pi:observation:obs1");
    assert.equal(job?.observationId, "obs1");
    assert.equal(job?.operation, "retain_observation");
    assert.deepEqual(job?.payload, {
      bankId: "pi",
      items: [buildHindsightMemoryItem(observation)],
    });
  } finally {
    db.close();
  }
});

test("flushSyncQueue batches jobs by bank and marks them done after retain", async () => {
  const marked: string[] = [];
  const calls: Array<{ bankId: string; items: unknown[] }> = [];
  const repository = {
    listPendingSyncJobs: () => [
      { id: "job1", operation: "retain_observation", payload: { bankId: "pi", items: [{ content: "hello" }] }, attempts: 0, createdAt: "now", updatedAt: "now" },
      { id: "job2", operation: "retain_observation", payload: { bankId: "pi", items: [{ content: "world" }] }, attempts: 0, createdAt: "now", updatedAt: "now" },
    ],
    markSyncJobDone: (id: string) => marked.push(id),
    markSyncJobFailed: () => undefined,
  };
  const hindsight = {
    retainBatch: async (bankId: string, items: unknown[]) => {
      calls.push({ bankId, items });
      return { ok: true };
    },
  };

  const result = await flushSyncQueue({ repository, hindsight, maxBatchItems: 10 });

  assert.deepEqual(calls, [{ bankId: "pi", items: [{ content: "hello" }, { content: "world" }] }]);
  assert.deepEqual(marked, ["job1", "job2"]);
  assert.equal(result.succeeded, 2);
  assert.equal(result.failed, 0);
});

test("flushSyncQueue records failed attempts without throwing by default", async () => {
  const failed: Array<{ id: string; error: string }> = [];
  const marked: string[] = [];
  const repository = {
    listPendingSyncJobs: () => [
      { id: "job1", operation: "retain_observation", payload: { bankId: "pi", items: [{ content: "hello" }] }, attempts: 0, createdAt: "now", updatedAt: "now" },
      { id: "job2", operation: "retain_observation", payload: { bankId: "personal", items: [{ content: "preference" }] }, attempts: 0, createdAt: "now", updatedAt: "now" },
    ],
    markSyncJobDone: (id: string) => marked.push(id),
    markSyncJobFailed: (id: string, error: string) => failed.push({ id, error }),
  };
  const hindsight = {
    retainBatch: async (bankId: string) => {
      if (bankId === "pi") throw new Error("Hindsight offline");
      return { ok: true };
    },
  };

  const result = await flushSyncQueue({ repository, hindsight, maxBatchItems: 10 });

  assert.deepEqual(marked, ["job2"]);
  assert.equal(result.succeeded, 1);
  assert.equal(result.failed, 1);
  assert.equal(failed.length, 1);
  assert.equal(failed[0]?.id, "job1");
  assert.match(failed[0]?.error ?? "", /Hindsight offline/);
});
