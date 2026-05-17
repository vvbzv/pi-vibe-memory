import { readFile } from "node:fs/promises";
import path from "node:path";
import { createImportDocumentId } from "../hindsight/banks.js";
import { scrubSecrets, truncateText } from "../scrub.js";
import type { InstinctCandidateInput, MemoryStatus, ObservationInput } from "../storage/repository.js";

const LEGACY_SOURCE = "pi-continuous-learning" as const;

type JsonRecord = Record<string, unknown>;

export interface ContinuousLearningLegacyFact {
  id: string;
  title?: string;
  content: string;
  kind?: string;
  confidence?: number;
  evidence?: string[];
  count?: number;
  scope?: string;
}

export interface ContinuousLearningLegacyInstinct {
  id: string;
  trigger: string;
  action: string;
  confidence?: number;
  evidence?: string[];
  count?: number;
  scope?: string;
  approved?: boolean;
  durableApproved?: boolean;
}

export interface ContinuousLearningDirectoryImport {
  facts: ContinuousLearningLegacyFact[];
  instincts: ContinuousLearningLegacyInstinct[];
  warnings: string[];
}

export interface MapContinuousLearningFactInput {
  fact: ContinuousLearningLegacyFact;
  workspaceId: string;
  sessionId?: string;
  projectSlug?: string;
}

export interface MapContinuousLearningInstinctInput {
  instinct: ContinuousLearningLegacyInstinct;
  workspaceId: string;
  sessionId?: string;
}

export interface ImportedContinuousLearningFact extends ObservationInput {
  legacySource: typeof LEGACY_SOURCE;
  legacyId: string;
  provenance: {
    source: typeof LEGACY_SOURCE;
    legacyId: string;
    projectSlug?: string;
    evidence: string[];
    count?: number;
  };
  deleteLegacy: false;
}

export interface ImportedContinuousLearningInstinct extends InstinctCandidateInput {
  legacySource: typeof LEGACY_SOURCE;
  legacyId: string;
  reviewed: false;
  needsReview: true;
  provenance: {
    source: typeof LEGACY_SOURCE;
    legacyId: string;
    evidence: string[];
    count?: number;
    legacyApproved?: boolean;
    durableApproved: boolean;
  };
  deleteLegacy: false;
}

export async function loadContinuousLearningDirectory(rootPath: string): Promise<ContinuousLearningDirectoryImport> {
  const facts: ContinuousLearningLegacyFact[] = [];
  const instincts: ContinuousLearningLegacyInstinct[] = [];
  const warnings: string[] = [];

  for (const file of ["facts.json", "instincts.json", "project/facts.json", "project/instincts.json"]) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(path.join(rootPath, file), "utf8"));
    } catch (error) {
      if (isMissingFileError(error)) continue;
      warnings.push(`${file}: ${errorMessage(error)}`);
      continue;
    }

    const records = recordsFromJson(parsed, file);
    if (file.endsWith("facts.json")) facts.push(...records.map((record) => normalizeFactRecord(record, file)));
    else instincts.push(...records.map(normalizeInstinctRecord));
  }

  return { facts, instincts, warnings };
}

export function mapContinuousLearningFact(input: MapContinuousLearningFactInput): ImportedContinuousLearningFact {
  const legacyId = requireNonEmpty(input.fact.id, "fact.id");
  const factContent = scrubSecrets(requireNonEmpty(input.fact.content, "fact.content"));
  const evidence = scrubEvidence(input.fact.evidence);
  const kind = normalizeFactKind(input.fact.kind);
  const contentParts = [
    factContent,
    evidence.length > 0 ? `Evidence: ${evidence.join("; ")}` : "",
    `Legacy source: ${LEGACY_SOURCE}`,
    `Legacy id: ${legacyId}`,
  ].filter(Boolean);

  return {
    id: importId(LEGACY_SOURCE, legacyId),
    workspaceId: requireNonEmpty(input.workspaceId, "workspaceId"),
    sessionId: input.sessionId,
    kind,
    scope: normalizeScope(input.fact.scope),
    title: scrubSecrets(input.fact.title?.trim() || titleFromContent(factContent), { maxChars: 120 }),
    content: contentParts.join("\n"),
    sourceEventIds: [`${LEGACY_SOURCE}:${legacyId}`],
    tags: uniqueStrings(["imported", LEGACY_SOURCE, kind, `legacy:${legacyId}`, input.projectSlug ? `project:${input.projectSlug}` : ""]),
    confidence: clamp01(input.fact.confidence, 0.6),
    trust: 0.6,
    status: "needs_review" as MemoryStatus,
    hindsightDocumentId: createImportDocumentId(LEGACY_SOURCE, legacyId),
    legacySource: LEGACY_SOURCE,
    legacyId,
    provenance: {
      source: LEGACY_SOURCE,
      legacyId,
      projectSlug: input.projectSlug,
      evidence,
      count: input.fact.count,
    },
    deleteLegacy: false,
  };
}

export function mapContinuousLearningInstinct(input: MapContinuousLearningInstinctInput): ImportedContinuousLearningInstinct {
  const legacyId = requireNonEmpty(input.instinct.id, "instinct.id");
  const trigger = scrubSecrets(requireNonEmpty(input.instinct.trigger, "instinct.trigger"), { maxChars: 400 });
  const action = scrubSecrets(requireNonEmpty(input.instinct.action, "instinct.action"), { maxChars: 600 });
  const evidence = scrubEvidence(input.instinct.evidence);
  const durableApproved = input.instinct.durableApproved === true;

  return {
    id: importId(LEGACY_SOURCE, legacyId),
    workspaceId: requireNonEmpty(input.workspaceId, "workspaceId"),
    sessionId: input.sessionId,
    kind: "behavior_instinct",
    trigger,
    action,
    content: `${trigger}\n${action}\nLegacy source: ${LEGACY_SOURCE}\nLegacy id: ${legacyId}`,
    evidenceObservationIds: evidence.map((_, index) => `${importId(LEGACY_SOURCE, legacyId)}_evidence_${index + 1}`),
    confidence: clamp01(input.instinct.confidence, 0.5),
    status: (durableApproved ? "working" : "needs_review") as MemoryStatus,
    durableApproved,
    legacySource: LEGACY_SOURCE,
    legacyId,
    reviewed: false,
    needsReview: true,
    provenance: {
      source: LEGACY_SOURCE,
      legacyId,
      evidence,
      count: input.instinct.count,
      legacyApproved: input.instinct.approved,
      durableApproved,
    },
    deleteLegacy: false,
  };
}

function normalizeFactRecord(record: JsonRecord, file: string): ContinuousLearningLegacyFact {
  return {
    ...record,
    id: requireNonEmpty(String(record.id ?? record.key ?? record.name ?? ""), "fact.id"),
    content: String(record.content ?? record.text ?? record.value ?? ""),
    scope: typeof record.scope === "string" ? record.scope : file.startsWith("project/") ? "project" : undefined,
  } as ContinuousLearningLegacyFact;
}

function normalizeInstinctRecord(record: JsonRecord): ContinuousLearningLegacyInstinct {
  return {
    ...record,
    id: requireNonEmpty(String(record.id ?? record.key ?? record.name ?? ""), "instinct.id"),
    trigger: String(record.trigger ?? ""),
    action: String(record.action ?? ""),
  } as ContinuousLearningLegacyInstinct;
}

function recordsFromJson(value: unknown, file: string): JsonRecord[] {
  const values = Array.isArray(value)
    ? value
    : isRecord(value)
      ? Object.entries(value).map(([id, record]) => isRecord(record) ? { id, ...record } : { id, content: record })
      : [];
  return values.filter(isRecord).map((record, index) => ({ id: record.id ?? `${file}:${index + 1}`, ...record }));
}

function normalizeFactKind(kind: string | undefined): "project_fact" | "environment_fact" {
  return kind === "environment_fact" || kind === "environment" ? "environment_fact" : "project_fact";
}

function normalizeScope(scope: string | undefined): string {
  const normalized = scope?.trim().toLowerCase();
  return normalized === "global" || normalized === "personal" ? normalized : "project";
}

function scrubEvidence(evidence: string[] | undefined): string[] {
  return uniqueStrings((evidence ?? []).map((item) => scrubSecrets(item, { maxChars: 220 })));
}

function titleFromContent(content: string): string {
  return truncateText(content.replace(/\s+/g, " ").trim(), 100);
}

function clamp01(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(1, value));
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

function isMissingFileError(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}

function isRecord(value: unknown): value is JsonRecord {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
