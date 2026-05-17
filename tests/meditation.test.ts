import test from "node:test";
import assert from "node:assert/strict";
import {
  buildMeditationPrompt,
  parseMeditationCandidates,
  shouldScheduleMeditation,
} from "../src/meditation.js";
import { DEFAULT_SETTINGS, type NormalizedVibeMemorySettings } from "../src/config.js";

function settingsWith(overrides: Partial<NormalizedVibeMemorySettings["meditation"]>): NormalizedVibeMemorySettings {
  return {
    ...DEFAULT_SETTINGS,
    meditation: {
      ...DEFAULT_SETTINGS.meditation,
      ...overrides,
    },
  };
}

test("shouldScheduleMeditation respects passive same-session thresholds", () => {
  const now = new Date("2026-05-17T12:30:00.000Z");

  assert.equal(
    shouldScheduleMeditation({
      settings: DEFAULT_SETTINGS,
      unsummarizedObservationCount: 12,
      lastRunAt: null,
      now,
    }),
    true,
  );

  assert.equal(
    shouldScheduleMeditation({
      settings: DEFAULT_SETTINGS,
      unsummarizedObservationCount: 2,
      lastRunAt: null,
      now,
    }),
    false,
  );

  assert.equal(
    shouldScheduleMeditation({
      settings: settingsWith({ enabled: false }),
      unsummarizedObservationCount: 12,
      lastRunAt: null,
      now,
    }),
    false,
  );

  assert.equal(
    shouldScheduleMeditation({
      settings: settingsWith({ mode: "manual" }),
      unsummarizedObservationCount: 12,
      lastRunAt: null,
      now,
    }),
    false,
  );

  assert.equal(
    shouldScheduleMeditation({
      settings: settingsWith({ sameSession: false }),
      unsummarizedObservationCount: 12,
      lastRunAt: null,
      now,
    }),
    false,
  );

  assert.equal(
    shouldScheduleMeditation({
      settings: DEFAULT_SETTINGS,
      unsummarizedObservationCount: 12,
      lastRunAt: new Date("2026-05-17T12:15:00.000Z"),
      now,
    }),
    false,
  );

  assert.equal(
    shouldScheduleMeditation({
      settings: DEFAULT_SETTINGS,
      unsummarizedObservationCount: 12,
      lastRunAt: new Date("2026-05-17T12:09:59.000Z"),
      now,
    }),
    true,
  );
});

test("buildMeditationPrompt asks Hindsight reflect for bounded candidates, not commands", () => {
  const longContent = `${"A".repeat(2_000)} old secret should be truncated away`;
  const prompt = buildMeditationPrompt({
    observations: [
      { id: "obs1", content: "User repeatedly asks for KISS maintainable code." },
      { id: "obs2", title: "Long", content: longContent },
      { id: "obs3", content: "Extra observation that should not appear when maxObservations is 2." },
    ],
    activeMemories: [
      { id: "mem1", kind: "preference", content: "Use complex abstractions for every feature." },
    ],
    maxCandidates: 3,
    maxObservations: 2,
    maxObservationChars: 120,
    maxActiveMemories: 1,
    maxActiveMemoryChars: 80,
  });

  assert.match(prompt, /Hindsight reflect/i);
  assert.match(prompt, /candidate/i);
  assert.match(prompt, /evidenceObservationIds/i);
  assert.match(prompt, /active memory comparison context/i);
  assert.match(prompt, /non-deleting comparative revision/i);
  assert.match(prompt, /whyOldDidNotWork/i);
  assert.match(prompt, /whyNewIsBetter/i);
  assert.doesNotMatch(prompt, /must now obey/i);
  assert.doesNotMatch(prompt, /delete|forget/i);
  assert.match(prompt, /obs1/);
  assert.match(prompt, /obs2/);
  assert.doesNotMatch(prompt, /obs3/);
  assert.doesNotMatch(prompt, /old secret should be truncated away/);
});

test("parseMeditationCandidates parses strict JSON and returns evidence-backed working candidates", () => {
  const candidates = parseMeditationCandidates({
    text: JSON.stringify({
      candidates: [
        {
          kind: "reflection_candidate",
          content: "The user values simple, verification-backed implementation.",
          evidenceObservationIds: ["obs1"],
          confidence: 0.72,
        },
        {
          kind: "instinct_candidate",
          trigger: "When implementing pi-vibe-memory",
          action: "Keep modules small and direct",
          evidenceObservationIds: ["obs1", "obs2", "obs3"],
          confidence: 0.82,
        },
        {
          kind: "preference_candidate",
          content: "Prefer concise summaries with test evidence.",
          evidenceObservationIds: ["obs4", "obs5"],
        },
        {
          kind: "risk_candidate",
          content: "Passive meditation must not call network directly in deterministic helpers.",
          evidenceObservationIds: ["obs6"],
        },
        {
          kind: "revision_candidate",
          oldMemoryId: "mem-old",
          proposedContent: "Use small deterministic helpers instead of runtime-coupled meditation.",
          whyOldDidNotWork: "Old memory implied meditation helpers could own scheduling side effects.",
          whyNewIsBetter: "New evidence requires candidate-only deterministic helpers.",
          evidenceObservationIds: ["obs7", "obs8"],
        },
        {
          kind: "instinct_candidate",
          trigger: "Weak",
          action: "Ignore",
          evidenceObservationIds: ["obs9"],
          confidence: 0.4,
        },
      ],
    }),
    minEvidence: 3,
  });

  assert.equal(candidates.length, 5);
  assert.deepEqual(candidates.map((candidate) => candidate.kind), [
    "reflection_candidate",
    "instinct_candidate",
    "preference_candidate",
    "risk_candidate",
    "revision_candidate",
  ]);
  for (const candidate of candidates) {
    assert.equal(candidate.status, "working");
    assert.equal(candidate.durableApproved, false);
    assert.ok(candidate.evidenceObservationIds.length > 0);
  }
});

test("parseMeditationCandidates rejects non-json wrappers and invalid revision candidates", () => {
  assert.throws(
    () => parseMeditationCandidates({ text: `Here is JSON: ${JSON.stringify({ candidates: [] })}`, minEvidence: 1 }),
    /strict JSON/i,
  );

  const candidates = parseMeditationCandidates({
    text: JSON.stringify({
      candidates: [
        {
          kind: "revision_candidate",
          oldMemoryId: "mem-old",
          proposedContent: "New content",
          whyNewIsBetter: "It matches newer evidence.",
          evidenceObservationIds: ["obs1"],
        },
        {
          kind: "revision_candidate",
          oldMemoryId: "mem-old-2",
          content: "Fallback content field is accepted.",
          whyOldDidNotWork: "Old memory was too broad.",
          whyNewIsBetter: "New memory is more precise.",
          evidenceObservationIds: ["obs2"],
        },
      ],
    }),
    minEvidence: 1,
  });

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]?.kind, "revision_candidate");
  assert.equal(candidates[0]?.content, "Fallback content field is accepted.");
});
