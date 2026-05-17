import { createImportDocumentId } from "../hindsight/banks.js";
import { scrubSecrets, truncateText } from "../scrub.js";
import type { MemoryStatus, ObservationInput } from "../storage/repository.js";

const LEGACY_SOURCE = "pi-observational-memory" as const;

export interface ObservationalMemoryLegacyRecord {
  id: string;
  content: string;
  kind?: string;
  title?: string;
  relevance?: string;
  timestamp?: string;
  sourceEntryIds?: string[];
}

export interface MapObservationalMemoryRecordInput {
  record: ObservationalMemoryLegacyRecord;
  workspaceId: string;
  sessionId?: string;
  branchId?: string;
}

export interface ImportedObservationInput extends ObservationInput {
  legacySource: typeof LEGACY_SOURCE;
  legacyId: string;
  provenance: {
    source: typeof LEGACY_SOURCE;
    legacyId: string;
    branchId?: string;
    sessionId?: string;
    timestamp?: string;
  };
  deleteLegacy: false;
}

export function mapObservationalMemoryRecord(input: MapObservationalMemoryRecordInput): ImportedObservationInput {
  const legacyId = requireNonEmpty(input.record.id, "record.id");
  const content = scrubSecrets(requireNonEmpty(input.record.content, "record.content"));
  const kind = normalizeKind(input.record.kind);
  const title = scrubSecrets(input.record.title?.trim() || titleFromContent(content, kind), { maxChars: 120 });

  return {
    id: importId(LEGACY_SOURCE, legacyId),
    workspaceId: requireNonEmpty(input.workspaceId, "workspaceId"),
    sessionId: input.sessionId,
    kind,
    scope: "project",
    title,
    content,
    sourceEventIds: uniqueStrings([`${LEGACY_SOURCE}:${legacyId}`, ...(input.record.sourceEntryIds ?? [])]),
    tags: uniqueStrings(["imported", LEGACY_SOURCE, kind]),
    confidence: relevanceConfidence(input.record.relevance),
    trust: relevanceTrust(input.record.relevance),
    status: "needs_review" as MemoryStatus,
    hindsightDocumentId: createImportDocumentId(LEGACY_SOURCE, legacyId),
    legacySource: LEGACY_SOURCE,
    legacyId,
    provenance: {
      source: LEGACY_SOURCE,
      legacyId,
      branchId: input.branchId,
      sessionId: input.sessionId,
      timestamp: input.record.timestamp,
    },
    deleteLegacy: false,
  };
}

function normalizeKind(kind: string | undefined): string {
  const normalized = kind?.trim().toLowerCase();
  if (!normalized) return "legacy_observation";
  if (["fact", "decision", "preference", "reflection", "risk"].includes(normalized)) return normalized;
  return "legacy_observation";
}

function relevanceConfidence(relevance: string | undefined): number {
  switch (relevance?.trim().toLowerCase()) {
    case "high":
      return 0.8;
    case "medium":
    case "med":
      return 0.65;
    case "low":
      return 0.45;
    default:
      return 0.6;
  }
}

function relevanceTrust(relevance: string | undefined): number {
  switch (relevance?.trim().toLowerCase()) {
    case "high":
      return 0.75;
    case "medium":
    case "med":
      return 0.6;
    case "low":
      return 0.4;
    default:
      return 0.55;
  }
}

function titleFromContent(content: string, kind: string): string {
  return truncateText(`${kind}: ${content.replace(/\s+/g, " ").trim()}`, 100);
}

function importId(source: string, legacyId: string): string {
  return `import_${source}_${legacyId}`;
}

function uniqueStrings(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

function requireNonEmpty(value: string, name: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${name} is required`);
  return trimmed;
}
