import type { NormalizedVibeMemorySettings } from "./config.js";
export type MeditationCandidateKind =
  | "reflection_candidate"
  | "instinct_candidate"
  | "preference_candidate"
  | "risk_candidate"
  | "revision_candidate";

export interface MeditationObservationInput {
  id: string;
  title?: string;
  kind?: string;
  content: string;
}

export interface ActiveMemoryInput {
  id: string;
  kind?: string;
  status?: string;
  content: string;
}

export interface ShouldScheduleMeditationInput {
  settings: NormalizedVibeMemorySettings;
  unsummarizedObservationCount: number;
  lastRunAt?: Date | string | null;
  now?: Date;
}

export interface BuildMeditationPromptInput {
  observations: MeditationObservationInput[];
  activeMemories?: ActiveMemoryInput[];
  maxCandidates: number;
  maxObservations?: number;
  maxObservationChars?: number;
  maxActiveMemories?: number;
  maxActiveMemoryChars?: number;
}

export interface ParseMeditationCandidatesInput {
  text: string;
  minEvidence: number;
}

interface ParsedCandidateBase {
  kind: MeditationCandidateKind;
  content?: string;
  evidenceObservationIds: string[];
  confidence?: number;
}

export interface MeditationCandidate extends ParsedCandidateBase {
  status: "working";
  durableApproved: false;
  trigger?: string;
  action?: string;
  oldMemoryId?: string;
  proposedContent?: string;
  whyOldDidNotWork?: string;
  whyNewIsBetter?: string;
}

type JsonObject = Record<string, unknown>;

const CANDIDATE_KINDS = new Set<MeditationCandidateKind>([
  "reflection_candidate",
  "instinct_candidate",
  "preference_candidate",
  "risk_candidate",
  "revision_candidate",
]);

const DEFAULT_MAX_OBSERVATIONS = 12;
const DEFAULT_MAX_OBSERVATION_CHARS = 320;
const DEFAULT_MAX_ACTIVE_MEMORIES = 3;
const DEFAULT_MAX_ACTIVE_MEMORY_CHARS = 320;
const MIN_CONFIDENCE = 0.5;

export function shouldScheduleMeditation(input: ShouldScheduleMeditationInput): boolean {
  const { meditation } = input.settings;
  if (!meditation.enabled || meditation.mode !== "passive" || meditation.sameSession !== true) return false;
  if (input.unsummarizedObservationCount < meditation.minObservations) return false;
  if (!input.lastRunAt) return true;

  const lastRunAtMs = typeof input.lastRunAt === "string" ? Date.parse(input.lastRunAt) : input.lastRunAt.getTime();
  if (!Number.isFinite(lastRunAtMs)) return true;

  const nowMs = (input.now ?? new Date()).getTime();
  const elapsedMinutes = (nowMs - lastRunAtMs) / 60_000;
  return elapsedMinutes >= meditation.minIntervalMinutes;
}

export function buildMeditationPrompt(input: BuildMeditationPromptInput): string {
  const maxCandidates = positiveOrDefault(input.maxCandidates, 3);
  const observations = input.observations
    .slice(0, positiveOrDefault(input.maxObservations, DEFAULT_MAX_OBSERVATIONS))
    .map((observation) => ({
      id: observation.id,
      kind: observation.kind,
      title: observation.title,
      content: truncateText(observation.content, positiveOrDefault(input.maxObservationChars, DEFAULT_MAX_OBSERVATION_CHARS)),
    }));

  const activeMemories = (input.activeMemories ?? [])
    .slice(0, positiveOrDefault(input.maxActiveMemories, DEFAULT_MAX_ACTIVE_MEMORIES))
    .map((memory) => ({
      id: memory.id,
      kind: memory.kind,
      status: memory.status,
      content: truncateText(memory.content, positiveOrDefault(input.maxActiveMemoryChars, DEFAULT_MAX_ACTIVE_MEMORY_CHARS)),
    }));

  const activeMemorySection = activeMemories.length > 0
    ? `
Active memory comparison context:
${JSON.stringify(activeMemories, null, 2)}
When newer evidence is better than an active memory, propose a non-deleting comparative revision_candidate that supersedes the older memory with oldMemoryId, proposedContent, whyOldDidNotWork, and whyNewIsBetter.`
    : "";

  return [
    "Use Hindsight reflect to consolidate recent pi-vibe-memory observations into candidate memories only.",
    "Return strict JSON only, with no markdown and no prose outside the JSON object.",
    `Return at most ${maxCandidates} candidates in this shape:`,
    JSON.stringify({
      candidates: [
        {
          kind: "reflection_candidate | instinct_candidate | preference_candidate | risk_candidate | revision_candidate",
          content: "Short candidate content for non-instinct candidates",
          trigger: "Required for instinct_candidate",
          action: "Required for instinct_candidate",
          oldMemoryId: "Required for revision_candidate",
          proposedContent: "Required for revision_candidate unless content is present",
          whyOldDidNotWork: "Required for revision_candidate",
          whyNewIsBetter: "Required for revision_candidate",
          evidenceObservationIds: ["observation-id"],
          confidence: 0.75,
        },
      ],
    }, null, 2),
    "Rules: evidenceObservationIds is required for every candidate. Instinct candidates need enough evidence to be useful. Output candidates, not commands or durable directives. Do not promote durable memory; approval happens elsewhere.",
    "Recent observations:",
    JSON.stringify(observations, null, 2),
    activeMemorySection,
  ].filter(Boolean).join("\n\n");
}

export function parseMeditationCandidates(input: ParseMeditationCandidatesInput): MeditationCandidate[] {
  const trimmed = input.text.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    throw new Error("Meditation response must be strict JSON object text");
  }

  const parsed = JSON.parse(trimmed) as unknown;
  if (!isObject(parsed) || !Array.isArray(parsed.candidates)) return [];

  const minEvidence = positiveOrDefault(input.minEvidence, 1);
  const candidates: MeditationCandidate[] = [];

  for (const item of parsed.candidates) {
    const candidate = normalizeCandidate(item, minEvidence);
    if (candidate) candidates.push(candidate);
  }

  return candidates;
}

function normalizeCandidate(item: unknown, minEvidence: number): MeditationCandidate | null {
  if (!isObject(item)) return null;
  const kind = typeof item.kind === "string" && CANDIDATE_KINDS.has(item.kind as MeditationCandidateKind)
    ? item.kind as MeditationCandidateKind
    : null;
  if (!kind) return null;

  const evidenceObservationIds = stringArray(item.evidenceObservationIds);
  if (evidenceObservationIds.length === 0) return null;
  if (kind === "instinct_candidate" && evidenceObservationIds.length < minEvidence) return null;

  const confidence = numberOrUndefined(item.confidence);
  if (confidence !== undefined && confidence < MIN_CONFIDENCE) return null;

  const base = {
    kind,
    evidenceObservationIds,
    confidence,
    status: "working" as const,
    durableApproved: false as const,
  };

  if (kind === "instinct_candidate") {
    const trigger = nonEmptyString(item.trigger);
    const action = nonEmptyString(item.action);
    if (!trigger || !action) return null;
    return { ...base, trigger, action, content: `${trigger}\n${action}` };
  }

  if (kind === "revision_candidate") {
    const oldMemoryId = nonEmptyString(item.oldMemoryId);
    const proposedContent = nonEmptyString(item.proposedContent) ?? nonEmptyString(item.content);
    const whyOldDidNotWork = nonEmptyString(item.whyOldDidNotWork);
    const whyNewIsBetter = nonEmptyString(item.whyNewIsBetter);
    if (!oldMemoryId || !proposedContent || !whyOldDidNotWork || !whyNewIsBetter) return null;
    return {
      ...base,
      oldMemoryId,
      proposedContent,
      content: proposedContent,
      whyOldDidNotWork,
      whyNewIsBetter,
    };
  }

  const content = nonEmptyString(item.content);
  if (!content) return null;
  return { ...base, content };
}

function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  if (maxChars <= 1) return "…";
  return `${value.slice(0, maxChars - 1)}…`;
}

function positiveOrDefault(value: unknown, fallback: number): number {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : fallback;
}

function isObject(value: unknown): value is JsonObject {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
