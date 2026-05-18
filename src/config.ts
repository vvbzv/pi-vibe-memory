import path from "node:path";
import { readFile } from "node:fs/promises";

export type VibeMemoryMode = "owner" | "passive" | "toolsOnly";
export type CaptureToolOutput = "off" | "errors" | "summaries";
export type HindsightBudget = "low" | "mid" | "high";
export type HindsightConfigSource = "rest" | "mcp";
export type HindsightRecallScope = "vibeOnly" | "bankWide" | "hybrid";
export type VibeMemoryCompactionMode = "off" | "owner";

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
  configWarnings: string[];
  compaction: {
    enabled: boolean;
    mode: VibeMemoryCompactionMode;
    maxSummaryChars: number;
    maxObservations: number;
    maxInstincts: number;
    maxFacts: number;
    maxArtifacts: number;
    maxRevisions: number;
    includePreviousSummary: boolean;
    includeFileOps: boolean;
    failOpen: boolean;
  };
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
    source: HindsightConfigSource;
    baseUrl: string;
    apiKeyEnv?: string;
    apiKey?: string;
    bank: string;
    workspaceBank?: string;
    personalBank?: string;
    mcpServer: string;
    recallScope: HindsightRecallScope;
    bankWideLimit: number;
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
  configWarnings: [],
  compaction: {
    enabled: true,
    mode: "owner",
    maxSummaryChars: 8000,
    maxObservations: 8,
    maxInstincts: 4,
    maxFacts: 6,
    maxArtifacts: 6,
    maxRevisions: 3,
    includePreviousSummary: true,
    includeFileOps: true,
    failOpen: true,
  },
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
    source: "rest",
    baseUrl: "http://localhost:8888",
    bank: "pi",
    mcpServer: "hindsight",
    recallScope: "hybrid",
    bankWideLimit: 1,
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

function validateDbPath(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim()) throw new Error("dbPath must be a safe relative path");
  const trimmed = value.trim();
  if (path.isAbsolute(trimmed) || trimmed.split(/[\/]+/).includes("..")) throw new Error("dbPath must be a safe relative path");
  return trimmed;
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
    dbPath: validateDbPath(merged.dbPath),
    promptBudgetChars: assertPositiveInteger("promptBudgetChars", merged.promptBudgetChars),
    localObservationLimit: assertPositiveInteger("localObservationLimit", merged.localObservationLimit),
    hindsightRecallLimit: assertPositiveInteger("hindsightRecallLimit", merged.hindsightRecallLimit),
    captureToolOutput,
    captureRawPrompts: merged.captureRawPrompts === true,
    ignoredPathPatterns: optionalStringArray("ignoredPathPatterns", merged.ignoredPathPatterns),
    strictSingleOwner: merged.strictSingleOwner === true,
    configWarnings: optionalStringArray("configWarnings", merged.configWarnings),
    compaction: {
      ...merged.compaction,
      enabled: merged.compaction.enabled !== false,
      mode: assertOneOf("compaction.mode", merged.compaction.mode, ["off", "owner"]),
      maxSummaryChars: assertPositiveInteger("compaction.maxSummaryChars", merged.compaction.maxSummaryChars),
      maxObservations: assertPositiveInteger("compaction.maxObservations", merged.compaction.maxObservations),
      maxInstincts: assertPositiveInteger("compaction.maxInstincts", merged.compaction.maxInstincts),
      maxFacts: assertPositiveInteger("compaction.maxFacts", merged.compaction.maxFacts),
      maxArtifacts: assertPositiveInteger("compaction.maxArtifacts", merged.compaction.maxArtifacts),
      maxRevisions: assertPositiveInteger("compaction.maxRevisions", merged.compaction.maxRevisions),
      includePreviousSummary: merged.compaction.includePreviousSummary !== false,
      includeFileOps: merged.compaction.includeFileOps !== false,
      failOpen: merged.compaction.failOpen !== false,
    },
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
      source: assertOneOf("hindsight.source", merged.hindsight.source, ["rest", "mcp"]),
      mcpServer: typeof merged.hindsight.mcpServer === "string" && merged.hindsight.mcpServer.trim() ? merged.hindsight.mcpServer.trim() : "hindsight",
      recallScope: assertOneOf("hindsight.recallScope", merged.hindsight.recallScope, ["vibeOnly", "bankWide", "hybrid"]),
      bankWideLimit: assertNonNegativeInteger("hindsight.bankWideLimit", merged.hindsight.bankWideLimit),
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

export interface LoadVibeMemorySettingsOptions {
  agentDir?: string;
  mcpConfigPath?: string;
}

export async function loadVibeMemorySettingsFromFiles(paths: string[], options: LoadVibeMemorySettingsOptions = {}): Promise<NormalizedVibeMemorySettings> {
  let raw: JsonObject = {};
  for (const filePath of paths) {
    const json = await readJsonObject(filePath);
    raw = mergePlain(raw, isPlainObject(json.vibeMemory) ? json.vibeMemory : {});
  }

  let settings = normalizeSettings(raw);
  if (settings.hindsight.enabled && settings.hindsight.source === "mcp") {
    settings = await applyMcpHindsightSettings(settings, options);
  } else if (settings.hindsight.enabled && settings.hindsight.source === "rest") {
    settings = await warnIfMcpHindsightExists(settings, options);
  }
  return settings;
}

async function applyMcpHindsightSettings(
  settings: NormalizedVibeMemorySettings,
  options: LoadVibeMemorySettingsOptions,
): Promise<NormalizedVibeMemorySettings> {
  const mcpPath = options.mcpConfigPath ?? path.join(options.agentDir ?? defaultAgentDir(), "mcp.json");
  const mcpJson = await readJsonObject(mcpPath);
  const servers = isPlainObject(mcpJson.mcpServers) ? mcpJson.mcpServers : {};
  const server = servers[settings.hindsight.mcpServer];
  if (!isPlainObject(server)) {
    return {
      ...settings,
      configWarnings: [
        ...settings.configWarnings,
        `Hindsight MCP source requested but server "${settings.hindsight.mcpServer}" was not found; Hindsight disabled instead of falling back to localhost.`,
      ],
      hindsight: { ...settings.hindsight, enabled: false },
    };
  }

  const url = typeof server.url === "string" ? server.url : undefined;
  const baseUrl = url ? deriveRestBaseUrl(url) : settings.hindsight.baseUrl;
  const token = extractBearerToken(server.headers);
  const bankFromPath = url ? deriveBankFromMcpUrl(url) : undefined;

  return {
    ...settings,
    hindsight: {
      ...settings.hindsight,
      baseUrl,
      apiKey: token ?? settings.hindsight.apiKey,
      bank: settings.hindsight.bank === DEFAULT_SETTINGS.hindsight.bank && bankFromPath ? bankFromPath : settings.hindsight.bank,
    },
  };
}

async function warnIfMcpHindsightExists(
  settings: NormalizedVibeMemorySettings,
  options: LoadVibeMemorySettingsOptions,
): Promise<NormalizedVibeMemorySettings> {
  if (settings.hindsight.baseUrl !== DEFAULT_SETTINGS.hindsight.baseUrl) return settings;
  const mcpPath = options.mcpConfigPath ?? path.join(options.agentDir ?? defaultAgentDir(), "mcp.json");
  const mcpJson = await readJsonObject(mcpPath);
  const servers = isPlainObject(mcpJson.mcpServers) ? mcpJson.mcpServers : {};
  if (!isPlainObject(servers[settings.hindsight.mcpServer])) return settings;

  return {
    ...settings,
    configWarnings: [
      ...settings.configWarnings,
      `Hindsight MCP server "${settings.hindsight.mcpServer}" is configured, but vibeMemory.hindsight.source is "rest" with default ${DEFAULT_SETTINGS.hindsight.baseUrl}; set hindsight.source="mcp" to reuse the MCP server instead of localhost.`,
    ],
  };
}

function deriveRestBaseUrl(rawUrl: string): string {
  const parsed = new URL(rawUrl);
  const mcpIndex = parsed.pathname.indexOf("/mcp/");
  parsed.pathname = mcpIndex >= 0 ? parsed.pathname.slice(0, mcpIndex) || "/" : "/";
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/+$/, "");
}

function deriveBankFromMcpUrl(rawUrl: string): string | undefined {
  const parsed = new URL(rawUrl);
  const segments = parsed.pathname.split("/").filter(Boolean);
  const mcpIndex = segments.indexOf("mcp");
  const bank = mcpIndex >= 0 ? segments[mcpIndex + 1] : undefined;
  return bank ? decodeURIComponent(bank) : undefined;
}

function extractBearerToken(headers: unknown): string | undefined {
  if (!isPlainObject(headers)) return undefined;
  const authorization = headers.Authorization ?? headers.authorization;
  if (typeof authorization !== "string") return undefined;
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || undefined;
}

function defaultAgentDir(): string {
  return process.env.PI_CODING_AGENT_DIR || path.join(process.env.HOME || process.cwd(), ".pi", "agent");
}

export type MemoryOwnerIssueReport = {
  conflicts: string[];
  warnings: string[];
};

export function detectMemoryOwnerIssues(settingsJson: JsonObject): MemoryOwnerIssueReport {
  const conflicts: string[] = [];
  const warnings: string[] = [];
  const packages = Array.isArray(settingsJson.packages) ? settingsJson.packages.map(String) : [];
  const hasPackage = (needle: string) => packages.some((entry) => entry.toLowerCase().includes(needle.toLowerCase()));
  const strictSingleOwner = isPlainObject(settingsJson.vibeMemory) && settingsJson.vibeMemory.strictSingleOwner === true;

  const observationalMemory = settingsJson["observational-memory"];
  const hasObservationalConfig = isPlainObject(observationalMemory);
  const observationalPassive = hasObservationalConfig && observationalMemory.passive === true;
  const observationalActive = hasObservationalConfig && observationalMemory.passive !== true;
  const observationalInstalled = hasPackage("pi-observational-memory");

  if (observationalInstalled && !observationalPassive) {
    conflicts.push("pi-observational-memory is installed and active; set observational-memory.passive=true or remove npm:pi-observational-memory.");
  } else if (!observationalInstalled && observationalActive) {
    const message = strictSingleOwner
      ? "Stale observational-memory settings remain in ~/.pi/agent/settings.json with passive:false and strictSingleOwner=true; set observational-memory.passive=true or remove that block."
      : "Stale observational-memory settings remain in ~/.pi/agent/settings.json with passive:false, but npm:pi-observational-memory is not installed; set observational-memory.passive=true or remove that block.";
    (strictSingleOwner ? conflicts : warnings).push(message);
  }

  const continuousLearning = settingsJson.continuousLearning;
  const continuousLearningDisabled = isPlainObject(continuousLearning) && continuousLearning.enabled === false;
  if ((hasPackage("pi-continuous-learning") && !continuousLearningDisabled) || (isPlainObject(continuousLearning) ? continuousLearning.enabled !== false : Boolean(continuousLearning))) {
    conflicts.push("pi-continuous-learning may inject competing learned behavior; disable or remove it.");
  }

  if (hasPackage("lapis")) {
    conflicts.push("LaPis is installed; avoid enabling duplicate automatic memory injection.");
  }

  return { conflicts, warnings };
}

export function detectConflicts(settingsJson: JsonObject): string[] {
  return detectMemoryOwnerIssues(settingsJson).conflicts;
}
