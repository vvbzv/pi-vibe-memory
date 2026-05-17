import { createArtifactDocumentId, createImportDocumentId } from "../hindsight/banks.js";
import { classifyArtifactPath } from "../codeReferences.js";
import { scrubSecrets, truncateText } from "../scrub.js";
import type { ArtifactReferenceInput, MemoryStatus, ObservationInput } from "../storage/repository.js";

const LEGACY_SOURCE = "lapis" as const;
const BULK_GRAPH_KINDS = new Set([
  "graph",
  "call_graph",
  "import_graph",
  "dependency_graph",
  "code_graph",
  "dead_code",
  "cycles",
  "hotspots",
  "complexity",
]);

export interface LapisLegacyArtifact {
  id: string;
  path: string;
  kind?: string;
  summary?: string;
  content?: string;
  trust?: number;
  confidence?: number;
  sourceIds?: string[];
  symbol?: string;
  lineStart?: number;
  lineEnd?: number;
}

export interface MapLapisArtifactInput {
  artifact: LapisLegacyArtifact;
  workspaceId: string;
  sessionId?: string;
}

export interface ImportedLapisObservation extends ObservationInput {
  legacySource: typeof LEGACY_SOURCE;
  legacyId: string;
  provenance: {
    source: typeof LEGACY_SOURCE;
    legacyId: string;
    importMode: "selected_artifact_only";
    bulkGraphImport: false;
    trust?: number;
  };
  deleteLegacy: false;
}

export interface ImportedLapisArtifact {
  observation: ImportedLapisObservation;
  artifactReference: ArtifactReferenceInput;
  provenance: {
    source: typeof LEGACY_SOURCE;
    legacyId: string;
    importMode: "selected_artifact_only";
    bulkGraphImport: false;
  };
  deleteLegacy: false;
}

export function mapLapisArtifact(input: MapLapisArtifactInput): ImportedLapisArtifact {
  const legacyId = requireNonEmpty(input.artifact.id, "artifact.id");
  const kind = input.artifact.kind?.trim().toLowerCase();
  if (kind && BULK_GRAPH_KINDS.has(kind)) {
    throw new Error("LaPis importer accepts selected artifacts only; bulk graph imports are not supported");
  }

  const workspaceId = requireNonEmpty(input.workspaceId, "workspaceId");
  const artifactPath = normalizeRelativePath(input.artifact.path);
  const artifactType = artifactTypeFor(kind, artifactPath);
  const summary = scrubSecrets(input.artifact.summary || input.artifact.content || `Selected LaPis artifact reference for ${artifactPath}`);
  const observationId = importId(LEGACY_SOURCE, legacyId);
  const sourceEventIds = uniqueStrings([`${LEGACY_SOURCE}:${legacyId}`, ...(input.artifact.sourceIds ?? [])]);

  const observation: ImportedLapisObservation = {
    id: observationId,
    workspaceId,
    sessionId: input.sessionId,
    kind: artifactType,
    scope: "project",
    title: truncateText(`${artifactPath}: ${summary.replace(/\s+/g, " ").trim()}`, 120),
    content: summary,
    sourceEventIds,
    tags: uniqueStrings(["imported", LEGACY_SOURCE, artifactType, "selected_artifact_only"]),
    confidence: clamp01(input.artifact.confidence, 0.55),
    trust: clamp01(input.artifact.trust, 0.55),
    status: "needs_review" as MemoryStatus,
    hindsightDocumentId: createImportDocumentId(LEGACY_SOURCE, legacyId),
    legacySource: LEGACY_SOURCE,
    legacyId,
    provenance: {
      source: LEGACY_SOURCE,
      legacyId,
      importMode: "selected_artifact_only",
      bulkGraphImport: false,
      trust: input.artifact.trust,
    },
    deleteLegacy: false,
  };

  return {
    observation,
    artifactReference: {
      id: createArtifactDocumentId(workspaceId, artifactPath),
      workspaceId,
      sessionId: input.sessionId,
      observationId,
      path: artifactPath,
      artifactType,
      symbol: input.artifact.symbol,
      lineStart: input.artifact.lineStart,
      lineEnd: input.artifact.lineEnd,
      sourceEventIds,
    },
    provenance: {
      source: LEGACY_SOURCE,
      legacyId,
      importMode: "selected_artifact_only",
      bulkGraphImport: false,
    },
    deleteLegacy: false,
  };
}

function artifactTypeFor(kind: string | undefined, artifactPath: string): string {
  switch (kind) {
    case "code":
    case "code_reference":
      return "code_reference";
    case "doc":
    case "docs":
    case "doc_reference":
      return "doc_reference";
    case "config":
    case "config_reference":
      return "config_reference";
    case "test":
    case "test_reference":
      return "test_reference";
    default:
      return classifyArtifactPath(artifactPath);
  }
}

function normalizeRelativePath(value: string): string {
  const normalized = requireNonEmpty(value, "artifact.path").replace(/\\/g, "/");
  if (normalized.startsWith("/") || normalized.startsWith("../") || normalized === ".." || normalized.includes("/../")) {
    throw new Error("artifact.path must be a selected relative artifact path");
  }
  return normalized.startsWith("./") ? normalized.slice(2) : normalized;
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
