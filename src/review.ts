import { REVIEW_ACTIONS } from "./constants.js";
import type { InstinctCandidateRecord, MemoryStatus, ObservationRecord } from "./storage/repository.js";

export type ReviewAction = typeof REVIEW_ACTIONS[number];

export type ReviewItem =
  | ({ itemType: "observation" } & ObservationRecord)
  | ({ itemType: "instinct" } & InstinctCandidateRecord);

export interface ReviewRepository {
  listReviewObservations?(options: { workspaceId: string; limit?: number; kind?: string }): ObservationRecord[];
  listPromptInstincts?(options: { workspaceId: string; limit?: number }): InstinctCandidateRecord[];
  getObservation?(id: string): ObservationRecord | undefined;
  listMemoryRevisions?(observationId: string): unknown[];
  setObservationStatus?(id: string, status: MemoryStatus): void;
  setInstinctCandidateStatus?(id: string, status: MemoryStatus): void;
}

export interface ReviewParams {
  action?: unknown;
  id?: unknown;
  kind?: unknown;
  scope?: unknown;
  tags?: unknown;
  limit?: unknown;
}

export function listReviewItems(repository: ReviewRepository, options: { workspaceId: string; limit?: number; kind?: string }): ReviewItem[] {
  const limit = boundedLimit(options.limit);
  const observations = repository.listReviewObservations?.({ workspaceId: options.workspaceId, limit, kind: options.kind }) ?? [];
  const instincts = (repository.listPromptInstincts?.({ workspaceId: options.workspaceId, limit }) ?? [])
    .filter((item) => item.status === "needs_review" && (!options.kind || item.kind === options.kind));

  return [
    ...observations.map((item) => ({ ...item, itemType: "observation" as const })),
    ...instincts.map((item) => ({ ...item, itemType: "instinct" as const })),
  ].slice(0, limit);
}

export function applyReviewAction(repository: ReviewRepository, params: ReviewParams & { workspaceId: string }): Record<string, unknown> {
  const action = normalizeAction(params.action);
  const id = typeof params.id === "string" ? params.id.trim() : "";

  if (action === "list") {
    return { action, items: listReviewItems(repository, { workspaceId: params.workspaceId, limit: numberParam(params.limit), kind: stringParam(params.kind) }) };
  }
  if (!id) throw new Error("id is required for review action");

  if (action === "explain") {
    const observation = repository.getObservation?.(id);
    return {
      action,
      id,
      observation,
      revisions: repository.listMemoryRevisions?.(id) ?? [],
      status: observation?.status ?? "not_found",
    };
  }

  const status = statusForAction(action);
  const items = listReviewItems(repository, { workspaceId: params.workspaceId, limit: 50 });
  const item = items.find((candidate) => candidate.id === id);
  if (!item) throw new Error(`review item not found: ${id}`);

  if (item.itemType === "observation") repository.setObservationStatus?.(id, status);
  else repository.setInstinctCandidateStatus?.(id, status);

  return { action, id, itemType: item.itemType, status, scope: stringParam(params.scope), tags: stringArrayParam(params.tags) };
}

function normalizeAction(value: unknown): ReviewAction {
  const action = typeof value === "string" && value.trim() ? value.trim() : "list";
  if (!REVIEW_ACTIONS.includes(action as ReviewAction)) throw new Error(`Unsupported review action: ${action}`);
  return action as ReviewAction;
}

function statusForAction(action: ReviewAction): MemoryStatus {
  switch (action) {
    case "approve_active":
    case "approve_scoped":
      return "active";
    case "mark_old_failed":
    case "keep_old":
      return "historical";
    case "defer":
      return "needs_review";
    case "list":
    case "explain":
      throw new Error(`${action} does not change review status`);
  }
}

function boundedLimit(value: number | undefined): number {
  if (!Number.isInteger(value) || (value ?? 0) <= 0) return 10;
  return Math.min(Number(value), 50);
}

function numberParam(value: unknown): number | undefined {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : undefined;
}

function stringParam(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringArrayParam(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === "string" && item.trim() !== "").map((item) => item.trim());
}
