import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { openVibeMemoryDb } from "../src/storage/db.js";
import { VibeMemoryRepository } from "../src/storage/repository.js";

async function tempDbPath() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "pvm-db-"));
  return path.join(dir, "memory.db");
}

test("database initializes with WAL, pragmas, schema version, and required tables", async () => {
  const db = openVibeMemoryDb(await tempDbPath());
  try {
    assert.equal(db.pragma("journal_mode", { simple: true }), "wal");
    assert.equal(db.pragma("foreign_keys", { simple: true }), 1);
    assert.equal(db.pragma("busy_timeout", { simple: true }), 5000);
    assert.equal(db.pragma("user_version", { simple: true }), 1);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'virtual')")
      .all()
      .map((row) => (row as { name: string }).name);

    for (const tableName of [
      "workspaces",
      "sessions",
      "raw_events",
      "observations",
      "artifact_references",
      "meditation_runs",
      "instinct_candidates",
      "memory_revisions",
      "trust_adjustments",
      "sync_queue",
      "observations_fts",
    ]) {
      assert.ok(tables.includes(tableName), `${tableName} should exist`);
    }

    assert.doesNotThrow(() => db.prepare("SELECT rowid FROM observations_fts LIMIT 1").all());
  } finally {
    db.close();
  }
});

test("repository stores and searches observations", async () => {
  const db = openVibeMemoryDb(await tempDbPath());
  try {
    const repo = new VibeMemoryRepository(db);
    repo.upsertWorkspace({ id: "ws1", name: "Project", rootPath: "/tmp/project" });
    repo.startSession({ id: "s1", workspaceId: "ws1", branchId: "leaf" });
    repo.addObservation({
      id: "obs1",
      workspaceId: "ws1",
      sessionId: "s1",
      kind: "decision",
      scope: "project",
      title: "Deployment shape",
      content: "User chose an installable npm package for Pi Vibe Memory.",
      sourceEventIds: [],
      tags: ["decision"],
      confidence: 0.8,
      trust: 0.9,
    });
    repo.addObservation({
      id: "obs-old",
      workspaceId: "ws1",
      kind: "decision",
      scope: "project",
      title: "Old deployment shape",
      content: "User chose an installable npm package but this old wording is historical.",
      status: "historical",
    });

    const matches = repo.searchObservations("installable npm", { workspaceId: "ws1", limit: 5 });
    assert.equal(matches.length, 1);
    assert.equal(matches[0]?.id, "obs1");

    const hyphenated = repo.searchObservations("installable-npm", { workspaceId: "ws1", limit: 5 });
    assert.deepEqual(hyphenated.map((item) => item.id), ["obs1"]);

    const withInactive = repo.searchObservations("installable npm", { workspaceId: "ws1", limit: 5, includeInactive: true });
    assert.deepEqual(withInactive.map((item) => item.id).sort(), ["obs-old", "obs1"]);
  } finally {
    db.close();
  }
});

test("comparative revisions supersede without deleting old observations", async () => {
  const db = openVibeMemoryDb(await tempDbPath());
  try {
    const repo = new VibeMemoryRepository(db);
    repo.upsertWorkspace({ id: "ws1", name: "Project", rootPath: "/tmp/project" });
    repo.addObservation({
      id: "old",
      workspaceId: "ws1",
      kind: "fact",
      scope: "project",
      title: "Storage location",
      content: "Memory should use the LaPis database.",
    });
    repo.addObservation({
      id: "new",
      workspaceId: "ws1",
      kind: "fact",
      scope: "project",
      title: "Storage location",
      content: "Memory should use the extension-owned vibe-memory database.",
    });

    repo.recordMemoryRevision({
      id: "rev1",
      oldObservationId: "old",
      newObservationId: "new",
      relation: "supersedes",
      reason: "Old knowledge reused LaPis storage, which violates the extension ownership boundary.",
    });

    const oldObservation = repo.getObservation("old");
    assert.equal(oldObservation?.status, "superseded");
    assert.match(oldObservation?.content ?? "", /LaPis database/);

    const promptItems = repo.listPromptObservations({ workspaceId: "ws1", limit: 10 });
    assert.deepEqual(promptItems.map((item) => item.id), ["new"]);

    const revisions = repo.listMemoryRevisions("old");
    assert.equal(revisions.length, 1);
    assert.equal(revisions[0]?.oldObservationId, "old");
    assert.equal(revisions[0]?.newObservationId, "new");
    assert.match(revisions[0]?.reason ?? "", /violates the extension ownership boundary/);
  } finally {
    db.close();
  }
});

test("prompt observation and instinct lists are bounded, ranked, and exclude inactive knowledge by default", async () => {
  const db = openVibeMemoryDb(await tempDbPath());
  try {
    const repo = new VibeMemoryRepository(db);
    repo.upsertWorkspace({ id: "ws1", name: "Project", rootPath: "/tmp/project" });

    repo.addObservation({ id: "low-trust-new", workspaceId: "ws1", kind: "fact", scope: "project", title: "Active 1", content: "Fresh but low-trust memory.", status: "active", confidence: 0.2, trust: 0.2 });
    repo.addObservation({ id: "high-trust", workspaceId: "ws1", kind: "fact", scope: "project", title: "Active 2", content: "Better trusted memory.", status: "active", confidence: 0.9, trust: 0.9 });
    repo.addObservation({ id: "old", workspaceId: "ws1", kind: "fact", scope: "project", title: "Old", content: "Historical memory.", status: "historical", confidence: 1, trust: 1 });

    assert.deepEqual(
      repo.listPromptObservations({ workspaceId: "ws1", limit: 1 }).map((item) => item.id),
      ["high-trust"],
    );

    repo.addInstinctCandidate({ id: "i1", workspaceId: "ws1", kind: "reflection", content: "Use narrow tests.", confidence: 0.9, status: "working" });
    repo.addInstinctCandidate({ id: "i2", workspaceId: "ws1", kind: "reflection", content: "Needs review.", confidence: 0.8, status: "needs_review" });
    repo.addInstinctCandidate({ id: "i3", workspaceId: "ws1", kind: "reflection", content: "Historical.", confidence: 1, status: "historical" });

    assert.deepEqual(
      repo.listPromptInstincts({ workspaceId: "ws1", limit: 2 }).map((item) => item.id),
      ["i1", "i2"],
    );
  } finally {
    db.close();
  }
});


test("repository filters typed observations and updates review statuses", async () => {
  const db = openVibeMemoryDb(await tempDbPath());
  try {
    const repo = new VibeMemoryRepository(db);
    repo.upsertWorkspace({ id: "ws1", name: "Project", rootPath: "/tmp/project" });
    repo.addObservation({ id: "fact1", workspaceId: "ws1", kind: "project_fact", scope: "project", title: "Hindsight", content: "Hindsight server runs locally.", status: "active" });
    repo.addObservation({ id: "risk1", workspaceId: "ws1", kind: "risk_note", scope: "project", title: "Risk", content: "Hindsight server can be offline.", status: "historical" });
    repo.addObservation({ id: "review1", workspaceId: "ws1", kind: "project_decision", scope: "project", title: "Review", content: "Review this decision.", status: "needs_review" });
    repo.addInstinctCandidate({ id: "inst1", workspaceId: "ws1", kind: "behavior_instinct", content: "Use TDD.", status: "needs_review" });

    assert.deepEqual(
      repo.searchObservations("Hindsight server", { workspaceId: "ws1", kind: "project_fact", status: "active", limit: 10 }).map((item) => item.id),
      ["fact1"],
    );
    assert.deepEqual(
      repo.searchObservations("Hindsight server", { workspaceId: "ws1", includeHistorical: true, limit: 10 }).map((item) => item.id).sort(),
      ["fact1", "risk1"],
    );
    assert.deepEqual(repo.listReviewObservations({ workspaceId: "ws1", limit: 10 }).map((item) => item.id), ["review1"]);

    repo.setObservationStatus("review1", "active");
    repo.setInstinctCandidateStatus("inst1", "active");
    assert.equal(repo.getObservation("review1")?.status, "active");
    assert.equal(repo.listPromptInstincts({ workspaceId: "ws1", limit: 10 }).find((item) => item.id === "inst1")?.status, "active");
  } finally {
    db.close();
  }
});



test("repository orders sync, search, reviews, and revisions with deterministic id tie-breakers", async () => {
  const db = openVibeMemoryDb(await tempDbPath());
  try {
    const repo = new VibeMemoryRepository(db);
    repo.upsertWorkspace({ id: "ws1", name: "Project", rootPath: "/tmp/project" });
    for (const id of ["b", "a", "c"]) {
      repo.addObservation({ id, workspaceId: "ws1", kind: "fact", scope: "project", title: "Tie breaker", content: "Deterministic ordering content", status: "needs_review", confidence: 0.8, trust: 0.8 });
      repo.enqueueSyncJob({ id: `sync:${id}`, observationId: id, operation: "retain_observation", payload: { bankId: "pi", items: [{ content: id }] } });
    }
    repo.recordMemoryRevision({ id: "rev-b", oldObservationId: "a", newObservationId: "b", relation: "related", reason: "same timestamp" });
    repo.recordMemoryRevision({ id: "rev-a", oldObservationId: "a", newObservationId: "c", relation: "related", reason: "same timestamp" });
    assert.deepEqual(repo.listPendingSyncJobs(10).map((item) => item.id), ["sync:a", "sync:b", "sync:c"]);
    assert.deepEqual(repo.listReviewObservations({ workspaceId: "ws1", limit: 10 }).map((item) => item.id), ["a", "b", "c"]);
    assert.deepEqual(repo.searchObservations("Deterministic", { workspaceId: "ws1", includeInactive: true, limit: 10 }).map((item) => item.id).sort(), ["a", "b", "c"]);
    assert.deepEqual(repo.listMemoryRevisions("a").map((item) => item.id), ["rev-a", "rev-b"]);
  } finally { db.close(); }
});

test("repository scoped observation approval persists status, scope, tags and queues changed observation", async () => {
  const db = openVibeMemoryDb(await tempDbPath());
  try {
    const repo = new VibeMemoryRepository(db);
    repo.upsertWorkspace({ id: "ws1", name: "Project", rootPath: "/tmp/project" });
    repo.addObservation({ id: "review1", workspaceId: "ws1", kind: "project_fact", scope: "project", title: "Review", content: "Needs scoped approval.", tags: ["old"], status: "needs_review" });
    repo.updateObservationReview({ id: "review1", status: "active", scope: "global", tags: ["approved", "approved", "global"] });
    const observation = repo.getObservation("review1");
    assert.equal(observation?.status, "active");
    assert.equal(observation?.scope, "global");
    assert.deepEqual(observation?.tags, ["approved", "global"]);
    const job = repo.listPendingSyncJobs(10)[0];
    assert.equal(job?.id, "sync:pi:observation:review1");
    assert.match(JSON.stringify(job?.payload), /status:active/);
    assert.match(JSON.stringify(job?.payload), /scope:global/);
  } finally { db.close(); }
});

test("repository returns compact memory stats", async () => {
  const db = openVibeMemoryDb(await tempDbPath());
  try {
    const repo = new VibeMemoryRepository(db);
    repo.upsertWorkspace({ id: "ws1", name: "Project", rootPath: "/tmp/project" });
    repo.startSession({ id: "s1", workspaceId: "ws1" });
    repo.appendRawEvent({ id: "raw1", sessionId: "s1", kind: "turn_end", content: { ok: true } });
    repo.addObservation({ id: "active1", workspaceId: "ws1", kind: "project_fact", scope: "project", title: "Active", content: "Active memory", status: "active" });
    repo.addObservation({ id: "review1", workspaceId: "ws1", kind: "project_decision", scope: "project", title: "Review", content: "Needs review", status: "needs_review" });
    repo.addObservation({ id: "old1", workspaceId: "ws1", kind: "project_fact", scope: "project", title: "Old", content: "Old memory", status: "superseded" });
    repo.addInstinctCandidate({ id: "inst1", workspaceId: "ws1", kind: "behavior_instinct", content: "Use tests.", status: "needs_review" });
    repo.upsertArtifactReference({ id: "art1", workspaceId: "ws1", path: "src/runtime.ts", artifactType: "code_reference" });
    repo.recordMemoryRevision({ id: "rev1", oldObservationId: "old1", newObservationId: "active1", relation: "supersedes", reason: "Newer fact" });
    repo.enqueueSyncJob({ id: "sync1", operation: "retain_observation", payload: { bankId: "pi", items: [{ content: "x" }] } });
    repo.markSyncJobFailed("sync1", "temporary offline");

    const stats = repo.getStats("ws1");
    assert.equal(stats.observations.total, 3);
    assert.equal(stats.observations.activeLike, 2);
    assert.equal(stats.observations.needsReview, 1);
    assert.equal(stats.observations.byKind.project_fact, 2);
    assert.equal(stats.instincts.needsReview, 1);
    assert.equal(stats.artifacts.total, 1);
    assert.equal(stats.revisions.total, 1);
    assert.equal(stats.rawEvents.total, 1);
    assert.equal(stats.sync.pending, 1);
    assert.equal(stats.sync.failed, 1);
  } finally {
    db.close();
  }
});

test("artifact references dedupe path-only rows", async () => {
  const db = openVibeMemoryDb(await tempDbPath());
  try {
    const repo = new VibeMemoryRepository(db);
    repo.upsertWorkspace({ id: "ws1", name: "Project", rootPath: "/tmp/project" });

    repo.upsertArtifactReference({ id: "art1", workspaceId: "ws1", path: "src/runtime.ts", artifactType: "code_reference" });
    repo.upsertArtifactReference({ id: "art2", workspaceId: "ws1", path: "src/runtime.ts", artifactType: "code_reference" });

    const refs = repo.listArtifactReferences({ workspaceId: "ws1", limit: 10 });
    assert.equal(refs.length, 1);
    assert.equal(refs[0]?.path, "src/runtime.ts");
  } finally {
    db.close();
  }
});
