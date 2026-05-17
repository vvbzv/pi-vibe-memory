import { createHash } from "node:crypto";
import { extractArtifactReferences } from "./codeReferences.js";
import { buildCompactionSummary, shouldSkipCustomCompaction } from "./compaction.js";
import { mapContinuousLearningFact, mapContinuousLearningInstinct } from "./importers/continuousLearning.js";
import { mapLapisArtifact } from "./importers/lapis.js";
import { mapObservationalMemoryRecord } from "./importers/observationalMemory.js";
import type { NormalizedVibeMemorySettings } from "./config.js";
import { runDoctorChecks } from "./doctor.js";
import { normalizeBankId } from "./hindsight/banks.js";
import { enqueueObservationSync, flushSyncQueue } from "./hindsight/sync.js";
import {
  buildMeditationPrompt,
  parseMeditationCandidates,
  shouldScheduleMeditation,
} from "./meditation.js";
import { renderMemoryBlock, type PromptHindsightMemory } from "./prompt.js";
import { scrubSecrets, truncateText } from "./scrub.js";
import { normalizeTurnEndEvent } from "./capture.js";
import type {
  ArtifactReferenceInput,
  InstinctCandidateInput,
  ObservationInput,
  ObservationRecord,
  RawEventInput,
} from "./storage/repository.js";

export interface RuntimeRepository {
  appendRawEvent(input: RawEventInput): void;
  addObservation(input: ObservationInput): void;
  upsertArtifactReference?(input: ArtifactReferenceInput): void;
  enqueueSyncJob?(input: { id: string; observationId?: string; operation: string; payload: unknown }): void;
  listPromptObservations?(options: { workspaceId: string; limit?: number }): ObservationRecord[];
  searchObservations?(query: string, options: { workspaceId: string; limit?: number; includeInactive?: boolean }): ObservationRecord[];
  listPromptInstincts?(options: { workspaceId: string; limit?: number }): unknown[];
  listArtifactReferences?(options: { workspaceId: string; limit?: number }): unknown[];
  listPendingSyncJobs?(limit?: number): unknown[];
  markSyncJobDone?(id: string): void;
  markSyncJobFailed?(id: string, error: string): void;
  getObservation?(id: string): ObservationRecord | undefined;
  listMemoryRevisions?(observationId: string): unknown[];
  recordMemoryRevision?(input: { id: string; oldObservationId: string; newObservationId: string; relation: string; reason: string }): void;
  addInstinctCandidate?(input: InstinctCandidateInput): void;
  startMeditationRun?(input: { id: string; workspaceId: string; sessionId?: string; trigger: string; status: string; inputObservationIds?: string[] }): void;
  finishMeditationRun?(input: { id: string; status: string; error?: string }): void;
}

export interface RuntimeHindsight {
  recall?(bankId: string, query: string, options?: Record<string, unknown>): Promise<unknown>;
  reflect?(bankId: string, query: string, options?: Record<string, unknown>): Promise<unknown>;
  retainBatch?(bankId: string, items: any[], options?: Record<string, unknown>): Promise<unknown>;
  health?(): Promise<unknown>;
}

export interface VibeMemoryRuntimeOptions {
  settings: NormalizedVibeMemorySettings;
  repository: RuntimeRepository;
  hindsight?: RuntimeHindsight;
  workspaceId: string;
  sessionId: string;
  workspaceRoot?: string;
  conflicts?: string[];
  now?: () => Date;
}

export interface BeforeAgentStartInput {
  prompt: string;
  systemPrompt: string;
}

export interface CaptureTurnEndInput {
  turnId: string;
  entryId?: string;
  parentEntryId?: string;
  cwd?: string;
  userPrompt?: string;
  assistantText?: string;
}

export interface BeforeCompactInput {
  preparation?: {
    previousSummary?: string;
    firstKeptEntryId?: string;
    tokensBefore?: number;
    fileOps?: { readFiles?: string[]; modifiedFiles?: string[] };
  };
  branchEntries?: unknown[];
}

export interface BeforeCompactResult {
  compaction: {
    summary: string;
    firstKeptEntryId?: string;
    tokensBefore?: number;
    details: {
      type: "pi-vibe-memory";
      version: 1;
      mode: "owner";
      source: "sqlite-local";
      summaryChars: number;
    };
  };
}

type JsonRecord = Record<string, unknown>;

type MeditationResult = {
  status: "disabled" | "skipped" | "running" | "completed" | "failed";
  candidates: number;
  error?: string;
};

export class VibeMemoryRuntime {
  readonly settings: NormalizedVibeMemorySettings;
  readonly repository: RuntimeRepository;
  readonly hindsight?: RuntimeHindsight;
  readonly workspaceId: string;
  readonly sessionId: string;
  readonly workspaceRoot: string;
  readonly conflicts: string[];

  private injectionDisabled = false;
  private meditationInFlight = false;
  private lastMeditationRunAt?: Date;
  private capturedObservationCount = 0;
  private lastMeditationError?: string;
  private readonly now: () => Date;

  constructor(options: VibeMemoryRuntimeOptions) {
    this.settings = options.settings;
    this.repository = options.repository;
    this.hindsight = options.hindsight;
    this.workspaceId = options.workspaceId;
    this.sessionId = options.sessionId;
    this.workspaceRoot = options.workspaceRoot ?? process.cwd();
    this.conflicts = options.conflicts ?? [];
    this.now = options.now ?? (() => new Date());
  }

  async beforeAgentStart(input: BeforeAgentStartInput): Promise<BeforeAgentStartInput> {
    if (!this.settings.enabled || this.injectionDisabled || this.settings.mode === "passive" || this.settings.mode === "toolsOnly") return input;

    const local = this.localMemories(input.prompt);
    const workspace = await this.recallHindsight(input.prompt);
    const block = renderMemoryBlock({
      budgetChars: this.settings.promptBudgetChars,
      instincts: this.listPromptInstincts(),
      codeReferences: this.listArtifactReferences(),
      local,
      workspace,
      revisions: this.listRevisionNotes(local),
    });

    if (!block) return input;
    return { ...input, systemPrompt: `${input.systemPrompt}\n\n${block}` };
  }

  async beforeCompact(event: BeforeCompactInput): Promise<BeforeCompactResult | undefined> {
    if (!this.settings.enabled || !this.settings.compaction.enabled || this.settings.compaction.mode !== "owner") return undefined;
    if (shouldSkipCustomCompaction(event.branchEntries ?? [])) return undefined;

    try {
      const observations = this.repository.listPromptObservations?.({ workspaceId: this.workspaceId, limit: this.settings.compaction.maxObservations }) ?? [];
      const decisions = observations
        .filter((item) => item.kind === "project_decision" || item.kind === "decision")
        .slice(0, this.settings.compaction.maxFacts);
      const activeFacts = observations
        .filter((item) => !decisions.some((decision) => decision.id === item.id))
        .slice(0, this.settings.compaction.maxFacts);
      const instincts = (this.repository.listPromptInstincts?.({ workspaceId: this.workspaceId, limit: this.settings.compaction.maxInstincts }) ?? [])
        .slice(0, this.settings.compaction.maxInstincts) as any[];
      const artifacts = (this.repository.listArtifactReferences?.({ workspaceId: this.workspaceId, limit: this.settings.compaction.maxArtifacts }) ?? [])
        .slice(0, this.settings.compaction.maxArtifacts) as any[];
      const revisions = this.compactionRevisionNotes(observations).slice(0, this.settings.compaction.maxRevisions);
      const pendingSyncJobs = this.repository.listPendingSyncJobs?.(this.settings.sync.maxBatchItems).length ?? 0;

      const summary = buildCompactionSummary({
        maxSummaryChars: this.settings.compaction.maxSummaryChars,
        previousSummary: event.preparation?.previousSummary,
        includePreviousSummary: this.settings.compaction.includePreviousSummary,
        activeFacts,
        decisions,
        instincts,
        revisions,
        artifacts,
        fileOps: this.settings.compaction.includeFileOps ? event.preparation?.fileOps : undefined,
        syncStatus: `${pendingSyncJobs} pending sync job${pendingSyncJobs === 1 ? "" : "s"}`,
      });
      if (!summary) return undefined;

      return {
        compaction: {
          summary,
          firstKeptEntryId: event.preparation?.firstKeptEntryId,
          tokensBefore: event.preparation?.tokensBefore,
          details: {
            type: "pi-vibe-memory",
            version: 1,
            mode: "owner",
            source: "sqlite-local",
            summaryChars: summary.length,
          },
        },
      };
    } catch (error) {
      if (this.settings.compaction.failOpen) return undefined;
      throw error;
    }
  }

  async captureTurnEnd(input: CaptureTurnEndInput): Promise<boolean> {
    if (!this.settings.enabled || this.settings.mode === "toolsOnly") return false;

    const normalized = normalizeTurnEndEvent({
      sessionId: this.sessionId,
      turnId: input.turnId,
      entryId: input.entryId,
      parentEntryId: input.parentEntryId,
      cwd: input.cwd,
      userPrompt: input.userPrompt,
      assistantText: input.assistantText,
      captureRawPrompts: this.settings.captureRawPrompts,
    });
    if (!normalized) return false;

    this.repository.appendRawEvent({
      id: normalized.rawEvent.id,
      sessionId: this.sessionId,
      entryId: normalized.rawEvent.entryId,
      parentEntryId: normalized.rawEvent.parentEntryId,
      kind: normalized.rawEvent.kind,
      content: normalized.rawEvent,
      scrubbed: true,
    });

    const observation: ObservationInput = {
      id: normalized.observation.id,
      workspaceId: this.workspaceId,
      sessionId: this.sessionId,
      kind: normalized.observation.kind,
      scope: "project",
      title: normalized.observation.title,
      content: normalized.observation.content,
      sourceEventIds: [normalized.rawEvent.id],
      tags: ["turn_summary"],
      confidence: 0.55,
      trust: 0.65,
      status: "active",
    };
    this.repository.addObservation(observation);
    this.capturedObservationCount += 1;

    if (this.settings.codeReferences.enabled && this.repository.upsertArtifactReference) {
      const refs = extractArtifactReferences({
        text: [input.userPrompt, input.assistantText].filter(Boolean).join("\n"),
        workspaceRoot: input.cwd ?? this.workspaceRoot,
        sourceEventId: normalized.rawEvent.id,
        allowedExtensions: this.settings.codeReferences.allowedExtensions,
        maxReferences: this.settings.codeReferences.maxPerPrompt,
      });
      for (const ref of refs) {
        this.repository.upsertArtifactReference({
          id: ref.id,
          workspaceId: this.workspaceId,
          sessionId: this.sessionId,
          observationId: observation.id,
          path: ref.path,
          artifactType: ref.artifactType,
          lineStart: ref.lineStart,
          lineEnd: ref.lineEnd,
          sourceEventIds: [ref.sourceEventId],
        });
      }
    }

    this.enqueueObservation(observation);
    this.maybeScheduleMeditation({ unsummarizedObservationCount: this.capturedObservationCount });
    return true;
  }

  maybeScheduleMeditation(input: { unsummarizedObservationCount?: number; lastRunAt?: Date | string | null; now?: Date } = {}): boolean {
    if (this.meditationInFlight) return false;
    const shouldRun = shouldScheduleMeditation({
      settings: this.settings,
      unsummarizedObservationCount: input.unsummarizedObservationCount ?? this.capturedObservationCount,
      lastRunAt: input.lastRunAt ?? this.lastMeditationRunAt,
      now: input.now ?? this.now(),
    });
    if (!shouldRun) return false;

    this.meditationInFlight = true;
    void this.runMeditation({ trigger: "passive", force: true }).catch(() => undefined);
    return true;
  }

  async runMeditation(input: { trigger?: string; force?: boolean } = {}): Promise<MeditationResult> {
    if (!this.settings.meditation.enabled || this.settings.meditation.mode === "off") {
      this.meditationInFlight = false;
      return { status: "disabled", candidates: 0 };
    }
    if (!this.hindsight?.reflect) {
      this.meditationInFlight = false;
      return { status: "skipped", candidates: 0, error: "Hindsight reflect is not configured" };
    }
    if (!input.force && this.meditationInFlight) return { status: "running", candidates: 0 };

    this.meditationInFlight = true;
    const observations = this.repository.listPromptObservations?.({ workspaceId: this.workspaceId, limit: this.settings.meditation.minObservations }) ?? [];
    if (observations.length === 0) {
      this.meditationInFlight = false;
      return { status: "skipped", candidates: 0 };
    }

    const runId = `med_${hash(`${this.sessionId}:${Date.now()}:${input.trigger ?? "manual"}`)}`;
    this.repository.startMeditationRun?.({
      id: runId,
      workspaceId: this.workspaceId,
      sessionId: this.sessionId,
      trigger: input.trigger ?? "manual",
      status: "running",
      inputObservationIds: observations.map((item) => item.id),
    });

    try {
      const prompt = buildMeditationPrompt({
        observations: observations.map((item) => ({ id: item.id, title: item.title, kind: item.kind, content: item.content })),
        maxCandidates: this.settings.meditation.maxCandidates,
      });
      const response = await this.hindsight.reflect(this.bankId(), prompt, {
        budget: this.settings.meditation.budget,
        limit: this.settings.meditation.maxCandidates,
        maxTokens: 1200,
      });
      const text = extractText(response);
      const candidates = text ? parseMeditationCandidates({ text, minEvidence: this.settings.instincts.minEvidence }) : [];
      for (const candidate of candidates) {
        this.repository.addInstinctCandidate?.({
          id: `inst_${hash(`${runId}:${candidate.kind}:${candidate.content ?? ""}`)}`,
          workspaceId: this.workspaceId,
          sessionId: this.sessionId,
          meditationRunId: runId,
          kind: candidate.kind,
          trigger: candidate.trigger,
          action: candidate.action,
          content: candidate.content ?? "",
          evidenceObservationIds: candidate.evidenceObservationIds,
          confidence: candidate.confidence,
          status: candidate.status,
          durableApproved: candidate.durableApproved,
        });
      }
      this.repository.finishMeditationRun?.({ id: runId, status: "completed" });
      this.lastMeditationRunAt = this.now();
      this.lastMeditationError = undefined;
      this.capturedObservationCount = 0;
      return { status: "completed", candidates: candidates.length };
    } catch (error) {
      const message = errorMessage(error);
      this.lastMeditationError = message;
      this.repository.finishMeditationRun?.({ id: runId, status: "failed", error: message });
      return { status: "failed", candidates: 0, error: message };
    } finally {
      this.meditationInFlight = false;
    }
  }

  async status(params: JsonRecord = {}): Promise<JsonRecord> {
    if (params.disableInjection === true) this.injectionDisabled = true;
    return {
      status: this.settings.enabled ? this.settings.mode : "disabled",
      workspaceId: this.workspaceId,
      sessionId: this.sessionId,
      injectionDisabled: this.injectionDisabled,
      conflicts: this.conflicts,
      pendingSyncJobs: this.repository.listPendingSyncJobs?.(this.settings.sync.maxBatchItems).length ?? 0,
      lastMeditationError: this.lastMeditationError,
    };
  }

  async sync(): Promise<JsonRecord> {
    if (!this.hindsight?.retainBatch || !this.repository.listPendingSyncJobs || !this.repository.markSyncJobDone || !this.repository.markSyncJobFailed) {
      return { status: "not-configured", processed: 0, succeeded: 0, failed: 0 };
    }
    const result = await flushSyncQueue({
      repository: this.repository as any,
      hindsight: this.hindsight as any,
      maxBatchItems: this.settings.sync.maxBatchItems,
    });
    return { status: result.failed > 0 ? "partial" : "complete", ...result };
  }

  async doctor(): Promise<ReturnType<typeof runDoctorChecks>> {
    return runDoctorChecks({
      settings: this.settings,
      conflicts: this.conflicts,
      hindsight: this.hindsight ? { status: "ok", message: "Hindsight client configured" } : { status: "offline", message: "Hindsight client not configured; local memory can continue." },
    });
  }

  async recall(params: JsonRecord): Promise<unknown[]> {
    const query = typeof params.query === "string" && params.query.trim() ? params.query.trim() : "recent";
    const limit = numberParam(params.limit, this.settings.localObservationLimit);
    const local = this.repository.searchObservations?.(query, { workspaceId: this.workspaceId, limit, includeInactive: params.includeInactive === true }) ?? [];
    if (!this.hindsight?.recall || this.settings.hindsight.enabled === false) return local;
    try {
      return [...local, ...await this.recallHindsight(query)];
    } catch {
      return local;
    }
  }

  async remember(params: JsonRecord): Promise<JsonRecord> {
    if (params.explicit !== true) return { status: "confirmation-needed" };
    const content = scrubSecrets(requiredString(params.content, "content"), { maxChars: 2000 });
    const observation: ObservationInput = {
      id: `obs_${hash(`${this.sessionId}:remember:${content}`)}`,
      workspaceId: this.workspaceId,
      sessionId: this.sessionId,
      kind: "explicit_memory",
      scope: "project",
      title: truncateText(content.replace(/\s+/g, " "), 100),
      content,
      sourceEventIds: [],
      tags: ["explicit"],
      confidence: 0.75,
      trust: 0.8,
      status: "active",
    };
    this.repository.addObservation(observation);
    this.enqueueObservation(observation);
    return { status: "stored", id: observation.id };
  }

  async explain(params: JsonRecord): Promise<JsonRecord> {
    const id = requiredString(params.id, "id");
    return {
      observation: this.repository.getObservation?.(id),
      revisions: this.repository.listMemoryRevisions?.(id) ?? [],
    };
  }

  async import(params: JsonRecord): Promise<JsonRecord> {
    const source = requiredString(params.source, "source");
    const records = Array.isArray(params.records) ? params.records : [];
    const dryRun = params.dryRun !== false;
    const mapped = this.mapImportRecords(source, records);

    if (dryRun) return { status: "preview", dryRun: true, source, count: mapped.length, items: mapped };

    for (const item of mapped) {
      if (isRecord(item) && isRecord(item.observation)) {
        this.repository.addObservation(item.observation as unknown as ObservationInput);
        if (isRecord(item.artifactReference)) this.repository.upsertArtifactReference?.(item.artifactReference as unknown as ArtifactReferenceInput);
        this.enqueueObservation(item.observation as unknown as ObservationInput);
      } else if (isRecord(item) && typeof item.content === "string" && typeof item.title === "string") {
        this.repository.addObservation(item as unknown as ObservationInput);
        this.enqueueObservation(item as unknown as ObservationInput);
      } else if (isRecord(item) && typeof item.trigger === "string" && typeof item.action === "string") {
        this.repository.addInstinctCandidate?.(item as unknown as InstinctCandidateInput);
      }
    }

    return { status: "imported", dryRun: false, source, count: mapped.length };
  }

  async meditate(params: JsonRecord = {}): Promise<MeditationResult> {
    return this.runMeditation({ trigger: "manual", force: params.force === true || true });
  }

  async reviewInstincts(): Promise<unknown[]> {
    return this.repository.listPromptInstincts?.({ workspaceId: this.workspaceId, limit: this.settings.instincts.maxPromptItems }) ?? [];
  }

  async compare(params: JsonRecord): Promise<JsonRecord> {
    const oldId = requiredString(params.oldId, "oldId");
    const newId = requiredString(params.newId, "newId");
    const old = this.repository.getObservation?.(oldId);
    const next = this.repository.getObservation?.(newId);
    return { old, new: next, relation: old && next ? "comparable" : "missing" };
  }

  async revise(params: JsonRecord): Promise<JsonRecord> {
    if (params.explicit !== true) return { status: "confirmation-needed" };
    const oldId = requiredString(params.oldId, "oldId");
    const content = scrubSecrets(requiredString(params.newContent, "newContent"), { maxChars: 2000 });
    const reason = scrubSecrets(requiredString(params.reason, "reason"), { maxChars: 500 });
    const observation: ObservationInput = {
      id: `obs_${hash(`${this.sessionId}:revision:${oldId}:${content}`)}`,
      workspaceId: this.workspaceId,
      sessionId: this.sessionId,
      kind: "revision",
      scope: "project",
      title: truncateText(content.replace(/\s+/g, " "), 100),
      content,
      sourceEventIds: [oldId],
      tags: ["revision"],
      confidence: 0.75,
      trust: 0.75,
      status: "active",
    };
    this.repository.addObservation(observation);
    this.repository.recordMemoryRevision?.({
      id: `rev_${hash(`${oldId}:${observation.id}:${reason}`)}`,
      oldObservationId: oldId,
      newObservationId: observation.id,
      relation: "supersedes",
      reason,
    });
    this.enqueueObservation(observation);
    return { status: "revised", id: observation.id, oldId };
  }

  private mapImportRecords(source: string, records: unknown[]): unknown[] {
    switch (source) {
      case "pi-observational-memory":
      case "observational-memory":
        return records.map((record) => mapObservationalMemoryRecord({ record: record as any, workspaceId: this.workspaceId, sessionId: this.sessionId }));
      case "pi-continuous-learning":
      case "continuous-learning": {
        const items: unknown[] = [];
        for (const record of records) {
          const candidate = record as any;
          items.push(typeof candidate.trigger === "string" && typeof candidate.action === "string"
            ? mapContinuousLearningInstinct({ instinct: candidate, workspaceId: this.workspaceId, sessionId: this.sessionId })
            : mapContinuousLearningFact({ fact: candidate, workspaceId: this.workspaceId, sessionId: this.sessionId }));
        }
        return items;
      }
      case "lapis":
        return records.map((record) => mapLapisArtifact({ artifact: record as any, workspaceId: this.workspaceId, sessionId: this.sessionId }));
      default:
        throw new Error(`Unsupported import source: ${source}`);
    }
  }

  private localMemories(prompt: string): ObservationRecord[] {
    const byId = new Map<string, ObservationRecord>();
    const query = sanitizeFtsQuery(prompt);
    if (query) {
      try {
        for (const item of this.repository.searchObservations?.(query, { workspaceId: this.workspaceId, limit: this.settings.localObservationLimit }) ?? []) byId.set(item.id, item);
      } catch {
        // Malformed FTS input should not break prompt injection; fall back to curated prompt observations.
      }
    }
    for (const item of this.repository.listPromptObservations?.({ workspaceId: this.workspaceId, limit: this.settings.localObservationLimit }) ?? []) byId.set(item.id, item);
    return [...byId.values()].slice(0, this.settings.localObservationLimit);
  }

  private async recallHindsight(query: string): Promise<PromptHindsightMemory[]> {
    if (!this.settings.hindsight.enabled || !this.hindsight?.recall) return [];

    try {
      const calls = this.hindsightRecallCalls();
      const memories: PromptHindsightMemory[] = [];
      for (const call of calls) {
        if (call.limit <= 0) continue;
        const response = await this.hindsight.recall(this.bankId(), query, {
          budget: this.settings.hindsight.defaultBudget,
          limit: call.limit,
          ...(call.tags ? { tags: call.tags } : {}),
        });
        memories.push(...parseHindsightMemories(response, this.bankId()).slice(0, call.limit));
      }
      return memories.slice(0, this.settings.hindsightRecallLimit);
    } catch {
      return [];
    }
  }

  private hindsightRecallCalls(): Array<{ limit: number; tags?: string[] }> {
    const totalLimit = this.settings.hindsightRecallLimit;
    switch (this.settings.hindsight.recallScope) {
      case "vibeOnly":
        return [{ limit: totalLimit, tags: ["pi-vibe-memory"] }];
      case "bankWide":
        return [{ limit: totalLimit }];
      case "hybrid": {
        const bankWideLimit = Math.min(this.settings.hindsight.bankWideLimit, totalLimit);
        return [
          { limit: totalLimit - bankWideLimit, tags: ["pi-vibe-memory"] },
          { limit: bankWideLimit },
        ];
      }
    }
  }

  private listPromptInstincts(): any[] {
    return (this.repository.listPromptInstincts?.({ workspaceId: this.workspaceId, limit: this.settings.instincts.maxPromptItems }) ?? []).slice(0, this.settings.instincts.maxPromptItems);
  }

  private listArtifactReferences(): any[] {
    return (this.repository.listArtifactReferences?.({ workspaceId: this.workspaceId, limit: this.settings.codeReferences.maxPerPrompt }) ?? []).slice(0, this.settings.codeReferences.maxPerPrompt);
  }

  private listRevisionNotes(local: ObservationRecord[]): any[] {
    if (!this.settings.revision.enabled || !this.repository.listMemoryRevisions) return [];
    const notes: unknown[] = [];
    for (const item of local) {
      for (const revision of this.repository.listMemoryRevisions(item.id) ?? []) {
        notes.push(revision);
        if (notes.length >= this.settings.revision.maxPromptItems) return notes as any[];
      }
    }
    return notes as any[];
  }

  private compactionRevisionNotes(observations: ObservationRecord[]): any[] {
    if (!this.repository.listMemoryRevisions) return [];
    const seen = new Set<string>();
    const notes: any[] = [];
    for (const item of observations) {
      for (const revision of this.repository.listMemoryRevisions(item.id) ?? []) {
        const id = isRecord(revision) && typeof revision.id === "string" ? revision.id : JSON.stringify(revision);
        if (seen.has(id)) continue;
        seen.add(id);
        notes.push(revision);
        if (notes.length >= this.settings.compaction.maxRevisions) return notes;
      }
    }
    return notes;
  }

  private enqueueObservation(observation: ObservationInput): void {
    if (!this.settings.sync.enabled || !this.repository.enqueueSyncJob) return;
    enqueueObservationSync(this.repository as any, {
      ...observation,
      sourceEventIds: observation.sourceEventIds ?? [],
      tags: observation.tags ?? [],
      confidence: observation.confidence ?? 0.5,
      trust: observation.trust ?? 0.7,
      status: observation.status ?? "active",
      createdAt: this.now().toISOString(),
      updatedAt: this.now().toISOString(),
    }, this.bankId());
  }

  private bankId(): string {
    return normalizeBankId(this.settings.hindsight.workspaceBank ?? this.settings.hindsight.bank);
  }
}

function parseHindsightMemories(value: unknown, fallbackBank: string): PromptHindsightMemory[] {
  const items = Array.isArray(value) ? value : isRecord(value) && Array.isArray(value.memories) ? value.memories : isRecord(value) && Array.isArray(value.items) ? value.items : [];
  return items.flatMap((item) => {
    if (!isRecord(item)) return [];
    const content = stringValue(item.content) ?? stringValue(item.text) ?? stringValue(item.memory);
    if (!content) return [];
    return [{
      id: stringValue(item.id) ?? stringValue(item.documentId) ?? `hs_${hash(content)}`,
      content,
      bank: stringValue(item.bank) ?? fallbackBank,
      tags: Array.isArray(item.tags) ? item.tags.map(String) : undefined,
      confidence: typeof item.confidence === "number" ? item.confidence : undefined,
      status: stringValue(item.status),
    }];
  });
}

function extractText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!isRecord(value)) return "";
  for (const key of ["content", "text", "response", "result"]) {
    if (typeof value[key] === "string") return value[key];
  }
  return "";
}

function numberParam(value: unknown, fallback: number): number {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : fallback;
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${name} is required`);
  return value.trim();
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is JsonRecord {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sanitizeFtsQuery(value: string): string {
  return value
    .split(/\s+/)
    .map((part) => part.replace(/[^A-Za-z0-9_]+/g, ""))
    .filter((part) => part.length > 1)
    .slice(0, 8)
    .join(" ");
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}
