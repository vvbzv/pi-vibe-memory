import { createArtifactDocumentId, createObservationDocumentId } from "./banks.js";
import type { MemoryItemInput } from "./client.js";
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

  const metadata: Record<string, unknown> = {
    source: "pi-vibe-memory",
    observationId: observation.id,
    workspaceId: observation.workspaceId,
    kind: observation.kind,
    scope: observation.scope,
    status,
    confidence: observation.confidence,
    trust: observation.trust,
    updatedAt: observation.updatedAt,
  };
  if (observation.sessionId) metadata.sessionId = observation.sessionId;

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

  const groups = groupRetainJobs(jobs);
  for (const group of groups) {
    try {
      await options.hindsight.retainBatch(group.bankId, group.items);
      for (const job of group.jobs) {
        options.repository.markSyncJobDone(job.id);
        result.succeeded += 1;
      }
    } catch (error) {
      const message = errorMessage(error);
      for (const job of group.jobs) {
        options.repository.markSyncJobFailed(job.id, message);
        result.failed += 1;
      }
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

function groupRetainJobs(jobs: SyncJobRecord[]): Array<{ bankId: string; items: MemoryItemInput[]; jobs: SyncJobRecord[] }> {
  const byBank = new Map<string, { bankId: string; items: MemoryItemInput[]; jobs: SyncJobRecord[] }>();

  for (const job of jobs) {
    const payload = parseRetainPayload(job.payload);
    if (!payload) {
      byBank.set(`__invalid__:${job.id}`, { bankId: "", items: [], jobs: [job] });
      continue;
    }

    const existing = byBank.get(payload.bankId);
    if (existing) {
      existing.items.push(...payload.items);
      existing.jobs.push(job);
    } else {
      byBank.set(payload.bankId, { bankId: payload.bankId, items: [...payload.items], jobs: [job] });
    }
  }

  return [...byBank.values()];
}

function parseRetainPayload(payload: unknown): RetainObservationPayload | undefined {
  if (!isRecord(payload)) return undefined;
  if (typeof payload.bankId !== "string" || payload.bankId.trim() === "") return undefined;
  if (!Array.isArray(payload.items) || payload.items.length === 0) return undefined;
  return { bankId: payload.bankId, items: payload.items.map(toMemoryItem) };
}

function toMemoryItem(item: unknown): MemoryItemInput {
  if (!isRecord(item) || typeof item.content !== "string") {
    throw new Error("sync job payload item must include string content");
  }

  const memoryItem: MemoryItemInput = { content: item.content };
  if (typeof item.documentId === "string") memoryItem.documentId = item.documentId;
  if (item.updateMode === "append" || item.updateMode === "replace") memoryItem.updateMode = item.updateMode;
  if (Array.isArray(item.tags)) memoryItem.tags = item.tags.map(String);
  if (isRecord(item.metadata)) memoryItem.metadata = item.metadata;
  return memoryItem;
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
