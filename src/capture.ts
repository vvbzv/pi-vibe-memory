import { createHash } from "node:crypto";
import { scrubSecrets, truncateText } from "./scrub.js";

export interface CapturedRawEvent {
  id: string;
  sessionId: string;
  entryId?: string;
  parentEntryId?: string;
  kind: "turn_end";
  source: { id: string; kind: "pi_turn" };
  payload: {
    cwd?: string;
    userPrompt?: string;
    userPromptDigest?: string;
    assistantSnippet?: string;
  };
}

export interface CapturedObservationInput {
  id: string;
  kind: "turn_summary";
  title: string;
  content: string;
  sourceEventId: string;
  provenance: { sessionId: string; turnId: string; entryId?: string; parentEntryId?: string };
}

export interface NormalizedTurnEndInput {
  sessionId: string;
  turnId: string;
  entryId?: string;
  parentEntryId?: string;
  cwd?: string;
  userPrompt?: string;
  assistantText?: string;
  captureRawPrompts: boolean;
  maxSnippetChars?: number;
}

export interface NormalizedTurnEndEvent {
  rawEvent: CapturedRawEvent;
  observation: CapturedObservationInput;
}

const TRIVIAL_PROMPTS = new Set([
  "hi",
  "hello",
  "hey",
  "ok",
  "okay",
  "yes",
  "no",
  "thanks",
  "thank you",
  "approve",
  "approved",
  "continue",
  "go on",
]);

function digest(text: string, length = 16): string {
  return createHash("sha256").update(text).digest("hex").slice(0, length);
}

function compactWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function shouldCapturePrompt(text: string | undefined, options: { captureRawPrompts: boolean }): boolean {
  const normalized = compactWhitespace(text ?? "").toLowerCase();
  if (!normalized) return false;
  if (TRIVIAL_PROMPTS.has(normalized)) return false;
  if (normalized.length < 8 && !/[/?]/.test(normalized)) return false;
  return options.captureRawPrompts;
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function normalizeTurnEndEvent(input: NormalizedTurnEndInput): NormalizedTurnEndEvent | null {
  const prompt = compactWhitespace(input.userPrompt ?? "");
  const assistant = compactWhitespace(input.assistantText ?? "");
  const promptCapturable = shouldCapturePrompt(prompt, { captureRawPrompts: input.captureRawPrompts });

  const promptIsTrivial = Boolean(prompt) && !shouldCapturePrompt(prompt, { captureRawPrompts: true });
  if (promptIsTrivial) return null;
  if (!assistant && !promptCapturable) return null;

  const maxSnippetChars = input.maxSnippetChars ?? 600;
  const sourceKey = `${input.sessionId}:${input.turnId}:${input.entryId ?? ""}`;
  const rawEventId = `evt_${digest(sourceKey)}`;
  const scrubbedPrompt = promptCapturable ? scrubSecrets(prompt, { maxChars: maxSnippetChars }) : undefined;
  const scrubbedAssistant = assistant ? scrubSecrets(assistant, { maxChars: maxSnippetChars }) : undefined;
  const titleBase = scrubbedPrompt ? truncateText(scrubbedPrompt, 72) : "Assistant completed a turn";
  const contentParts = [
    scrubbedPrompt ? `User requested: ${truncateText(scrubbedPrompt, maxSnippetChars)}` : undefined,
    scrubbedAssistant ? `Assistant summary: ${scrubbedAssistant}` : undefined,
  ].filter(Boolean);

  const rawEvent: CapturedRawEvent = {
    id: rawEventId,
    sessionId: input.sessionId,
    entryId: input.entryId,
    parentEntryId: input.parentEntryId,
    kind: "turn_end",
    source: { id: input.turnId, kind: "pi_turn" },
    payload: {
      cwd: input.cwd,
      userPrompt: scrubbedPrompt,
      userPromptDigest: prompt ? digest(prompt) : undefined,
      assistantSnippet: scrubbedAssistant,
    },
  };

  return {
    rawEvent,
    observation: {
      id: `obs_${digest(`${rawEventId}:turn_summary`)}`,
      kind: "turn_summary",
      title: `User requested: ${titleBase}`,
      content: truncateText(contentParts.join("\n"), maxSnippetChars),
      sourceEventId: rawEventId,
      provenance: {
        sessionId: input.sessionId,
        turnId: input.turnId,
        entryId: input.entryId,
        parentEntryId: input.parentEntryId,
      },
    },
  };
}
