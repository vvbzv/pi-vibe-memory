import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCompactionSummary,
  shouldSkipCustomCompaction,
} from "../src/compaction.js";

test("buildCompactionSummary renders bounded memory continuity", () => {
  const summary = buildCompactionSummary({
    maxSummaryChars: 1600,
    previousSummary: "## Goal\nBuild pi-vibe-memory",
    activeFacts: [{ id: "fact1", kind: "project_fact", content: "Use one memory extension." }],
    decisions: [{ id: "dec1", kind: "project_decision", content: "pi-vibe-memory replaces old memory extensions." }],
    instincts: [{ id: "inst1", content: "When changing behavior, write tests first." }],
    revisions: [{ id: "rev1", reason: "No-compaction assumption was superseded because old extension will be removed." }],
    artifacts: [{ id: "art1", path: "src/runtime.ts", artifactType: "code_reference" }],
    fileOps: { readFiles: ["src/runtime.ts"], modifiedFiles: ["src/compaction.ts"] },
    syncStatus: "0 pending sync jobs",
  });

  assert.match(summary, /## Pi Vibe Memory Continuity/);
  assert.match(summary, /Use one memory extension/);
  assert.match(summary, /write tests first/);
  assert.match(summary, /No-compaction assumption/);
  assert.match(summary, /<read-files>/);
  assert.match(summary, /<modified-files>/);
  assert.ok(summary.length <= 1600);
});

test("buildCompactionSummary excludes destructive language", () => {
  const summary = buildCompactionSummary({
    maxSummaryChars: 1200,
    activeFacts: [{ id: "fact1", kind: "project_fact", content: "Old memories are historical, not deleted." }],
  });

  assert.match(summary, /Old memories are historical, not deleted/);
  assert.doesNotMatch(summary, /forget old knowledge/i);
});

test("buildCompactionSummary is deterministic and drops lower-priority sections to fit", () => {
  const input = {
    maxSummaryChars: 520,
    previousSummary: "## Goal\nThis previous summary is useful but lower priority than the continuity header.",
    decisions: [{ id: "dec1", content: "Keep deterministic compaction." }],
    activeFacts: [{ id: "fact1", content: "Use local SQLite only." }],
    instincts: [{ id: "inst1", content: "Run tests before declaring completion." }],
    revisions: [{ id: "rev1", reason: "Newer evidence supersedes older assumptions." }],
    artifacts: [{ id: "art1", path: "src/runtime.ts", artifactType: "code_reference" }],
    fileOps: { readFiles: ["src/runtime.ts"], modifiedFiles: ["src/compaction.ts"] },
    syncStatus: "12 pending sync jobs",
  };

  assert.equal(buildCompactionSummary(input), buildCompactionSummary(input));
  assert.ok(buildCompactionSummary(input).length <= input.maxSummaryChars);
  assert.match(buildCompactionSummary(input), /Current instructions outrank memory/);
});

test("shouldSkipCustomCompaction skips known and unknown competing memory owners", () => {
  assert.equal(shouldSkipCustomCompaction([{ type: "compaction", details: { type: "observational-memory" } }]), true);
  assert.equal(shouldSkipCustomCompaction([{ type: "compaction", details: { type: "pi-observational-memory" } }]), true);
  assert.equal(shouldSkipCustomCompaction([{ type: "compaction", details: { type: "other-memory-owner" } }]), true);
  assert.equal(shouldSkipCustomCompaction([{ type: "compaction", details: { type: "pi-vibe-memory" } }]), false);
  assert.equal(shouldSkipCustomCompaction([{ type: "message", details: { type: "other-memory-owner" } }]), false);
});
