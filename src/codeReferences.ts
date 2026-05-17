import { createHash } from "node:crypto";
import path from "node:path";
import { truncateText } from "./scrub.js";

export type ArtifactReferenceType = "code_reference" | "doc_reference" | "config_reference" | "test_reference";

export interface ArtifactReference {
  id: string;
  path: string;
  artifactType: ArtifactReferenceType;
  sourceEventId: string;
  provenanceDigest: string;
  lineStart?: number;
  lineEnd?: number;
}

export interface ExtractArtifactReferencesInput {
  text: string;
  workspaceRoot: string;
  sourceEventId: string;
  allowedExtensions?: string[];
  maxReferences?: number;
}

const DEFAULT_MAX_REFERENCES = 3;
const DEFAULT_ALLOWED_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".json",
  ".md",
  ".py",
  ".rs",
  ".go",
  ".sql",
  ".yaml",
  ".yml",
  ".toml",
]);
const CONFIG_FILES = new Set([
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "vite.config.ts",
  "vitest.config.ts",
  "eslint.config.js",
  ".eslintrc",
  ".gitignore",
  "Dockerfile",
]);

function digest(text: string, length = 16): string {
  return createHash("sha256").update(text).digest("hex").slice(0, length);
}

function normalizeSlashes(value: string): string {
  return value.replace(/\\/g, "/");
}

function trimCandidate(value: string): string {
  return value.replace(/^[`'"(\[{<]+/, "").replace(/[`'"),\]}>.;]+$/, "");
}

function parseLineSuffix(candidate: string): { rawPath: string; lineStart?: number; lineEnd?: number } {
  const match = /^(.*?):(\d+)(?:-(\d+))?$/.exec(candidate);
  if (!match) return { rawPath: candidate };
  return {
    rawPath: match[1] ?? candidate,
    lineStart: Number(match[2]),
    lineEnd: match[3] ? Number(match[3]) : undefined,
  };
}

function normalizeCandidatePath(rawPath: string, workspaceRoot: string): string | null {
  const normalizedRaw = normalizeSlashes(rawPath);
  const normalizedRoot = normalizeSlashes(path.resolve(workspaceRoot));

  if (path.isAbsolute(normalizedRaw)) {
    const resolved = normalizeSlashes(path.resolve(normalizedRaw));
    const relative = normalizeSlashes(path.relative(normalizedRoot, resolved));
    if (relative.startsWith("..") || path.isAbsolute(relative) || relative === "") return null;
    return relative;
  }

  if (normalizedRaw.startsWith("../") || normalizedRaw === ".." || normalizedRaw.includes("/../")) return null;
  if (normalizedRaw.startsWith("./")) return normalizedRaw.slice(2);
  return normalizedRaw;
}

function extensionOf(filePath: string): string {
  return path.extname(filePath).toLowerCase();
}

function isAllowed(filePath: string, allowedExtensions?: string[]): boolean {
  const baseName = path.basename(filePath);
  if (CONFIG_FILES.has(baseName)) return true;
  const allowed = allowedExtensions ? new Set(allowedExtensions.map((ext) => ext.toLowerCase())) : DEFAULT_ALLOWED_EXTENSIONS;
  return allowed.has(extensionOf(filePath));
}

export function classifyArtifactPath(filePath: string): ArtifactReferenceType {
  const normalized = normalizeSlashes(filePath).toLowerCase();
  const baseName = path.basename(normalized);
  if (normalized.includes("/test/") || normalized.includes("/tests/") || /(?:^|[.-])(test|spec)\.[^.]+$/.test(baseName)) {
    return "test_reference";
  }
  if (CONFIG_FILES.has(path.basename(filePath)) || [".json", ".yaml", ".yml", ".toml"].includes(extensionOf(normalized))) {
    return "config_reference";
  }
  if (extensionOf(normalized) === ".md" || normalized.startsWith("docs/") || normalized.includes("/docs/")) {
    return "doc_reference";
  }
  return "code_reference";
}

function provenanceFor(text: string, rawCandidate: string): string {
  const index = text.indexOf(rawCandidate);
  if (index < 0) return truncateText(text.replace(/\s+/g, " ").trim(), 140);
  const start = Math.max(0, index - 45);
  const end = Math.min(text.length, index + rawCandidate.length + 45);
  return truncateText(text.slice(start, end).replace(/\s+/g, " ").trim(), 140);
}

export function extractArtifactReferences(input: ExtractArtifactReferencesInput): ArtifactReference[] {
  const maxReferences = Math.max(0, input.maxReferences ?? DEFAULT_MAX_REFERENCES);
  if (maxReferences === 0) return [];

  const refs: ArtifactReference[] = [];
  const seen = new Set<string>();
  const candidatePattern = /(?:[A-Za-z]:)?(?:\.{0,2}\/|\/)?(?:[A-Za-z0-9_.@-]+\/)*[A-Za-z0-9_.@-]+\.[A-Za-z0-9]+(?::\d+(?:-\d+)?)?/g;
  const matches = input.text.matchAll(candidatePattern);

  for (const match of matches) {
    const rawCandidate = trimCandidate(match[0]);
    const parsed = parseLineSuffix(rawCandidate);
    const relativePath = normalizeCandidatePath(parsed.rawPath, input.workspaceRoot);
    if (!relativePath || !isAllowed(relativePath, input.allowedExtensions)) continue;

    const normalizedPath = normalizeSlashes(relativePath);
    if (seen.has(normalizedPath)) continue;
    seen.add(normalizedPath);

    refs.push({
      id: `art_${digest(`${input.sourceEventId}:${normalizedPath}`)}`,
      path: normalizedPath,
      artifactType: classifyArtifactPath(normalizedPath),
      sourceEventId: input.sourceEventId,
      provenanceDigest: provenanceFor(input.text, rawCandidate),
      lineStart: parsed.lineStart,
      lineEnd: parsed.lineEnd,
    });

    if (refs.length >= maxReferences) break;
  }

  return refs;
}

export function summarizeArtifactReference(reference: ArtifactReference): string {
  const lineSuffix = reference.lineStart == null
    ? ""
    : `:${reference.lineStart}${reference.lineEnd == null ? "" : `-${reference.lineEnd}`}`;
  return truncateText(`${reference.path}${lineSuffix} (${reference.artifactType}) from ${reference.sourceEventId}`, 220);
}
