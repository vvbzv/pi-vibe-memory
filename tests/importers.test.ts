import test from "node:test";
import assert from "node:assert/strict";
import {
  mapContinuousLearningFact,
  mapContinuousLearningInstinct,
} from "../src/importers/continuousLearning.js";
import { mapLapisArtifact } from "../src/importers/lapis.js";
import { mapObservationalMemoryRecord } from "../src/importers/observationalMemory.js";

test("observational-memory records map supplied legacy records to observations with provenance", () => {
  const mapped = mapObservationalMemoryRecord({
    record: {
      id: "om-123",
      content: "User decided pi-vibe-memory owns memory storage.",
      kind: "decision",
      relevance: "high",
      timestamp: "2026-05-17T10:00:00.000Z",
      sourceEntryIds: ["entry-1"],
    },
    workspaceId: "ws1",
    sessionId: "session-1",
    branchId: "branch-a",
  });

  assert.equal(mapped.id, "import_pi-observational-memory_om-123");
  assert.equal(mapped.kind, "decision");
  assert.equal(mapped.scope, "project");
  assert.equal(mapped.legacySource, "pi-observational-memory");
  assert.equal(mapped.legacyId, "om-123");
  assert.deepEqual(mapped.sourceEventIds, ["pi-observational-memory:om-123", "entry-1"]);
  assert.equal(mapped.provenance.source, "pi-observational-memory");
  assert.equal(mapped.provenance.legacyId, "om-123");
  assert.equal(mapped.provenance.branchId, "branch-a");
  assert.equal(mapped.sessionId, "session-1");
  assert.equal(mapped.status, "needs_review");
  assert.equal(mapped.trust, 0.75);
  assert.equal(mapped.hindsightDocumentId, "pi-import:pi-observational-memory:om-123");
});

test("continuous-learning facts map to declarative observations without deleting legacy knowledge", () => {
  const mapped = mapContinuousLearningFact({
    fact: {
      id: "fact-1",
      title: "Runtime",
      content: "Use Node test runner for package tests.",
      confidence: 0.84,
      evidence: ["tests passed", "plan requires npm test"],
      count: 3,
    },
    workspaceId: "ws1",
    projectSlug: "pi-vibe-memory",
  });

  assert.equal(mapped.kind, "fact");
  assert.equal(mapped.scope, "project");
  assert.equal(mapped.title, "Runtime");
  assert.equal(mapped.confidence, 0.84);
  assert.equal(mapped.legacySource, "pi-continuous-learning");
  assert.equal(mapped.legacyId, "fact-1");
  assert.equal(mapped.status, "needs_review");
  assert.deepEqual(mapped.provenance.evidence, ["tests passed", "plan requires npm test"]);
  assert.deepEqual(mapped.provenance.count, 3);
  assert.equal(mapped.deleteLegacy, false);
  assert.equal(mapped.hindsightDocumentId, "pi-import:pi-continuous-learning:fact-1");
  assert.match(mapped.content, /Use Node test runner/);
  assert.match(mapped.content, /Evidence:/);
});

test("continuous-learning instincts map to non-durable working candidates requiring review", () => {
  const mapped = mapContinuousLearningInstinct({
    instinct: {
      id: "instinct-1",
      trigger: "When adding package behavior",
      action: "Write a failing test first.",
      confidence: 0.91,
      evidence: ["tdd-skill", "plan"],
      count: 4,
      approved: true,
    },
    workspaceId: "ws1",
    sessionId: "session-1",
  });

  assert.equal(mapped.kind, "directive_candidate");
  assert.equal(mapped.trigger, "When adding package behavior");
  assert.equal(mapped.action, "Write a failing test first.");
  assert.equal(mapped.content, "When adding package behavior\nWrite a failing test first.");
  assert.equal(mapped.status, "working");
  assert.equal(mapped.durableApproved, false);
  assert.equal(mapped.reviewed, false);
  assert.equal(mapped.needsReview, true);
  assert.deepEqual(mapped.evidenceObservationIds, ["import_pi-continuous-learning_instinct-1_evidence_1", "import_pi-continuous-learning_instinct-1_evidence_2"]);
  assert.deepEqual(mapped.provenance.evidence, ["tdd-skill", "plan"]);
  assert.equal(mapped.provenance.legacyApproved, true);
  assert.equal(mapped.deleteLegacy, false);
});

test("LaPis selected artifact maps one supplied artifact only and rejects graph bulk imports", () => {
  const mapped = mapLapisArtifact({
    artifact: {
      id: "lapis-art-1",
      path: "src/runtime.ts",
      kind: "code",
      summary: "Runtime owns session queues.",
      trust: 0.65,
      sourceIds: ["mem-row-1"],
      symbol: "createRuntime",
      lineStart: 12,
      lineEnd: 30,
    },
    workspaceId: "ws1",
    sessionId: "session-1",
  });

  assert.equal(mapped.observation.kind, "code_reference");
  assert.equal(mapped.observation.status, "needs_review");
  assert.equal(mapped.observation.trust, 0.65);
  assert.equal(mapped.observation.legacySource, "lapis");
  assert.equal(mapped.observation.legacyId, "lapis-art-1");
  assert.deepEqual(mapped.observation.sourceEventIds, ["lapis:lapis-art-1", "mem-row-1"]);
  assert.equal(mapped.artifactReference.path, "src/runtime.ts");
  assert.equal(mapped.artifactReference.artifactType, "code_reference");
  assert.equal(mapped.artifactReference.observationId, mapped.observation.id);
  assert.equal(mapped.provenance.importMode, "selected_artifact_only");
  assert.equal(mapped.provenance.bulkGraphImport, false);
  assert.equal(mapped.deleteLegacy, false);

  assert.throws(
    () => mapLapisArtifact({
      artifact: {
        id: "graph-1",
        path: "src/runtime.ts",
        kind: "call_graph",
        summary: "bulk graph",
      },
      workspaceId: "ws1",
    }),
    /selected artifacts only/i,
  );
});

test("importer modules expose pure helpers only, not filesystem scanners", async () => {
  const [om, continuous, lapis] = await Promise.all([
    import("../src/importers/observationalMemory.js"),
    import("../src/importers/continuousLearning.js"),
    import("../src/importers/lapis.js"),
  ]);

  for (const mod of [om, continuous, lapis]) {
    assert.deepEqual(
      Object.keys(mod).filter((name) => /scan|crawl|delete|write|read.*db|import.*db/i.test(name)),
      [],
    );
  }
});
