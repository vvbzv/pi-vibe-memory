import { readFile } from "node:fs/promises";

export type VibeMemoryMode = "owner" | "passive" | "toolsOnly";
export type CaptureToolOutput = "off" | "errors" | "summaries";
export type HindsightBudget = "low" | "mid" | "high";

export interface NormalizedVibeMemorySettings {
  enabled: boolean;
  mode: VibeMemoryMode;
  dbPath?: string;
  promptBudgetChars: number;
  localObservationLimit: number;
  hindsightRecallLimit: number;
  captureToolOutput: CaptureToolOutput;
  captureRawPrompts: boolean;
  ignoredPathPatterns: string[];
  strictSingleOwner: boolean;
  codeReferences: {
    enabled: boolean;
    maxPerPrompt: number;
    captureFromToolResults: boolean;
    allowedExtensions: string[];
  };
  meditation: {
    enabled: boolean;
    mode: "off" | "manual" | "passive";
    minObservations: number;
    minIntervalMinutes: number;
    timeoutMs: number;
    budget: HindsightBudget;
    maxCandidates: number;
    sameSession: boolean;
  };
  instincts: {
    enabled: boolean;
    requireApprovalForDurable: boolean;
    minEvidence: number;
    maxPromptItems: number;
  };
  revision: {
    enabled: boolean;
    maxPromptItems: number;
  };
  hindsight: {
    enabled: boolean;
    baseUrl: string;
    apiKeyEnv?: string;
    apiKey?: string;
    bank: string;
    workspaceBank?: string;
    personalBank?: string;
    defaultBudget: HindsightBudget;
    timeoutMs: number;
  };
  sync: {
    enabled: boolean;
    debounceMs: number;
    maxBatchItems: number;
    asyncRetainThreshold: number;
  };
}

type JsonObject = Record<string, unknown>;

export const DEFAULT_SETTINGS: NormalizedVibeMemorySettings = {
  enabled: true,
  mode: "owner",
  promptBudgetChars: 3500,
  localObservationLimit: 4,
  hindsightRecallLimit: 4,
  captureToolOutput: "errors",
  captureRawPrompts: false,
  ignoredPathPatterns: [],
  strictSingleOwner: false,
  codeReferences: {
    enabled: true,
    maxPerPrompt: 2,
    captureFromToolResults: true,
    allowedExtensions: [
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
    ],
  },
  meditation: {
    enabled: true,
    mode: "passive",
    minObservations: 12,
    minIntervalMinutes: 20,
    timeoutMs: 5000,
    budget: "low",
    maxCandidates: 5,
    sameSession: true,
  },
  instincts: {
    enabled: true,
    requireApprovalForDurable: true,
    minEvidence: 3,
    maxPromptItems: 2,
  },
  revision: {
    enabled: true,
    maxPromptItems: 1,
  },
  hindsight: {
    enabled: true,
    baseUrl: "http://localhost:8888",
    bank: "pi",
    defaultBudget: "low",
    timeoutMs: 1500,
  },
  sync: {
    enabled: true,
    debounceMs: 1500,
    maxBatchItems: 25,
    asyncRetainThreshold: 10,
  },
};

function assertPositiveInteger(name: string, value: unknown): number {
  if (!Number.isInteger(value) || Number(value) <= 0) throw new Error(`${name} must be a positive integer`);
  return Number(value);
}

function assertNonNegativeInteger(name: string, value: unknown): number {
  if (!Number.isInteger(value) || Number(value) < 0) throw new Error(`${name} must be a non-negative integer`);
  return Number(value);
}

function assertOneOf<T extends string>(name: string, value: unknown, allowed: readonly T[]): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) throw new Error(`${name} is invalid`);
  return value as T;
}

function optionalStringArray(name: string, value: unknown): string[] {
  if (value == null) return [];
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`${name} must be an array of strings`);
  }
  return value;
}

function isPlainObject(value: unknown): value is JsonObject {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function mergePlain<T extends JsonObject>(base: T, overlay: JsonObject | undefined): T {
  if (!overlay) return { ...base };
  const out: JsonObject = { ...base };

  for (const [key, value] of Object.entries(overlay)) {
    const baseValue = base[key];
    out[key] = isPlainObject(value) && isPlainObject(baseValue)
      ? mergePlain(baseValue, value)
      : value;
  }

  return out as T;
}

export function normalizeSettings(raw: JsonObject | undefined): NormalizedVibeMemorySettings {
  const merged = mergePlain(DEFAULT_SETTINGS as unknown as JsonObject, raw ?? {}) as unknown as NormalizedVibeMemorySettings;

  const mode = assertOneOf("mode", merged.mode, ["owner", "passive", "toolsOnly"]);
  const captureToolOutput = assertOneOf("captureToolOutput", merged.captureToolOutput, ["off", "errors", "summaries"]);

  return {
    ...merged,
    enabled: merged.enabled !== false,
    mode,
    promptBudgetChars: assertPositiveInteger("promptBudgetChars", merged.promptBudgetChars),
    localObservationLimit: assertPositiveInteger("localObservationLimit", merged.localObservationLimit),
    hindsightRecallLimit: assertPositiveInteger("hindsightRecallLimit", merged.hindsightRecallLimit),
    captureToolOutput,
    captureRawPrompts: merged.captureRawPrompts === true,
    ignoredPathPatterns: optionalStringArray("ignoredPathPatterns", merged.ignoredPathPatterns),
    strictSingleOwner: merged.strictSingleOwner === true,
    codeReferences: {
      ...merged.codeReferences,
      enabled: merged.codeReferences.enabled !== false,
      maxPerPrompt: assertPositiveInteger("codeReferences.maxPerPrompt", merged.codeReferences.maxPerPrompt),
      captureFromToolResults: merged.codeReferences.captureFromToolResults !== false,
      allowedExtensions: optionalStringArray("codeReferences.allowedExtensions", merged.codeReferences.allowedExtensions),
    },
    meditation: {
      ...merged.meditation,
      enabled: merged.meditation.enabled !== false,
      mode: assertOneOf("meditation.mode", merged.meditation.mode, ["off", "manual", "passive"]),
      minObservations: assertPositiveInteger("meditation.minObservations", merged.meditation.minObservations),
      minIntervalMinutes: assertPositiveInteger("meditation.minIntervalMinutes", merged.meditation.minIntervalMinutes),
      timeoutMs: assertPositiveInteger("meditation.timeoutMs", merged.meditation.timeoutMs),
      budget: assertOneOf("meditation.budget", merged.meditation.budget, ["low", "mid", "high"]),
      maxCandidates: assertPositiveInteger("meditation.maxCandidates", merged.meditation.maxCandidates),
      sameSession: merged.meditation.sameSession !== false,
    },
    instincts: {
      ...merged.instincts,
      enabled: merged.instincts.enabled !== false,
      requireApprovalForDurable: merged.instincts.requireApprovalForDurable !== false,
      minEvidence: assertPositiveInteger("instincts.minEvidence", merged.instincts.minEvidence),
      maxPromptItems: assertPositiveInteger("instincts.maxPromptItems", merged.instincts.maxPromptItems),
    },
    revision: {
      ...merged.revision,
      enabled: merged.revision.enabled !== false,
      maxPromptItems: assertPositiveInteger("revision.maxPromptItems", merged.revision.maxPromptItems),
    },
    hindsight: {
      ...merged.hindsight,
      enabled: merged.hindsight.enabled !== false,
      defaultBudget: assertOneOf("hindsight.defaultBudget", merged.hindsight.defaultBudget, ["low", "mid", "high"]),
      timeoutMs: assertPositiveInteger("hindsight.timeoutMs", merged.hindsight.timeoutMs),
    },
    sync: {
      ...merged.sync,
      enabled: merged.sync.enabled !== false,
      debounceMs: assertNonNegativeInteger("sync.debounceMs", merged.sync.debounceMs),
      maxBatchItems: assertPositiveInteger("sync.maxBatchItems", merged.sync.maxBatchItems),
      asyncRetainThreshold: assertPositiveInteger("sync.asyncRetainThreshold", merged.sync.asyncRetainThreshold),
    },
  };
}

async function readJsonObject(filePath: string): Promise<JsonObject> {
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8"));
    return isPlainObject(parsed) ? parsed : {};
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

export async function loadVibeMemorySettingsFromFiles(paths: string[]): Promise<NormalizedVibeMemorySettings> {
  let raw: JsonObject = {};
  for (const filePath of paths) {
    const json = await readJsonObject(filePath);
    raw = mergePlain(raw, isPlainObject(json.vibeMemory) ? json.vibeMemory : {});
  }
  return normalizeSettings(raw);
}

export function detectConflicts(settingsJson: JsonObject): string[] {
  const conflicts: string[] = [];
  const packages = Array.isArray(settingsJson.packages) ? settingsJson.packages.map(String) : [];
  const hasPackage = (needle: string) => packages.some((entry) => entry.toLowerCase().includes(needle.toLowerCase()));

  const observationalMemory = settingsJson["observational-memory"];
  if (hasPackage("pi-observational-memory") || (isPlainObject(observationalMemory) && observationalMemory.passive !== true)) {
    conflicts.push("pi-observational-memory appears active; set observational-memory.passive=true or remove the package.");
  }

  if (hasPackage("pi-continuous-learning") || settingsJson.continuousLearning) {
    conflicts.push("pi-continuous-learning may inject competing learned behavior; disable or remove it.");
  }

  if (hasPackage("lapis")) {
    conflicts.push("LaPis is installed; avoid enabling duplicate automatic memory injection.");
  }

  return conflicts;
}
