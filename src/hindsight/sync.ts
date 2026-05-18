import { createArtifactDocumentId, createObservationDocumentId } from "./banks.js";
import type { HindsightMetadata, MemoryItemInput } from "./client.js";
import { scrubSecrets } from "../scrub.js";
import type { ObservationRecord, SyncJobInput, SyncJobRecord, VibeMemoryRepository } from "../storage/repository.js";

export { createArtifactDocumentId as buildArtifactDocumentId } from "./banks.js";

export interface SyncQueueRepository {
  enqueueSyncJob(input: SyncJobInput): void;
  listPendingSyncJobs(limit?: number): SyncJobRecord[];
  markSyncJobDone(id: string): void;
  markSyncJobFailed(id: string, error: string): void;
}

export interface HindsightRetainClient {
  retainBatch(bankId: string, items: MemoryItemInput[]): Promise<unknown>;
}

export interface FlushSyncQueueOptions {
  repository: Pick<SyncQueueRepository, "listPendingSyncJobs" | "markSyncJobDone" | "markSyncJobFailed">;
  hindsight: HindsightRetainClient;
  maxBatchItems?: number;
  strict?: boolean;
}

export interface FlushSyncQueueResult {
  processed: number;
  succeeded: number;
  failed: number;
}

interface RetainObservationPayload {
  bankId: string;
  items: MemoryItemInput[];
}

const BASE_TAGS = ["pi", "pi-vibe-memory"] as const;
const INACTIVE_STATUSES = new Set(["superseded", "historical"]);

export function buildHindsightMemoryItem(observation: ObservationRecord): MemoryItemInput {
  const status = observation.status;
  const tags = uniqueTags([
    ...BASE_TAGS,
    `workspace:${observation.workspaceId}`,
    observation.sessionId ? `session:${observation.sessionId}` : undefined,
    `kind:${observation.kind}`,
    `status:${status}`,
    ...observation.tags,
  ]);

  const metadata = metadataStrings({
    source: "pi-vibe-memory",
    observationId: observation.id,
    workspaceId: observation.workspaceId,
    sessionId: observation.sessionId,
    kind: observation.kind,
    scope: observation.scope,
    status,
    confidence: observation.confidence,
    trust: observation.trust,
    updatedAt: observation.updatedAt,
  });

  return {
    content: buildObservationContent(observation),
    documentId: observation.hindsightDocumentId ?? createObservationDocumentId(observation.id),
    updateMode: "replace",
    tags,
    metadata,
  };
}

export function enqueueObservationSync(
  repository: Pick<VibeMemoryRepository, "enqueueSyncJob">,
  observation: ObservationRecord,
  bankId: string,
): void {
  repository.enqueueSyncJob({
    id: `sync:${bankId}:observation:${observation.id}`,
    observationId: observation.id,
    operation: "retain_observation",
    payload: {
      bankId,
      items: [buildHindsightMemoryItem(observation)],
    },
  });
}

export async function flushSyncQueue(options: FlushSyncQueueOptions): Promise<FlushSyncQueueResult> {
  const limit = normalizeBatchLimit(options.maxBatchItems);
  const jobs = options.repository.listPendingSyncJobs(limit);
  const result: FlushSyncQueueResult = { processed: jobs.length, succeeded: 0, failed: 0 };

  for (const job of jobs) {
    try {
      if (job.operation !== "retain_observation") throw new Error(`Unsupported sync operation: ${job.operation}`);
      const payload = parseRetainPayload(job.payload);
      await options.hindsight.retainBatch(payload.bankId, payload.items);
      options.repository.markSyncJobDone(job.id);
      result.succeeded += 1;
    } catch (error) {
      const message = scrubSecrets(errorMessage(error), { maxChars: 500 });
      options.repository.markSyncJobFailed(job.id, message);
      result.failed += 1;
      if (options.strict === true) throw error;
    }
  }

  return result;
}

function buildObservationContent(observation: ObservationRecord): string {
  const inactiveWarning = INACTIVE_STATUSES.has(observation.status)
    ? "\nSafety: This memory is retained for provenance only; it is not an active fact."
    : "";

  return [
    `Title: ${observation.title}`,
    `Kind: ${observation.kind}`,
    `Scope: ${observation.scope}`,
    `Status: ${observation.status}${inactiveWarning}`,
    "",
    observation.content,
  ].join("\n");
}

function parseRetainPayload(payload: unknown): RetainObservationPayload {
  if (!isRecord(payload)) throw new Error("sync job payload must be an object");
  const bankId = typeof payload.bankId === "string" ? payload.bankId.trim() : "";
  if (!bankId) throw new Error("sync job payload bankId must be non-empty");
  if (!Array.isArray(payload.items) || payload.items.length === 0) throw new Error("sync job payload items must be non-empty");
  return { bankId, items: payload.items.map(toMemoryItem) };
}

function toMemoryItem(item: unknown): MemoryItemInput {
  if (!isRecord(item) || typeof item.content !== "string" || item.content.trim() === "") {
    throw new Error("sync job payload item must include non-empty string content");
  }

  const memoryItem: MemoryItemInput = { content: item.content };
  if (typeof item.documentId === "string") memoryItem.documentId = item.documentId;
  if (item.updateMode === "append" || item.updateMode === "replace") memoryItem.updateMode = item.updateMode;
  if (Array.isArray(item.tags)) memoryItem.tags = item.tags.map(String);
  if (isRecord(item.metadata)) memoryItem.metadata = metadataStrings(item.metadata);
  return memoryItem;
}

function metadataStrings(input: Record<string, unknown>): HindsightMetadata {
  const out: HindsightMetadata = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null) continue;
    out[key] = typeof value === "string" ? value : String(value);
  }
  return out;
}

function normalizeBatchLimit(value: number | undefined): number {
  if (!Number.isInteger(value) || (value ?? 0) <= 0) return 25;
  return Math.min(Number(value), 100);
}

function uniqueTags(tags: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of tags) {
    const trimmed = tag?.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
