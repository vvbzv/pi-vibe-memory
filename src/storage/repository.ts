import { buildHindsightMemoryItem } from "../hindsight/sync.js";
import type { VibeMemoryDb } from "./db.js";

export type MemoryStatus = "active" | "superseded" | "historical" | "working" | "needs_review";

export interface ObservationSearchOptions {
  workspaceId: string;
  limit?: number;
  includeInactive?: boolean;
  includeHistorical?: boolean;
  kind?: string;
  status?: MemoryStatus;
}

export interface WorkspaceInput {
  id: string;
  name: string;
  rootPath: string;
}

export interface SessionInput {
  id: string;
  workspaceId: string;
  branchId?: string;
  model?: string;
  metadata?: unknown;
}

export interface RawEventInput {
  id: string;
  sessionId: string;
  entryId?: string;
  parentEntryId?: string;
  kind: string;
  occurredAt?: string;
  content: unknown;
  scrubbed?: boolean;
  tokenEstimate?: number;
}

export interface ObservationInput {
  id: string;
  workspaceId: string;
  sessionId?: string;
  kind: string;
  scope: string;
  title: string;
  content: string;
  sourceEventIds?: string[];
  tags?: string[];
  confidence?: number;
  trust?: number;
  status?: MemoryStatus;
  hindsightDocumentId?: string;
}

export interface ObservationRecord {
  id: string;
  workspaceId: string;
  sessionId?: string;
  kind: string;
  scope: string;
  title: string;
  content: string;
  sourceEventIds: string[];
  tags: string[];
  confidence: number;
  trust: number;
  status: MemoryStatus;
  createdAt: string;
  updatedAt: string;
  syncedAt?: string;
  hindsightDocumentId?: string;
}

export interface ArtifactReferenceInput {
  id: string;
  workspaceId: string;
  sessionId?: string;
  observationId?: string;
  path: string;
  artifactType: string;
  symbol?: string;
  lineStart?: number;
  lineEnd?: number;
  sourceEventIds?: string[];
}

export interface ArtifactReferenceRecord extends ArtifactReferenceInput {
  createdAt: string;
  updatedAt: string;
  sourceEventIds: string[];
}

export interface SyncJobInput {
  id: string;
  observationId?: string;
  operation: string;
  payload: unknown;
}

export interface SyncJobRecord {
  id: string;
  observationId?: string;
  operation: string;
  payload: unknown;
  attempts: number;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface MeditationRunInput {
  id: string;
  workspaceId: string;
  sessionId?: string;
  trigger: string;
  status: string;
  inputObservationIds?: string[];
}

export interface InstinctCandidateInput {
  id: string;
  workspaceId: string;
  sessionId?: string;
  meditationRunId?: string;
  kind: string;
  trigger?: string;
  action?: string;
  content: string;
  evidenceObservationIds?: string[];
  confidence?: number;
  status?: MemoryStatus;
  durableApproved?: boolean;
  expiresAt?: string;
}

export interface InstinctCandidateRecord extends InstinctCandidateInput {
  evidenceObservationIds: string[];
  confidence: number;
  status: MemoryStatus;
  durableApproved: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MemoryRevisionInput {
  id: string;
  oldObservationId: string;
  newObservationId: string;
  relation: string;
  reason: string;
}

export interface MemoryRevisionRecord extends MemoryRevisionInput {
  createdAt: string;
}

export interface MemoryStats {
  observations: {
    total: number;
    byStatus: Record<string, number>;
    byKind: Record<string, number>;
    byScope: Record<string, number>;
    activeLike: number;
    needsReview: number;
  };
  instincts: {
    total: number;
    byStatus: Record<string, number>;
    needsReview: number;
  };
  artifacts: { total: number };
  revisions: { total: number };
  rawEvents: { total: number };
  sync: { pending: number; failed: number };
  meditation: { total: number; failed: number };
}

const PROMPT_OBSERVATION_STATUSES: MemoryStatus[] = ["active", "working", "needs_review"];
const PROMPT_INSTINCT_STATUSES: MemoryStatus[] = ["active", "working", "needs_review"];

export class VibeMemoryRepository {
  constructor(private readonly db: VibeMemoryDb) {}

  upsertWorkspace(input: WorkspaceInput): void {
    const now = isoNow();
    this.db.prepare(`
      INSERT INTO workspaces (id, name, root_path, created_at, updated_at)
      VALUES (@id, @name, @rootPath, @now, @now)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        root_path = excluded.root_path,
        updated_at = excluded.updated_at
    `).run({ ...input, now });
  }

  startSession(input: SessionInput): void {
    this.db.prepare(`
      INSERT INTO sessions (id, workspace_id, branch_id, started_at, model, metadata_json)
      VALUES (@id, @workspaceId, @branchId, @startedAt, @model, @metadataJson)
      ON CONFLICT(id) DO UPDATE SET
        workspace_id = excluded.workspace_id,
        branch_id = excluded.branch_id,
        model = excluded.model,
        metadata_json = excluded.metadata_json
    `).run({
      id: input.id,
      workspaceId: input.workspaceId,
      branchId: input.branchId ?? null,
      startedAt: isoNow(),
      model: input.model ?? null,
      metadataJson: stringify(input.metadata ?? {}),
    });
  }

  appendRawEvent(input: RawEventInput): void {
    this.db.prepare(`
      INSERT INTO raw_events (
        id, session_id, entry_id, parent_entry_id, kind, occurred_at,
        content_json, scrubbed, token_estimate
      ) VALUES (
        @id, @sessionId, @entryId, @parentEntryId, @kind, @occurredAt,
        @contentJson, @scrubbed, @tokenEstimate
      )
    `).run({
      id: input.id,
      sessionId: input.sessionId,
      entryId: input.entryId ?? null,
      parentEntryId: input.parentEntryId ?? null,
      kind: input.kind,
      occurredAt: input.occurredAt ?? isoNow(),
      contentJson: stringify(input.content),
      scrubbed: input.scrubbed === false ? 0 : 1,
      tokenEstimate: input.tokenEstimate ?? 0,
    });
  }

  addObservation(input: ObservationInput): void {
    const now = isoNow();
    const add = this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO observations (
          id, workspace_id, session_id, kind, scope, title, content,
          source_event_ids_json, tags_json, confidence, trust, status,
          created_at, updated_at, hindsight_document_id
        ) VALUES (
          @id, @workspaceId, @sessionId, @kind, @scope, @title, @content,
          @sourceEventIdsJson, @tagsJson, @confidence, @trust, @status,
          @now, @now, @hindsightDocumentId
        )
        ON CONFLICT(id) DO UPDATE SET
          workspace_id = excluded.workspace_id,
          session_id = excluded.session_id,
          kind = excluded.kind,
          scope = excluded.scope,
          title = excluded.title,
          content = excluded.content,
          source_event_ids_json = excluded.source_event_ids_json,
          tags_json = excluded.tags_json,
          confidence = excluded.confidence,
          trust = excluded.trust,
          status = excluded.status,
          updated_at = excluded.updated_at,
          hindsight_document_id = excluded.hindsight_document_id
      `).run(observationParams(input, now));

      this.db.prepare("DELETE FROM observations_fts WHERE observation_id = ?").run(input.id);
      this.db.prepare(`
        INSERT INTO observations_fts (observation_id, workspace_id, title, content, kind, scope)
        VALUES (@id, @workspaceId, @title, @content, @kind, @scope)
      `).run(input);
    });
    add();
  }

  getObservation(id: string): ObservationRecord | undefined {
    const row = this.db.prepare("SELECT * FROM observations WHERE id = ?").get(id) as ObservationRow | undefined;
    return row ? mapObservation(row) : undefined;
  }

  searchObservations(query: string, options: ObservationSearchOptions): ObservationRecord[] {
    const limit = boundedLimit(options.limit);
    const statuses = options.status ? [options.status] : options.includeInactive || options.includeHistorical ? null : PROMPT_OBSERVATION_STATUSES;
    const ftsQuery = sanitizeFtsQuery(query);
    if (!ftsQuery) return [];
    const rows = this.db.prepare(`
      SELECT o.*
      FROM observations_fts f
      JOIN observations o ON o.id = f.observation_id
      WHERE observations_fts MATCH @query
        AND f.workspace_id = @workspaceId
        AND (@kind IS NULL OR o.kind = @kind)
        AND (@statusesJson IS NULL OR o.status IN (SELECT value FROM json_each(@statusesJson)))
      ORDER BY bm25(observations_fts), o.id ASC
      LIMIT @limit
    `).all({
      query: ftsQuery,
      workspaceId: options.workspaceId,
      kind: options.kind ?? null,
      statusesJson: statuses ? stringify(statuses) : null,
      limit,
    }) as ObservationRow[];
    return rows.map(mapObservation);
  }

  listPromptObservations(options: { workspaceId: string; limit?: number }): ObservationRecord[] {
    const rows = this.db.prepare(`
      SELECT * FROM observations
      WHERE workspace_id = @workspaceId
        AND status IN ('active', 'working', 'needs_review')
      ORDER BY trust DESC, confidence DESC, id ASC
      LIMIT @limit
    `).all({ workspaceId: options.workspaceId, limit: boundedLimit(options.limit) }) as ObservationRow[];
    return rows.map(mapObservation);
  }

  listReviewObservations(options: { workspaceId: string; limit?: number; kind?: string }): ObservationRecord[] {
    const rows = this.db.prepare(`
      SELECT * FROM observations
      WHERE workspace_id = @workspaceId
        AND status = 'needs_review'
        AND (@kind IS NULL OR kind = @kind)
      ORDER BY trust DESC, confidence DESC, id ASC
      LIMIT @limit
    `).all({ workspaceId: options.workspaceId, kind: options.kind ?? null, limit: boundedLimit(options.limit) }) as ObservationRow[];
    return rows.map(mapObservation);
  }

  updateObservationReview(input: { id: string; status: MemoryStatus; scope?: string; tags?: string[] }): ObservationRecord | undefined {
    return this.updateObservationLifecycle(input);
  }

  setObservationStatus(id: string, status: MemoryStatus): void {
    this.updateObservationLifecycle({ id, status, enqueueSync: false });
  }

  recordMemoryRevision(input: MemoryRevisionInput): void {
    const record = this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO memory_revisions (id, old_observation_id, new_observation_id, relation, reason, created_at)
        VALUES (@id, @oldObservationId, @newObservationId, @relation, @reason, @now)
      `).run({ ...input, now: isoNow() });

      if (input.relation === "supersedes") {
        this.updateObservationLifecycle({ id: input.oldObservationId, status: "superseded" });
      }
    });
    record();
  }

  private updateObservationLifecycle(input: { id: string; status?: MemoryStatus; scope?: string; tags?: string[]; enqueueSync?: boolean }): ObservationRecord | undefined {
    const existing = this.getObservation(input.id);
    if (!existing) return undefined;
    const updatedAt = isoNow();
    const status = input.status ?? existing.status;
    const scope = input.scope ?? existing.scope;
    const tags = uniqueStrings(input.tags ?? existing.tags);

    const update = this.db.transaction(() => {
      this.db.prepare(`
        UPDATE observations
        SET status = @status, scope = @scope, tags_json = @tagsJson, updated_at = @updatedAt
        WHERE id = @id
      `).run({ id: input.id, status, scope, tagsJson: stringify(tags), updatedAt });

      const updated = this.getObservation(input.id);
      if (!updated) return undefined;
      this.replaceObservationFts(updated);
      if (input.enqueueSync !== false) this.enqueueObservationReplacement(updated, "pi");
      return updated;
    });
    return update();
  }

  private replaceObservationFts(observation: ObservationRecord): void {
    this.db.prepare("DELETE FROM observations_fts WHERE observation_id = ?").run(observation.id);
    this.db.prepare(`
      INSERT INTO observations_fts (observation_id, workspace_id, title, content, kind, scope)
      VALUES (@id, @workspaceId, @title, @content, @kind, @scope)
    `).run(observation);
  }

  private enqueueObservationReplacement(observation: ObservationRecord, bankId: string): void {
    this.enqueueSyncJob({
      id: `sync:${bankId}:observation:${observation.id}`,
      observationId: observation.id,
      operation: "retain_observation",
      payload: { bankId, items: [buildHindsightMemoryItem(observation)] },
    });
  }

  listMemoryRevisions(observationId: string): MemoryRevisionRecord[] {
    const rows = this.db.prepare(`
      SELECT * FROM memory_revisions
      WHERE old_observation_id = @observationId OR new_observation_id = @observationId
      ORDER BY created_at DESC, id ASC
      LIMIT 20
    `).all({ observationId }) as MemoryRevisionRow[];
    return rows.map(mapMemoryRevision);
  }

  enqueueSyncJob(input: SyncJobInput): void {
    const now = isoNow();
    this.db.prepare(`
      INSERT INTO sync_queue (id, observation_id, operation, payload_json, attempts, last_error, created_at, updated_at)
      VALUES (@id, @observationId, @operation, @payloadJson, 0, NULL, @now, @now)
      ON CONFLICT(id) DO UPDATE SET
        observation_id = excluded.observation_id,
        operation = excluded.operation,
        payload_json = excluded.payload_json,
        attempts = 0,
        last_error = NULL,
        updated_at = excluded.updated_at
    `).run({
      id: input.id,
      observationId: input.observationId ?? null,
      operation: input.operation,
      payloadJson: stringify(input.payload),
      now,
    });
  }

  listPendingSyncJobs(limit = 25): SyncJobRecord[] {
    const rows = this.db.prepare(`
      SELECT * FROM sync_queue
      ORDER BY COALESCE(observation_id, id) ASC, id ASC
      LIMIT @limit
    `).all({ limit: boundedLimit(limit, 50) }) as SyncJobRow[];
    return rows.map(mapSyncJob);
  }

  markSyncJobDone(id: string): void {
    this.db.prepare("DELETE FROM sync_queue WHERE id = ?").run(id);
  }

  markSyncJobFailed(id: string, error: string): void {
    this.db.prepare(`
      UPDATE sync_queue
      SET attempts = attempts + 1,
          last_error = @error,
          updated_at = @updatedAt
      WHERE id = @id
    `).run({ id, error, updatedAt: isoNow() });
  }

  upsertArtifactReference(input: ArtifactReferenceInput): void {
    const now = isoNow();
    const params = {
      id: input.id,
      workspaceId: input.workspaceId,
      sessionId: input.sessionId ?? null,
      observationId: input.observationId ?? null,
      path: input.path,
      artifactType: input.artifactType,
      symbol: input.symbol ?? null,
      lineStart: input.lineStart ?? null,
      lineEnd: input.lineEnd ?? null,
      sourceEventIdsJson: stringify(input.sourceEventIds ?? []),
      now,
    };

    const existing = this.db.prepare(`
      SELECT id FROM artifact_references
      WHERE workspace_id = @workspaceId
        AND path = @path
        AND artifact_type = @artifactType
        AND symbol IS @symbol
        AND line_start IS @lineStart
        AND line_end IS @lineEnd
      LIMIT 1
    `).get(params) as { id: string } | undefined;

    if (existing) {
      this.db.prepare(`
        UPDATE artifact_references
        SET session_id = COALESCE(@sessionId, session_id),
            observation_id = COALESCE(@observationId, observation_id),
            source_event_ids_json = @sourceEventIdsJson,
            updated_at = @now
        WHERE id = @existingId
      `).run({ ...params, existingId: existing.id });
      return;
    }

    this.db.prepare(`
      INSERT INTO artifact_references (
        id, workspace_id, session_id, observation_id, path, artifact_type, symbol,
        line_start, line_end, source_event_ids_json, created_at, updated_at
      ) VALUES (
        @id, @workspaceId, @sessionId, @observationId, @path, @artifactType, @symbol,
        @lineStart, @lineEnd, @sourceEventIdsJson, @now, @now
      )
    `).run(params);
  }

  listArtifactReferences(options: { workspaceId: string; limit?: number }): ArtifactReferenceRecord[] {
    const rows = this.db.prepare(`
      SELECT * FROM artifact_references
      WHERE workspace_id = @workspaceId
      ORDER BY updated_at DESC
      LIMIT @limit
    `).all({ workspaceId: options.workspaceId, limit: boundedLimit(options.limit) }) as ArtifactReferenceRow[];
    return rows.map(mapArtifactReference);
  }

  startMeditationRun(input: MeditationRunInput): void {
    this.db.prepare(`
      INSERT INTO meditation_runs (
        id, workspace_id, session_id, trigger, status, started_at, input_observation_ids_json
      ) VALUES (
        @id, @workspaceId, @sessionId, @trigger, @status, @startedAt, @inputObservationIdsJson
      )
    `).run({
      id: input.id,
      workspaceId: input.workspaceId,
      sessionId: input.sessionId ?? null,
      trigger: input.trigger,
      status: input.status,
      startedAt: isoNow(),
      inputObservationIdsJson: stringify(input.inputObservationIds ?? []),
    });
  }

  finishMeditationRun(input: { id: string; status: string; error?: string }): void {
    this.db.prepare(`
      UPDATE meditation_runs
      SET status = @status, finished_at = @finishedAt, error = @error
      WHERE id = @id
    `).run({ id: input.id, status: input.status, finishedAt: isoNow(), error: input.error ?? null });
  }

  addInstinctCandidate(input: InstinctCandidateInput): void {
    const now = isoNow();
    this.db.prepare(`
      INSERT INTO instinct_candidates (
        id, workspace_id, session_id, meditation_run_id, kind, trigger, action, content,
        evidence_observation_ids_json, confidence, status, durable_approved,
        created_at, updated_at, expires_at
      ) VALUES (
        @id, @workspaceId, @sessionId, @meditationRunId, @kind, @trigger, @action, @content,
        @evidenceObservationIdsJson, @confidence, @status, @durableApproved,
        @now, @now, @expiresAt
      )
      ON CONFLICT(id) DO UPDATE SET
        workspace_id = excluded.workspace_id,
        session_id = excluded.session_id,
        meditation_run_id = excluded.meditation_run_id,
        kind = excluded.kind,
        trigger = excluded.trigger,
        action = excluded.action,
        content = excluded.content,
        evidence_observation_ids_json = excluded.evidence_observation_ids_json,
        confidence = excluded.confidence,
        status = excluded.status,
        durable_approved = excluded.durable_approved,
        updated_at = excluded.updated_at,
        expires_at = excluded.expires_at
    `).run({
      id: input.id,
      workspaceId: input.workspaceId,
      sessionId: input.sessionId ?? null,
      meditationRunId: input.meditationRunId ?? null,
      kind: input.kind,
      trigger: input.trigger ?? null,
      action: input.action ?? null,
      content: input.content,
      evidenceObservationIdsJson: stringify(input.evidenceObservationIds ?? []),
      confidence: input.confidence ?? 0.5,
      status: input.status ?? "working",
      durableApproved: input.durableApproved === true ? 1 : 0,
      expiresAt: input.expiresAt ?? null,
      now,
    });
  }

  listPromptInstincts(options: { workspaceId: string; limit?: number }): InstinctCandidateRecord[] {
    const rows = this.db.prepare(`
      SELECT * FROM instinct_candidates
      WHERE workspace_id = @workspaceId
        AND status IN ('active', 'working', 'needs_review')
        AND (expires_at IS NULL OR expires_at > @now)
      ORDER BY confidence DESC, updated_at DESC, rowid DESC
      LIMIT @limit
    `).all({ workspaceId: options.workspaceId, now: isoNow(), limit: boundedLimit(options.limit) }) as InstinctCandidateRow[];
    return rows.map(mapInstinctCandidate);
  }

  setInstinctCandidateStatus(id: string, status: MemoryStatus): void {
    this.db.prepare("UPDATE instinct_candidates SET status = @status, updated_at = @updatedAt WHERE id = @id")
      .run({ id, status, updatedAt: isoNow() });
  }

  setMetadata(key: string, value: unknown): void {
    this.db.prepare(`
      INSERT INTO repository_metadata (key, value_json, updated_at)
      VALUES (@key, @valueJson, @updatedAt)
      ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
    `).run({ key, valueJson: stringify(value), updatedAt: isoNow() });
  }

  getMetadata(key: string): unknown {
    const row = this.db.prepare("SELECT value_json FROM repository_metadata WHERE key = ?").get(key) as { value_json: string } | undefined;
    return row ? parseJson(row.value_json) : undefined;
  }

  getStats(workspaceId: string): MemoryStats {
    const observationRows = this.db.prepare(`
      SELECT status, kind, scope, COUNT(*) AS count
      FROM observations
      WHERE workspace_id = @workspaceId
      GROUP BY status, kind, scope
    `).all({ workspaceId }) as Array<{ status: string; kind: string; scope: string; count: number }>;
    const instinctRows = this.db.prepare(`
      SELECT status, COUNT(*) AS count
      FROM instinct_candidates
      WHERE workspace_id = @workspaceId
      GROUP BY status
    `).all({ workspaceId }) as Array<{ status: string; count: number }>;
    const artifacts = countOne(this.db.prepare("SELECT COUNT(*) AS count FROM artifact_references WHERE workspace_id = ?").get(workspaceId));
    const revisions = countOne(this.db.prepare(`
      SELECT COUNT(DISTINCT r.id) AS count
      FROM memory_revisions r
      JOIN observations o ON o.id = r.old_observation_id OR o.id = r.new_observation_id
      WHERE o.workspace_id = @workspaceId
    `).get({ workspaceId }));
    const rawEvents = countOne(this.db.prepare(`
      SELECT COUNT(*) AS count
      FROM raw_events e
      JOIN sessions s ON s.id = e.session_id
      WHERE s.workspace_id = @workspaceId
    `).get({ workspaceId }));
    const pendingSync = countOne(this.db.prepare("SELECT COUNT(*) AS count FROM sync_queue").get());
    const failedSync = countOne(this.db.prepare("SELECT COUNT(*) AS count FROM sync_queue WHERE attempts > 0 OR last_error IS NOT NULL").get());
    const meditationTotal = countOne(this.db.prepare("SELECT COUNT(*) AS count FROM meditation_runs WHERE workspace_id = ?").get(workspaceId));
    const meditationFailed = countOne(this.db.prepare("SELECT COUNT(*) AS count FROM meditation_runs WHERE workspace_id = ? AND status = 'failed'").get(workspaceId));

    const observations = {
      total: 0,
      byStatus: {} as Record<string, number>,
      byKind: {} as Record<string, number>,
      byScope: {} as Record<string, number>,
      activeLike: 0,
      needsReview: 0,
    };
    for (const row of observationRows) {
      observations.total += row.count;
      increment(observations.byStatus, row.status, row.count);
      increment(observations.byKind, row.kind, row.count);
      increment(observations.byScope, row.scope, row.count);
      if (PROMPT_OBSERVATION_STATUSES.includes(row.status as MemoryStatus)) observations.activeLike += row.count;
      if (row.status === "needs_review") observations.needsReview += row.count;
    }

    const instincts = { total: 0, byStatus: {} as Record<string, number>, needsReview: 0 };
    for (const row of instinctRows) {
      instincts.total += row.count;
      increment(instincts.byStatus, row.status, row.count);
      if (row.status === "needs_review") instincts.needsReview += row.count;
    }

    return {
      observations,
      instincts,
      artifacts: { total: artifacts },
      revisions: { total: revisions },
      rawEvents: { total: rawEvents },
      sync: { pending: pendingSync, failed: failedSync },
      meditation: { total: meditationTotal, failed: meditationFailed },
    };
  }
}

function countOne(row: unknown): number {
  return row != null && typeof row === "object" && "count" in row ? Number((row as { count: unknown }).count) || 0 : 0;
}

function increment(target: Record<string, number>, key: string, count: number): void {
  target[key] = (target[key] ?? 0) + count;
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

function observationParams(input: ObservationInput, now: string) {
  return {
    id: input.id,
    workspaceId: input.workspaceId,
    sessionId: input.sessionId ?? null,
    kind: input.kind,
    scope: input.scope,
    title: input.title,
    content: input.content,
    sourceEventIdsJson: stringify(input.sourceEventIds ?? []),
    tagsJson: stringify(input.tags ?? []),
    confidence: input.confidence ?? 0.5,
    trust: input.trust ?? 0.7,
    status: input.status ?? "active",
    hindsightDocumentId: input.hindsightDocumentId ?? null,
    now,
  };
}

function boundedLimit(limit: number | undefined, max = 25): number {
  if (!Number.isInteger(limit) || (limit ?? 0) <= 0) return Math.min(10, max);
  return Math.min(Number(limit), max);
}

function sanitizeFtsQuery(value: string): string {
  return value
    .split(/\s+/)
    .map((part) => part.replace(/[^A-Za-z0-9_]+/g, " "))
    .join(" ")
    .split(/\s+/)
    .filter((part) => part.length > 1)
    .slice(0, 12)
    .join(" ");
}

function isoNow(): string {
  return new Date().toISOString();
}

function stringify(value: unknown): string {
  return JSON.stringify(value);
}

function parseArray(value: string): string[] {
  const parsed = JSON.parse(value) as unknown;
  return Array.isArray(parsed) ? parsed.map(String) : [];
}

function parseJson(value: string): unknown {
  return JSON.parse(value) as unknown;
}

type ObservationRow = {
  id: string;
  workspace_id: string;
  session_id: string | null;
  kind: string;
  scope: string;
  title: string;
  content: string;
  source_event_ids_json: string;
  tags_json: string;
  confidence: number;
  trust: number;
  status: MemoryStatus;
  created_at: string;
  updated_at: string;
  synced_at: string | null;
  hindsight_document_id: string | null;
};

function mapObservation(row: ObservationRow): ObservationRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    sessionId: row.session_id ?? undefined,
    kind: row.kind,
    scope: row.scope,
    title: row.title,
    content: row.content,
    sourceEventIds: parseArray(row.source_event_ids_json),
    tags: parseArray(row.tags_json),
    confidence: row.confidence,
    trust: row.trust,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    syncedAt: row.synced_at ?? undefined,
    hindsightDocumentId: row.hindsight_document_id ?? undefined,
  };
}

type MemoryRevisionRow = {
  id: string;
  old_observation_id: string;
  new_observation_id: string;
  relation: string;
  reason: string;
  created_at: string;
};

function mapMemoryRevision(row: MemoryRevisionRow): MemoryRevisionRecord {
  return {
    id: row.id,
    oldObservationId: row.old_observation_id,
    newObservationId: row.new_observation_id,
    relation: row.relation,
    reason: row.reason,
    createdAt: row.created_at,
  };
}

type SyncJobRow = {
  id: string;
  observation_id: string | null;
  operation: string;
  payload_json: string;
  attempts: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

function mapSyncJob(row: SyncJobRow): SyncJobRecord {
  return {
    id: row.id,
    observationId: row.observation_id ?? undefined,
    operation: row.operation,
    payload: parseJson(row.payload_json),
    attempts: row.attempts,
    lastError: row.last_error ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

type ArtifactReferenceRow = {
  id: string;
  workspace_id: string;
  session_id: string | null;
  observation_id: string | null;
  path: string;
  artifact_type: string;
  symbol: string | null;
  line_start: number | null;
  line_end: number | null;
  source_event_ids_json: string;
  created_at: string;
  updated_at: string;
};

function mapArtifactReference(row: ArtifactReferenceRow): ArtifactReferenceRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    sessionId: row.session_id ?? undefined,
    observationId: row.observation_id ?? undefined,
    path: row.path,
    artifactType: row.artifact_type,
    symbol: row.symbol ?? undefined,
    lineStart: row.line_start ?? undefined,
    lineEnd: row.line_end ?? undefined,
    sourceEventIds: parseArray(row.source_event_ids_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

type InstinctCandidateRow = {
  id: string;
  workspace_id: string;
  session_id: string | null;
  meditation_run_id: string | null;
  kind: string;
  trigger: string | null;
  action: string | null;
  content: string;
  evidence_observation_ids_json: string;
  confidence: number;
  status: MemoryStatus;
  durable_approved: number;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
};

function mapInstinctCandidate(row: InstinctCandidateRow): InstinctCandidateRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    sessionId: row.session_id ?? undefined,
    meditationRunId: row.meditation_run_id ?? undefined,
    kind: row.kind,
    trigger: row.trigger ?? undefined,
    action: row.action ?? undefined,
    content: row.content,
    evidenceObservationIds: parseArray(row.evidence_observation_ids_json),
    confidence: row.confidence,
    status: row.status,
    durableApproved: row.durable_approved === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at ?? undefined,
  };
}
