import test from "node:test";
import assert from "node:assert/strict";
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
