import test from "node:test";
import assert from "node:assert/strict";
import { normalizeTurnEndEvent, shouldCapturePrompt } from "../src/capture.js";
import { scrubSecrets, truncateText } from "../src/scrub.js";

test("scrubSecrets redacts obvious tokens and caps content", () => {
  const scrubbed = scrubSecrets(
    "Authorization: Bearer sk-test_abcdefghijklmnopqrstuvwxyz123456 api_key=abc1234567890abcdef password: supersecret12345 keep this tail",
    { maxChars: 90 },
  );

  assert.ok(!scrubbed.includes("sk-test_abcdefghijklmnopqrstuvwxyz123456"));
  assert.ok(!scrubbed.includes("abc1234567890abcdef"));
  assert.ok(!scrubbed.includes("supersecret12345"));
  assert.match(scrubbed, /\[REDACTED_SECRET\]/);
  assert.ok(scrubbed.length <= 130);
  assert.match(scrubbed, /truncated/);
});

test("truncateText is deterministic and reports omitted characters", () => {
  assert.equal(truncateText("abcdef", 4), "abcd…[truncated 2 chars]");
  assert.equal(truncateText("abc", 4), "abc");
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
  assert.ok(!JSON.stringify(normalized).includes("abc123456789abcdef"));
  assert.match(normalized.observation.title, /User requested/);
  assert.equal(normalized.observation.sourceEventId, normalized.rawEvent.id);
  assert.equal(normalized.observation.provenance.entryId, "entry9");
  assert.ok(normalized.observation.content.length <= 140);
});

test("normalizeTurnEndEvent returns null for trivial or raw-disabled prompt-only turns", () => {
  assert.equal(normalizeTurnEndEvent({ sessionId: "s", turnId: "t", userPrompt: "hi", captureRawPrompts: true }), null);
  assert.equal(normalizeTurnEndEvent({ sessionId: "s", turnId: "t", userPrompt: "Investigate src/runtime.ts", captureRawPrompts: false }), null);
});
