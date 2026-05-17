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

    const matches = repo.searchObservations("installable npm", { workspaceId: "ws1", limit: 5 });
    assert.equal(matches.length, 1);
    assert.equal(matches[0]?.id, "obs1");
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

test("prompt observation and instinct lists are bounded and exclude inactive knowledge by default", async () => {
  const db = openVibeMemoryDb(await tempDbPath());
  try {
    const repo = new VibeMemoryRepository(db);
    repo.upsertWorkspace({ id: "ws1", name: "Project", rootPath: "/tmp/project" });

    repo.addObservation({ id: "active1", workspaceId: "ws1", kind: "fact", scope: "project", title: "Active 1", content: "First active memory.", status: "active" });
    repo.addObservation({ id: "active2", workspaceId: "ws1", kind: "fact", scope: "project", title: "Active 2", content: "Second active memory.", status: "active" });
    repo.addObservation({ id: "old", workspaceId: "ws1", kind: "fact", scope: "project", title: "Old", content: "Historical memory.", status: "historical" });

    assert.deepEqual(
      repo.listPromptObservations({ workspaceId: "ws1", limit: 1 }).map((item) => item.id),
      ["active2"],
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
