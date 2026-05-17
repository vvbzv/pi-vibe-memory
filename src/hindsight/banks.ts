import { createHash } from "node:crypto";

export const DEFAULT_BANK_ID = "pi";
export const BASE_HINDSIGHT_TAGS = ["pi", "pi-vibe-memory"] as const;

export function normalizeBankId(bankId: string | undefined): string {
  const trimmed = bankId?.trim();
  return trimmed || DEFAULT_BANK_ID;
}

export function createSessionDocumentId(sessionId: string): string {
  return `pi-session:${sessionId}`;
}

export function createObservationDocumentId(observationId: string): string {
  return `pi-observation:${observationId}`;
}

export function createPreferenceDocumentId(normalizedKey: string): string {
  return `pi-preference:${slugify(normalizedKey)}`;
}

export function createDecisionDocumentId(workspaceId: string, content: string): string {
  return `pi-decision:${slugify(workspaceId)}:${shortHash(content)}`;
}

export function createImportDocumentId(source: string, legacyId: string): string {
  return `pi-import:${slugify(source)}:${legacyId}`;
}

export function createArtifactDocumentId(workspaceId: string, artifactPath: string): string {
  return `pi-artifact:${slugify(workspaceId)}:${shortHash(artifactPath)}`;
}

export function buildHindsightTags(input: {
  projectSlug?: string;
  workspaceId?: string;
  sessionId?: string;
  kinds?: string[];
  artifactPathHash?: string;
} = {}): string[] {
  return uniqueTags([
    ...BASE_HINDSIGHT_TAGS,
    input.projectSlug ? `project:${slugify(input.projectSlug)}` : undefined,
    input.workspaceId ? `workspace:${input.workspaceId}` : undefined,
    input.sessionId ? `session:${input.sessionId}` : undefined,
    ...(input.kinds ?? []),
    input.artifactPathHash ? `artifact:${input.artifactPathHash}` : undefined,
  ]);
}

export function createPathHash(artifactPath: string): string {
  return shortHash(artifactPath);
}

function uniqueTags(tags: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of tags) {
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
  }
  return out;
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "unknown";
}

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}
