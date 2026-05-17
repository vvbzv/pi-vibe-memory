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

test("flushSyncQueue flushes one job at a time to avoid partial retain ambiguity", async () => {
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

  assert.deepEqual(calls, [
    { bankId: "pi", items: [{ content: "hello" }] },
    { bankId: "pi", items: [{ content: "world" }] },
  ]);
  assert.deepEqual(marked, ["job1", "job2"]);
  assert.equal(result.succeeded, 2);
  assert.equal(result.failed, 0);
});


test("enqueueObservationSync is idempotent for deterministic observation jobs", async () => {
  const db = openVibeMemoryDb(await tempDbPath());
  try {
    const repository = new VibeMemoryRepository(db);
    repository.upsertWorkspace({ id: "ws1", name: "Project", rootPath: "/tmp/project" });
    repository.addObservation({ id: "obs1", workspaceId: "ws1", kind: "decision", scope: "project", title: "Original", content: "Original content.", status: "active" });
    const original = repository.getObservation("obs1");
    assert.ok(original);

    enqueueObservationSync(repository, original, "pi");
    repository.markSyncJobFailed("sync:pi:observation:obs1", "Hindsight offline");
    const failed = repository.listPendingSyncJobs(5)[0];
    assert.equal(failed?.attempts, 1);

    repository.addObservation({ id: "obs1", workspaceId: "ws1", kind: "decision", scope: "project", title: "Updated", content: "Updated content.", status: "active" });
    const updated = repository.getObservation("obs1");
    assert.ok(updated);
    assert.doesNotThrow(() => enqueueObservationSync(repository, updated, "pi"));

    const jobs = repository.listPendingSyncJobs(5);
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0]?.createdAt, failed?.createdAt);
    assert.equal(jobs[0]?.attempts, 0);
    assert.equal(jobs[0]?.lastError, undefined);
    assert.match(JSON.stringify(jobs[0]?.payload), /Updated content/);
  } finally {
    db.close();
  }
});

test("flushSyncQueue marks malformed jobs failed and still flushes valid jobs", async () => {
  const marked: string[] = [];
  const failed: Array<{ id: string; error: string }> = [];
  const calls: Array<{ bankId: string; items: unknown[] }> = [];
  const repository = {
    listPendingSyncJobs: () => [
      { id: "blank-bank", operation: "retain_observation", payload: { bankId: "  ", items: [{ content: "ignored" }] }, attempts: 0, createdAt: "1", updatedAt: "1" },
      { id: "missing-content", operation: "retain_observation", payload: { bankId: "pi", items: [{ documentId: "doc" }] }, attempts: 0, createdAt: "2", updatedAt: "2" },
      { id: "valid", operation: "retain_observation", payload: { bankId: "pi", items: [{ content: "kept" }] }, attempts: 0, createdAt: "3", updatedAt: "3" },
    ],
    markSyncJobDone: (id: string) => marked.push(id),
    markSyncJobFailed: (id: string, error: string) => failed.push({ id, error }),
  };
  const hindsight = { retainBatch: async (bankId: string, items: unknown[]) => { calls.push({ bankId, items }); return { ok: true }; } };

  const result = await flushSyncQueue({ repository, hindsight, maxBatchItems: 10 });

  assert.deepEqual(calls, [{ bankId: "pi", items: [{ content: "kept" }] }]);
  assert.deepEqual(marked, ["valid"]);
  assert.deepEqual(failed.map((item) => item.id).sort(), ["blank-bank", "missing-content"]);
  assert.equal(result.succeeded, 1);
  assert.equal(result.failed, 2);
});

test("flushSyncQueue keeps failed jobs queued while later valid jobs can succeed", async () => {
  const marked: string[] = [];
  const failed: Array<{ id: string; error: string }> = [];
  const repository = {
    listPendingSyncJobs: () => [
      { id: "fail", operation: "retain_observation", payload: { bankId: "pi", items: [{ content: "first" }] }, attempts: 0, createdAt: "1", updatedAt: "1" },
      { id: "pass", operation: "retain_observation", payload: { bankId: "pi", items: [{ content: "second" }] }, attempts: 0, createdAt: "2", updatedAt: "2" },
    ],
    markSyncJobDone: (id: string) => marked.push(id),
    markSyncJobFailed: (id: string, error: string) => failed.push({ id, error }),
  };
  const hindsight = { retainBatch: async (_bankId: string, items: unknown[]) => { if (JSON.stringify(items).includes("first")) throw new Error("first failed"); return { ok: true }; } };

  const result = await flushSyncQueue({ repository, hindsight, maxBatchItems: 10 });

  assert.deepEqual(marked, ["pass"]);
  assert.deepEqual(failed, [{ id: "fail", error: "first failed" }]);
  assert.equal(result.succeeded, 1);
  assert.equal(result.failed, 1);
});

test("flushSyncQueue scrubs retained failure messages", async () => {
  const failed: Array<{ id: string; error: string }> = [];
  const repository = {
    listPendingSyncJobs: () => [
      { id: "job1", operation: "retain_observation", payload: { bankId: "pi", items: [{ content: "hello" }] }, attempts: 0, createdAt: "now", updatedAt: "now" },
    ],
    markSyncJobDone: () => undefined,
    markSyncJobFailed: (id: string, error: string) => failed.push({ id, error }),
  };
  const hindsight = {
    retainBatch: async () => { throw new Error("retain failed apiKey=sync-secret-token"); },
  };

  const result = await flushSyncQueue({ repository, hindsight, maxBatchItems: 10 });

  assert.equal(result.failed, 1);
  assert.equal(failed[0]?.id, "job1");
  assert.match(failed[0]?.error ?? "", /\[REDACTED_SECRET\]/);
  assert.doesNotMatch(failed[0]?.error ?? "", /sync-secret-token/);
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
