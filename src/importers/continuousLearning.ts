import { createImportDocumentId } from "../hindsight/banks.js";
import { scrubSecrets, truncateText } from "../scrub.js";
import type { InstinctCandidateInput, MemoryStatus, ObservationInput } from "../storage/repository.js";

const LEGACY_SOURCE = "pi-continuous-learning" as const;

export interface ContinuousLearningLegacyFact {
  id: string;
  title?: string;
  content: string;
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
  };
  deleteLegacy: false;
}

export function mapContinuousLearningFact(input: MapContinuousLearningFactInput): ImportedContinuousLearningFact {
  const legacyId = requireNonEmpty(input.fact.id, "fact.id");
  const factContent = scrubSecrets(requireNonEmpty(input.fact.content, "fact.content"));
  const evidence = scrubEvidence(input.fact.evidence);
  const content = evidence.length > 0
    ? `${factContent}\nEvidence: ${evidence.join("; ")}`
    : factContent;

  return {
    id: importId(LEGACY_SOURCE, legacyId),
    workspaceId: requireNonEmpty(input.workspaceId, "workspaceId"),
    sessionId: input.sessionId,
    kind: "project_fact",
    scope: normalizeScope(input.fact.scope),
    title: scrubSecrets(input.fact.title?.trim() || titleFromContent(factContent), { maxChars: 120 }),
    content,
    sourceEventIds: [`${LEGACY_SOURCE}:${legacyId}`],
    tags: uniqueStrings(["imported", LEGACY_SOURCE, "project_fact", input.projectSlug ? `project:${input.projectSlug}` : ""]),
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

  return {
    id: importId(LEGACY_SOURCE, legacyId),
    workspaceId: requireNonEmpty(input.workspaceId, "workspaceId"),
    sessionId: input.sessionId,
    kind: "behavior_instinct",
    trigger,
    action,
    content: `${trigger}\n${action}`,
    evidenceObservationIds: evidence.map((_, index) => `${importId(LEGACY_SOURCE, legacyId)}_evidence_${index + 1}`),
    confidence: clamp01(input.instinct.confidence, 0.5),
    status: "needs_review" as MemoryStatus,
    durableApproved: false,
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
    },
    deleteLegacy: false,
  };
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
