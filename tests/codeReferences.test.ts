import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyArtifactPath,
  extractArtifactReferences,
  summarizeArtifactReference,
} from "../src/codeReferences.js";

test("classifyArtifactPath classifies code, docs, config, and tests", () => {
  assert.equal(classifyArtifactPath("src/runtime.ts"), "code_reference");
  assert.equal(classifyArtifactPath("docs/design.md"), "doc_reference");
  assert.equal(classifyArtifactPath("package.json"), "config_reference");
  assert.equal(classifyArtifactPath("tests/capture.test.ts"), "test_reference");
});

test("extractArtifactReferences finds explicit paths, line ranges, and provenance only", () => {
  const refs = extractArtifactReferences({
    text: "Update src/runtime.ts and docs/superpowers/specs/2026-05-17-pi-vibe-memory-design.md:331-360. Also /repo/tests/capture.test.ts:12 failed.",
    workspaceRoot: "/repo",
    sourceEventId: "evt1",
    maxReferences: 10,
  });

  assert.deepEqual(refs.map((ref) => ref.path), [
    "src/runtime.ts",
    "docs/superpowers/specs/2026-05-17-pi-vibe-memory-design.md",
    "tests/capture.test.ts",
  ]);
  assert.equal(refs[1].lineStart, 331);
  assert.equal(refs[1].lineEnd, 360);
  assert.equal(refs[2].artifactType, "test_reference");
  assert.equal(refs[0].sourceEventId, "evt1");
  assert.match(refs[0].id, /^art_[a-f0-9]{16}$/);
  assert.ok(refs[0].provenanceDigest.length <= 160);
});

test("extractArtifactReferences dedupes, bounds output, and rejects outside or disallowed paths", () => {
  const refs = extractArtifactReferences({
    text: "src/a.ts src/a.ts /repo/src/b.ts ../secrets.txt /tmp/other/src/c.ts README.md package-lock.json",
    workspaceRoot: "/repo",
    sourceEventId: "evt2",
    allowedExtensions: [".ts", ".md"],
    maxReferences: 2,
  });

  assert.deepEqual(refs.map((ref) => ref.path), ["src/a.ts", "src/b.ts"]);
});

test("extractArtifactReferences preserves distinct ranges and scrubs provenance", () => {
  const refs = extractArtifactReferences({
    text: "token=abc123456789abcdef failed near src/a.ts:10 and src/a.ts:50-60",
    workspaceRoot: "/repo",
    sourceEventId: "evt-secret",
    maxReferences: 10,
  });

  assert.deepEqual(refs.map((ref) => `${ref.path}:${ref.lineStart ?? ""}-${ref.lineEnd ?? ""}`), [
    "src/a.ts:10-",
    "src/a.ts:50-60",
  ]);
  assert.ok(refs.every((ref) => !ref.provenanceDigest.includes("abc123456789abcdef")));
});

test("extractArtifactReferences rejects invalid ranges, drive paths, and invalid caps", () => {
  assert.deepEqual(extractArtifactReferences({ text: "src/a.ts:20-10", workspaceRoot: "/repo", sourceEventId: "evt" }), []);
  assert.deepEqual(extractArtifactReferences({ text: "C:/repo/src/a.ts", workspaceRoot: "/repo", sourceEventId: "evt" }), []);
  assert.deepEqual(extractArtifactReferences({ text: "src/a.ts src/b.ts", workspaceRoot: "/repo", sourceEventId: "evt", maxReferences: Number.NaN }), []);
});

test("summarizeArtifactReference is compact and untrusted path-focused", () => {
  const [ref] = extractArtifactReferences({
    text: "Failure in src/codeReferences.ts:44 from tool output with a long extra explanation that should not become a prompt-sized blob.",
    workspaceRoot: "/repo",
    sourceEventId: "evt3",
  });

  const summary = summarizeArtifactReference(ref);
  assert.match(summary, /src\/codeReferences\.ts:44/);
  assert.match(summary, /code_reference/);
  assert.ok(summary.length <= 220);
  assert.ok(!summary.includes("should not become a prompt-sized blob"));
});
