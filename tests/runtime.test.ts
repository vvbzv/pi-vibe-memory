import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import { normalizeSettings } from "../src/config.js";
import { VibeMemoryRuntime } from "../src/runtime.js";

function settings(overrides: Record<string, unknown> = {}) {
  return normalizeSettings({
    promptBudgetChars: 5000,
    localObservationLimit: 3,
    hindsightRecallLimit: 2,
    meditation: { minObservations: 1, minIntervalMinutes: 1, timeoutMs: 50, maxCandidates: 3 },
    instincts: { minEvidence: 1, maxPromptItems: 2 },
    ...overrides,
  });
}


async function tempContinuousLearningDir(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "vibe-runtime-import-"));
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(value), "utf8");
}

class FakeRepository {
  rawEvents: any[] = [];
  observations: any[] = [];
  artifactReferences: any[] = [];
  syncJobs: any[] = [];
  candidates: any[] = [];
  meditationRuns: any[] = [];
  revisions: any[] = [];
  promptObservations: any[] = [];
  searchResults: any[] = [];
  promptInstincts: any[] = [];
  promptArtifacts: any[] = [];
  pendingJobs: any[] = [];

  appendRawEvent(input: any) { this.rawEvents.push(input); }
  addObservation(input: any) { this.observations.push(input); }
  upsertArtifactReference(input: any) { this.artifactReferences.push(input); }
  enqueueSyncJob(input: any) { this.syncJobs.push(input); }
  listPromptObservations() { return this.promptObservations; }
  searchObservations() { return this.searchResults; }
  listPromptInstincts() { return this.promptInstincts; }
  listArtifactReferences() { return this.promptArtifacts; }
  listPendingSyncJobs() { return this.pendingJobs; }
  markSyncJobDone(id: string) { this.pendingJobs = this.pendingJobs.filter((job) => job.id !== id); }
  markSyncJobFailed(id: string, error: string) { const job = this.pendingJobs.find((item) => item.id === id); if (job) job.lastError = error; }
  getObservation(id: string) { return this.observations.find((item) => item.id === id) ?? this.promptObservations.find((item) => item.id === id); }
  listMemoryRevisions() { return this.revisions; }
  recordMemoryRevision(input: any) { this.revisions.push(input); }
  addInstinctCandidate(input: any) { this.candidates.push(input); }
  setObservationStatus(id: string, status: string) { const item = this.observations.find((obs) => obs.id === id) ?? this.promptObservations.find((obs) => obs.id === id); if (item) item.status = status; }
  setInstinctCandidateStatus(id: string, status: string) { const item = this.candidates.find((candidate) => candidate.id === id) ?? this.promptInstincts.find((candidate) => candidate.id === id); if (item) item.status = status; }
  listReviewObservations() { return this.observations.filter((item) => item.status === "needs_review").concat(this.promptObservations.filter((item) => item.status === "needs_review")); }
  startMeditationRun(input: any) { this.meditationRuns.push(input); }
  finishMeditationRun(input: any) { this.meditationRuns.push({ finish: input }); }
}

test("beforeAgentStart appends one untrusted memory block from local and Hindsight recall", async () => {
  const repository = new FakeRepository();
  repository.promptObservations = [{ id: "obs1", content: "Local decision", confidence: 0.8, trust: 0.9, status: "active" }];
  repository.searchResults = [{ id: "obs2", content: "Search hit", confidence: 0.7, trust: 0.8, status: "active" }];
  repository.promptInstincts = [{ id: "inst1", content: "When testing, run npm test", confidence: 0.8, status: "working", evidenceObservationIds: ["obs1"] }];
  repository.promptArtifacts = [{ id: "art1", path: "src/runtime.ts", artifactType: "code_reference", content: "Runtime file" }];
  const hindsightCalls: any[] = [];
  const hindsight = {
    recall: async (bank: string, query: string, options: any) => {
      hindsightCalls.push({ bank, query, options });
      return { memories: [{ id: "hs1", content: "Hindsight memory", bank, tags: ["decision"] }] };
    },
  };

  const runtime = new VibeMemoryRuntime({ settings: settings(), repository, hindsight, workspaceId: "ws1", sessionId: "s1", workspaceRoot: "/repo" });
  const result = await runtime.beforeAgentStart({ prompt: "runtime hooks", systemPrompt: "system" });

  assert.equal(result.prompt, "runtime hooks");
  assert.match(result.systemPrompt, /^system\n\n<pi_vibe_memory trust="untrusted">/);
  assert.match(result.systemPrompt, /Local decision/);
  assert.match(result.systemPrompt, /Search hit/);
  assert.match(result.systemPrompt, /Runtime file/);
  assert.match(result.systemPrompt, /Hindsight memory/);
  assert.equal(hindsightCalls.length, 2);
  assert.equal(hindsightCalls[0].bank, "pi");
  assert.deepEqual(hindsightCalls[0].options.tags, ["pi-vibe-memory"]);
  assert.equal(hindsightCalls[0].options.limit, 1);
  assert.equal(hindsightCalls[1].bank, "pi");
  assert.equal(hindsightCalls[1].options.tags, undefined);
  assert.equal(hindsightCalls[1].options.limit, 1);
});

test("beforeAgentStart honors vibeOnly recall scope with tagged Hindsight recall", async () => {
  const calls: any[] = [];
  const runtime = new VibeMemoryRuntime({
    settings: settings({ hindsightRecallLimit: 4, hindsight: { recallScope: "vibeOnly" } }),
    repository: new FakeRepository(),
    hindsight: {
      recall: async (_bank: string, _query: string, options: any) => {
        calls.push(options);
        return { memories: [{ id: "hs1", content: "Tagged memory", tags: options.tags }] };
      },
    },
    workspaceId: "ws1",
    sessionId: "s1",
  });

  const recalled = await runtime.recall({ query: "KISS" }) as any[];

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].tags, ["pi-vibe-memory"]);
  assert.equal(calls[0].limit, 4);
  assert.equal(recalled.length, 1);
});

test("beforeAgentStart honors bankWide recall scope without tags", async () => {
  const calls: any[] = [];
  const runtime = new VibeMemoryRuntime({
    settings: settings({ hindsightRecallLimit: 4, hindsight: { recallScope: "bankWide" } }),
    repository: new FakeRepository(),
    hindsight: {
      recall: async (_bank: string, _query: string, options: any) => {
        calls.push(options);
        return { memories: [{ id: "hs1", content: "Bank memory", tags: options.tags }] };
      },
    },
    workspaceId: "ws1",
    sessionId: "s1",
  });

  const recalled = await runtime.recall({ query: "KISS" }) as any[];

  assert.equal(calls.length, 1);
  assert.equal(calls[0].tags, undefined);
  assert.equal(calls[0].limit, 4);
  assert.equal(recalled.length, 1);
});

test("beforeAgentStart returns original prompt when injection is passive, toolsOnly, disabled, or empty", async () => {
  for (const mode of ["passive", "toolsOnly"] as const) {
    const runtime = new VibeMemoryRuntime({ settings: settings({ mode }), repository: new FakeRepository(), workspaceId: "ws1", sessionId: "s1" });
    assert.deepEqual(await runtime.beforeAgentStart({ prompt: "p", systemPrompt: "s" }), { prompt: "p", systemPrompt: "s" });
  }

  const disabled = new VibeMemoryRuntime({ settings: settings({ enabled: false }), repository: new FakeRepository(), workspaceId: "ws1", sessionId: "s1" });
  assert.deepEqual(await disabled.beforeAgentStart({ prompt: "p", systemPrompt: "s" }), { prompt: "p", systemPrompt: "s" });

  const empty = new VibeMemoryRuntime({ settings: settings(), repository: new FakeRepository(), workspaceId: "ws1", sessionId: "s1" });
  assert.deepEqual(await empty.beforeAgentStart({ prompt: "p", systemPrompt: "s" }), { prompt: "p", systemPrompt: "s" });
});

test("beforeAgentStart hybrid recall prefers tagged vibe memories and adds one bank-wide memory", async () => {
  const repository = new FakeRepository();
  const calls: any[] = [];
  const runtime = new VibeMemoryRuntime({
    settings: settings({ localObservationLimit: 1, hindsightRecallLimit: 4, hindsight: { recallScope: "hybrid", bankWideLimit: 1 } }),
    repository,
    hindsight: {
      recall: async (_bank: string, _query: string, options: any) => {
        calls.push(options);
        return { memories: [{ id: `hs${calls.length}`, content: `memory ${calls.length}`, tags: options.tags ?? ["general"] }] };
      },
    },
    workspaceId: "ws1",
    sessionId: "s1",
  });

  const recalled = await runtime.recall({ query: "KISS" }) as any[];

  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].tags, ["pi-vibe-memory"]);
  assert.equal(calls[0].limit, 3);
  assert.equal(calls[1].tags, undefined);
  assert.equal(calls[1].limit, 1);
  assert.equal(recalled.length, 2);
});

test("beforeAgentStart degrades to local memory when Hindsight recall fails", async () => {
  const repository = new FakeRepository();
  repository.promptObservations = [{ id: "obs1", content: "Local survives outage", status: "active" }];
  const runtime = new VibeMemoryRuntime({
    settings: settings(),
    repository,
    hindsight: { recall: async () => { throw new Error("offline"); } },
    workspaceId: "ws1",
    sessionId: "s1",
  });

  const result = await runtime.beforeAgentStart({ prompt: "anything", systemPrompt: "system" });

  assert.match(result.systemPrompt, /Local survives outage/);
  assert.doesNotMatch(result.systemPrompt, /offline/);
});

test("captureTurnEnd stores deterministic raw event, observation, artifact refs, and sync job without LLM calls", async () => {
  const repository = new FakeRepository();
  let reflected = false;
  const runtime = new VibeMemoryRuntime({
    settings: settings({ captureRawPrompts: true, meditation: { mode: "off" } }),
    repository,
    hindsight: { reflect: async () => { reflected = true; return {}; } },
    workspaceId: "ws1",
    sessionId: "s1",
    workspaceRoot: "/repo",
  });

  const captured = await runtime.captureTurnEnd({ turnId: "t1", entryId: "e1", userPrompt: "Edit src/runtime.ts:12", assistantText: "Updated tests/runtime.test.ts", cwd: "/repo" });

  assert.equal(captured, true);
  assert.equal(reflected, false);
  assert.equal(repository.rawEvents.length, 1);
  assert.equal(repository.observations.length, 1);
  assert.equal(repository.observations[0].workspaceId, "ws1");
  assert.equal(repository.observations[0].sessionId, "s1");
  assert.deepEqual(repository.observations[0].sourceEventIds, [repository.rawEvents[0].id]);
  assert.deepEqual(repository.artifactReferences.map((ref) => ref.path).sort(), ["src/runtime.ts", "tests/runtime.test.ts"]);
  assert.equal(repository.syncJobs.length, 1);
});

test("captureTurnEnd drops trivial turns", async () => {
  const repository = new FakeRepository();
  const runtime = new VibeMemoryRuntime({ settings: settings(), repository, workspaceId: "ws1", sessionId: "s1" });

  assert.equal(await runtime.captureTurnEnd({ turnId: "t1", userPrompt: "thanks" }), false);
  assert.equal(repository.rawEvents.length, 0);
  assert.equal(repository.observations.length, 0);
});

test("maybeScheduleMeditation is detached and runMeditation stores parsed candidates with in-flight guard", async () => {
  const repository = new FakeRepository();
  repository.promptObservations = [{ id: "obs1", title: "T", kind: "turn_summary", content: "Repeated TDD evidence", status: "active" }];
  let reflectCalls = 0;
  const runtime = new VibeMemoryRuntime({
    settings: settings(),
    repository,
    hindsight: {
      reflect: async () => {
        reflectCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { content: JSON.stringify({ candidates: [{ kind: "instinct_candidate", trigger: "When adding runtime", action: "Write tests first", evidenceObservationIds: ["obs1"], confidence: 0.8 }] }) };
      },
    },
    workspaceId: "ws1",
    sessionId: "s1",
  });

  const scheduled = runtime.maybeScheduleMeditation({ unsummarizedObservationCount: 1, now: new Date("2026-05-17T10:00:00Z") });
  assert.equal(scheduled, true);
  assert.equal(runtime.maybeScheduleMeditation({ unsummarizedObservationCount: 1, now: new Date("2026-05-17T10:00:00Z") }), false);

  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(reflectCalls, 1);
  assert.equal(repository.candidates.length, 1);
  assert.equal(repository.candidates[0].content, "When adding runtime\nWrite tests first");

  const manual = await runtime.runMeditation({ trigger: "manual", force: true });
  assert.equal(manual.status, "completed");
  assert.ok(manual.candidates >= 1);
});

test("runtime tool methods are thin, explicit, and non-destructive", async () => {
  const repository = new FakeRepository();
  repository.promptObservations = [{ id: "old", content: "Old memory", status: "active" }];
  repository.searchResults = [{ id: "hit", content: "Search result", status: "active" }];
  const runtime = new VibeMemoryRuntime({ settings: settings(), repository, workspaceId: "ws1", sessionId: "s1" });

  assert.equal((await runtime.status({ disableInjection: true })).injectionDisabled, true);
  assert.deepEqual(await runtime.recall({ query: "Search" }), repository.searchResults);

  const remembered = await runtime.remember({ content: "Remember this", explicit: true });
  assert.equal(remembered.status, "stored");
  const rememberedObservation = repository.observations.at(-1)! as any;
  assert.equal(rememberedObservation.content, "Remember this");

  const explained = await runtime.explain({ id: rememberedObservation.id }) as any;
  assert.equal(explained.observation?.content, "Remember this");
  assert.equal((await runtime.reviewInstincts()).length, 0);
  assert.equal((await runtime.import({ source: "lapis", dryRun: true })).dryRun, true);
  const compared = await runtime.compare({ oldId: "old", newId: rememberedObservation.id }) as any;
  assert.equal(compared.old?.id, "old");

  const revised = await runtime.revise({ oldId: "old", newContent: "New memory", reason: "new evidence", explicit: true });
  assert.equal(revised.status, "revised");
  assert.equal(repository.revisions[0].oldObservationId, "old");
  assert.equal(repository.revisions[0].relation, "supersedes");
});



test("continuous-learning import previews directory records and apply requires explicit confirmation", async () => {
  const root = await tempContinuousLearningDir();
  await writeJsonFile(path.join(root, "facts.json"), [
    { id: "fact-1", content: "Use local Hindsight in tests.", kind: "environment_fact" },
  ]);
  await writeJsonFile(path.join(root, "instincts.json"), [
    { id: "instinct-1", trigger: "When importing", action: "Preview first.", durableApproved: true },
  ]);
  const repository = new FakeRepository();
  const runtime = new VibeMemoryRuntime({ settings: settings(), repository, workspaceId: "ws1", sessionId: "s1" });

  const preview = await runtime.import({ source: "continuous-learning", path: root }) as any;

  assert.equal(preview.status, "preview");
  assert.equal(preview.dryRun, true);
  assert.equal(preview.count, 2);
  assert.deepEqual(preview.warnings, []);
  assert.equal(repository.observations.length, 0);
  assert.equal(repository.candidates.length, 0);
  assert.equal(preview.items.find((item: any) => item.legacyId === "fact-1").kind, "environment_fact");

  const blocked = await runtime.import({ source: "continuous-learning", path: root, dryRun: false }) as any;
  assert.equal(blocked.status, "confirmation-needed");
  assert.equal(repository.observations.length, 0);
  assert.equal(repository.candidates.length, 0);

  const applied = await runtime.import({ source: "continuous-learning", path: root, dryRun: false, explicit: true }) as any;
  assert.equal(applied.status, "imported");
  assert.equal(applied.count, 2);
  assert.equal(repository.observations.length, 1);
  assert.equal(repository.observations[0].kind, "environment_fact");
  assert.match(repository.observations[0].content, /Legacy source: pi-continuous-learning/);
  assert.equal(repository.candidates.length, 1);
  assert.equal(repository.candidates[0].durableApproved, true);
  assert.equal(repository.candidates[0].status, "working");
});

test("continuous-learning import uses supplied records without directory scanning", async () => {
  const repository = new FakeRepository();
  const runtime = new VibeMemoryRuntime({ settings: settings(), repository, workspaceId: "ws1", sessionId: "s1" });

  const preview = await runtime.import({
    source: "continuous-learning",
    records: [{ id: "record-fact", content: "Supplied record only." }],
  }) as any;

  assert.equal(preview.status, "preview");
  assert.equal(preview.count, 1);
  assert.equal(preview.items[0].legacyId, "record-fact");
});

test("remember validates typed durable memory fields and recall forwards typed filters", async () => {
  const repository = new FakeRepository();
  let searchOptions: any;
  repository.searchObservations = (_query?: string, options?: any) => {
    searchOptions = options;
    return repository.searchResults;
  };
  const runtime = new VibeMemoryRuntime({ settings: settings(), repository, workspaceId: "ws1", sessionId: "s1" });

  await assert.rejects(
    () => runtime.remember({ content: "Nope", kind: "random_kind", explicit: true }),
    /kind/,
  );

  const result = await runtime.remember({
    content: "User prefers KISS changes.",
    kind: "user_preference",
    scope: "project",
    tags: ["style", "style", "kiss"],
    explicit: true,
  });

  assert.equal(result.status, "stored");
  const observation = repository.observations.at(-1)!;
  assert.equal(observation.kind, "user_preference");
  assert.equal(observation.scope, "project");
  assert.deepEqual(observation.tags, ["explicit", "style", "kiss"]);
  assert.equal(observation.status, "active");

  await runtime.recall({ query: "KISS", kind: "user_preference", status: "active", includeHistorical: true });
  assert.equal(searchOptions.kind, "user_preference");
  assert.equal(searchOptions.status, "active");
  assert.equal(searchOptions.includeHistorical, true);
});

test("review lists candidates and applies non-destructive actions", async () => {
  const repository = new FakeRepository();
  repository.promptObservations = [{ id: "obs-review", kind: "project_fact", content: "Needs review", status: "needs_review" }];
  repository.promptInstincts = [{ id: "inst-review", kind: "behavior_instinct", content: "Write tests first", status: "needs_review" }];
  const runtime = new VibeMemoryRuntime({ settings: settings(), repository, workspaceId: "ws1", sessionId: "s1" });

  const listed = await runtime.review({ action: "list" }) as any;
  assert.deepEqual(listed.items.map((item: any) => item.id).sort(), ["inst-review", "obs-review"]);

  const approved = await runtime.review({ action: "approve_active", id: "obs-review" }) as any;
  assert.equal(approved.status, "active");
  assert.equal(repository.promptObservations[0].status, "active");

  const deferred = await runtime.review({ action: "defer", id: "inst-review" }) as any;
  assert.equal(deferred.status, "needs_review");
  assert.equal(repository.promptInstincts[0].status, "needs_review");

  await assert.rejects(
    () => runtime.review({ action: "delete", id: "obs-review" }),
    /action/,
  );
});


test("beforeCompact returns owner compaction without calling Hindsight", async () => {
  const repository = new FakeRepository();
  repository.promptObservations = [
    { id: "fact1", kind: "project_fact", content: "One memory extension", status: "active" },
    { id: "dec1", kind: "project_decision", content: "Replace observational-memory", status: "active" },
  ];
  repository.promptInstincts = [{ id: "inst1", content: "Write tests first", status: "working", confidence: 0.8 }];
  repository.promptArtifacts = [{ id: "art1", path: "src/runtime.ts", artifactType: "code_reference" }];
  repository.revisions = [{ id: "rev1", oldObservationId: "old", newObservationId: "fact1", relation: "supersedes", reason: "New owner mode evidence" }];
  repository.pendingJobs = [{ id: "sync1" }];
  let recallCalled = false;

  const runtime = new VibeMemoryRuntime({
    settings: settings({ compaction: { mode: "owner", maxSummaryChars: 2000 } }),
    repository,
    hindsight: { recall: async () => { recallCalled = true; return {}; } },
    workspaceId: "ws1",
    sessionId: "s1",
  });

  const result = await runtime.beforeCompact({
    preparation: {
      previousSummary: "## Goal\nBuild memory",
      firstKeptEntryId: "entry-10",
      tokensBefore: 12345,
      fileOps: { readFiles: ["src/runtime.ts"], modifiedFiles: [] },
    },
    branchEntries: [],
  } as any);

  assert.equal(recallCalled, false);
  assert.equal(result?.compaction.firstKeptEntryId, "entry-10");
  assert.equal(result?.compaction.tokensBefore, 12345);
  assert.equal(result?.compaction.details.type, "pi-vibe-memory");
  assert.equal(result?.compaction.details.version, 1);
  assert.equal(result?.compaction.details.mode, "owner");
  assert.equal(result?.compaction.details.source, "sqlite-local");
  assert.equal(result?.compaction.details.summaryChars, result?.compaction.summary.length);
  assert.match(result?.compaction.summary ?? "", /Pi Vibe Memory Continuity/);
  assert.match(result?.compaction.summary ?? "", /One memory extension/);
  assert.match(result?.compaction.summary ?? "", /Write tests first/);
});

test("beforeCompact skips disabled, observe mode, and competing compaction owner", async () => {
  const repository = new FakeRepository();
  repository.promptObservations = [{ id: "fact1", kind: "project_fact", content: "One memory extension", status: "active" }];

  for (const overrides of [
    { enabled: false },
    { compaction: { enabled: false } },
    { compaction: { mode: "off" } },
    { compaction: { mode: "observe" } },
  ]) {
    const runtime = new VibeMemoryRuntime({ settings: settings(overrides), repository, workspaceId: "ws1", sessionId: "s1" });
    assert.equal(await runtime.beforeCompact({ preparation: { firstKeptEntryId: "entry", tokensBefore: 1 }, branchEntries: [] } as any), undefined);
  }

  const runtime = new VibeMemoryRuntime({ settings: settings({ compaction: { mode: "owner" } }), repository, workspaceId: "ws1", sessionId: "s1" });
  const result = await runtime.beforeCompact({
    preparation: { firstKeptEntryId: "entry", tokensBefore: 1 },
    branchEntries: [{ type: "compaction", details: { type: "observational-memory" } }],
  } as any);
  assert.equal(result, undefined);
});
