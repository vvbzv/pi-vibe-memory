import test from "node:test";
import assert from "node:assert/strict";
import { normalizeTurnEndEvent, shouldCapturePrompt } from "../src/capture.js";
import { scrubSecrets, truncateText } from "../src/scrub.js";

test("scrubSecrets redacts common secret classes and caps content", () => {
  const scrubbed = scrubSecrets(
    "Authorization: Bearer sk-test_abcdefghijklmnopqrstuvwxyz123456 api_key=abc1234567890abcdef AWS_SECRET_ACCESS_KEY=abcd1234abcd1234abcd1234 DATABASE_URL=postgres://user:pass@example.com/db jwt=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.signature -----BEGIN PRIVATE KEY----- abc -----END PRIVATE KEY----- keep this tail",
    { maxChars: 160 },
  );

  for (const leaked of [
    "sk-test_abcdefghijklmnopqrstuvwxyz123456",
    "abc1234567890abcdef",
    "abcd1234abcd1234abcd1234",
    "postgres://user:pass@example.com/db",
    "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.signature",
    "BEGIN PRIVATE KEY",
  ]) {
    assert.ok(!scrubbed.includes(leaked), `${leaked} leaked`);
  }
  assert.match(scrubbed, /\[REDACTED_SECRET\]/);
  assert.ok(scrubbed.length <= 160);
});

test("truncateText is deterministic and stays within hard cap", () => {
  assert.equal(truncateText("abcdef", 20), "abcdef");
  assert.equal(truncateText("abcdefghijklmnopqrstuvwxyz", 18), "…[truncated 8 char");
  assert.ok(truncateText("abcdefghijklmnopqrstuvwxyz", 18).length <= 18);
});

test("shouldCapturePrompt drops trivial prompts and honors raw capture setting", () => {
  assert.equal(shouldCapturePrompt("hi", { captureRawPrompts: true }), false);
  assert.equal(shouldCapturePrompt("approve", { captureRawPrompts: true }), false);
  assert.equal(shouldCapturePrompt("thanks", { captureRawPrompts: true }), false);
  assert.equal(shouldCapturePrompt("Design the memory extension", { captureRawPrompts: false }), false);
  assert.equal(shouldCapturePrompt("Design the memory extension", { captureRawPrompts: true }), true);
});

test("normalizeTurnEndEvent returns compact scrubbed provenance without raw prompt when disabled", () => {
  const normalized = normalizeTurnEndEvent({
    sessionId: "sess1",
    turnId: "turn7",
    entryId: "entry9",
    parentEntryId: "entry8",
    cwd: "/repo",
    userPrompt: "Please update src/capture.ts using token=abc123456789abcdef and explain the tradeoff.",
    assistantText: "Implemented capture helpers and tests.",
    captureRawPrompts: false,
    maxSnippetChars: 80,
  });

  assert.ok(normalized);
  assert.equal(normalized.rawEvent.sessionId, "sess1");
  assert.equal(normalized.rawEvent.entryId, "entry9");
  assert.equal(normalized.rawEvent.parentEntryId, "entry8");
  assert.equal(normalized.rawEvent.kind, "turn_end");
  assert.equal(normalized.rawEvent.source.id, "turn7");
  assert.equal(normalized.rawEvent.source.kind, "pi_turn");
  assert.equal(normalized.rawEvent.payload.userPrompt, undefined);
  const serialized = JSON.stringify(normalized);
  assert.ok(!serialized.includes("abc123456789abcdef"));
  assert.ok(!serialized.includes("Please update src/capture.ts"));
  assert.equal(normalized.observation.title, "User requested: Assistant completed a turn");
  assert.equal(normalized.observation.sourceEventId, normalized.rawEvent.id);
  assert.equal(normalized.observation.provenance.entryId, "entry9");
  assert.ok(normalized.observation.content.length <= 80);
});

test("normalizeTurnEndEvent returns null for trivial or raw-disabled prompt-only turns", () => {
  assert.equal(normalizeTurnEndEvent({ sessionId: "s", turnId: "t", userPrompt: "hi", captureRawPrompts: true }), null);
  assert.equal(normalizeTurnEndEvent({ sessionId: "s", turnId: "t", userPrompt: "thanks", assistantText: "Done", captureRawPrompts: true }), null);
  assert.equal(normalizeTurnEndEvent({ sessionId: "s", turnId: "t", userPrompt: "Investigate src/runtime.ts", captureRawPrompts: false }), null);
});
