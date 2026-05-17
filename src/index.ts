import path from "node:path";
import { readFile } from "node:fs/promises";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { detectConflicts, loadVibeMemorySettingsFromFiles, type NormalizedVibeMemorySettings } from "./config.js";
import { buildToolDefinitions } from "./tools.js";
import { registerVibeMemoryCommands } from "./commands.js";
import { DEFAULT_DB_RELATIVE_PATH, PACKAGE_NAME } from "./constants.js";
import { openVibeMemoryDb, type VibeMemoryDb } from "./storage/db.js";
import { VibeMemoryRepository } from "./storage/repository.js";
import { HindsightClient } from "./hindsight/client.js";
import { VibeMemoryRuntime } from "./runtime.js";

type UiContext = { cwd?: string; ui?: { notify?: (message: string, level?: "info" | "warn" | "error") => void } };
type HookContext = UiContext;

type RuntimeState = {
  runtime?: VibeMemoryRuntime;
  db?: VibeMemoryDb;
  settings?: NormalizedVibeMemorySettings;
  conflicts: string[];
};

export default function piVibeMemory(pi: ExtensionAPI): void {
  const state: RuntimeState = { conflicts: [] };

  for (const tool of buildToolDefinitions(() => state.runtime)) {
    pi.registerTool(tool as any);
  }
  registerVibeMemoryCommands(pi as any, () => state.runtime);

  (pi as any).on("session_start", async (_event: any, ctx: HookContext) => {
    try {
      const cwd = ctx.cwd ?? process.cwd();
      const settingsPaths = [path.join(getAgentDir(), "settings.json"), path.join(cwd, ".pi", "settings.json")];
      const rawSettings = await readMergedSettings(settingsPaths);
      const settings = await loadVibeMemorySettingsFromFiles(settingsPaths);
      const conflicts = detectConflicts(rawSettings);
      const dbPath = resolveDbPath(settings, cwd);
      const db = openVibeMemoryDb(dbPath);
      const repository = new VibeMemoryRepository(db);
      const workspaceId = workspaceIdFor(cwd);
      const sessionId = sessionIdFor(cwd);

      repository.upsertWorkspace({ id: workspaceId, name: path.basename(cwd) || "workspace", rootPath: cwd });
      repository.startSession({ id: sessionId, workspaceId });

      const hindsight = settings.hindsight.enabled
        ? new HindsightClient({
            baseUrl: settings.hindsight.baseUrl,
            apiKey: settings.hindsight.apiKey,
            apiKeyEnv: settings.hindsight.apiKeyEnv,
            timeoutMs: settings.hindsight.timeoutMs,
          })
        : undefined;

      state.db?.close();
      state.db = db;
      state.settings = settings;
      state.conflicts = conflicts;
      state.runtime = new VibeMemoryRuntime({ settings, repository, hindsight: hindsight as any, workspaceId, sessionId, workspaceRoot: cwd, conflicts });

      for (const conflict of conflicts) notify(ctx, `${PACKAGE_NAME}: competing memory owner detected: ${conflict}`, "warn");
    } catch (error) {
      notify(ctx, `${PACKAGE_NAME}: config/runtime error: ${errorMessage(error)}`, "error");
    }
  });

  (pi as any).on("before_agent_start", async (event: any) => {
    if (!state.runtime) return undefined;
    const result = await state.runtime.beforeAgentStart({
      prompt: String(event?.prompt ?? event?.input ?? ""),
      systemPrompt: String(event?.systemPrompt ?? ""),
    });
    return result.systemPrompt === event?.systemPrompt ? undefined : { systemPrompt: result.systemPrompt };
  });

  (pi as any).on("turn_end", async (event: any, ctx: HookContext) => {
    if (!state.runtime) return;
    try {
      await state.runtime.captureTurnEnd({
        turnId: String(event?.turnId ?? event?.id ?? event?.turnIndex ?? Date.now()),
        entryId: stringOrUndefined(event?.entryId ?? event?.message?.id),
        parentEntryId: stringOrUndefined(event?.parentEntryId),
        cwd: ctx.cwd ?? event?.cwd,
        userPrompt: stringOrUndefined(event?.prompt ?? event?.userPrompt ?? event?.userMessage?.content),
        assistantText: stringOrUndefined(event?.assistantText ?? event?.message?.content ?? event?.content),
      });
    } catch (error) {
      notify(ctx, `${PACKAGE_NAME}: turn capture failed: ${errorMessage(error)}`, "warn");
    }
  });

  (pi as any).on("tool_execution_end", async (event: any, ctx: HookContext) => {
    if (!state.runtime || state.settings?.codeReferences.captureFromToolResults === false) return;
    const text = stringifyToolResult(event);
    if (!text) return;
    try {
      await state.runtime.captureTurnEnd({
        turnId: `tool:${String(event?.toolCallId ?? event?.id ?? Date.now())}`,
        cwd: ctx.cwd ?? event?.cwd,
        assistantText: text,
      });
    } catch (error) {
      notify(ctx, `${PACKAGE_NAME}: tool capture failed: ${errorMessage(error)}`, "warn");
    }
  });

  (pi as any).on("session_shutdown", async () => {
    try {
      await state.runtime?.sync();
    } finally {
      state.db?.close();
      state.db = undefined;
      state.runtime = undefined;
    }
  });
}

async function readMergedSettings(paths: string[]): Promise<Record<string, unknown>> {
  let merged: Record<string, unknown> = {};
  for (const filePath of paths) {
    try {
      const parsed = JSON.parse(await readFile(filePath, "utf8"));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) merged = mergePlain(merged, parsed as Record<string, unknown>);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return merged;
}

function mergePlain(base: Record<string, unknown>, overlay: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    const baseValue = out[key];
    out[key] = isPlainObject(baseValue) && isPlainObject(value) ? mergePlain(baseValue, value) : value;
  }
  return out;
}

function resolveDbPath(settings: NormalizedVibeMemorySettings, cwd: string): string {
  if (settings.dbPath) return path.isAbsolute(settings.dbPath) ? settings.dbPath : path.resolve(cwd, settings.dbPath);
  return path.join(getAgentDir(), DEFAULT_DB_RELATIVE_PATH);
}

function workspaceIdFor(cwd: string): string {
  return `ws_${hash(path.resolve(cwd))}`;
}

function sessionIdFor(cwd: string): string {
  return `session_${hash(`${path.resolve(cwd)}:${process.pid}`)}`;
}

function notify(ctx: UiContext, message: string, level: "info" | "warn" | "error" = "info"): void {
  ctx.ui?.notify?.(message, level);
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function stringifyToolResult(event: any): string | undefined {
  const value = event?.result ?? event?.output ?? event?.content ?? event?.error;
  if (typeof value === "string") return value;
  if (value == null) return undefined;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function hash(value: string): string {
  let hashValue = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hashValue ^= value.charCodeAt(index);
    hashValue = Math.imul(hashValue, 16777619);
  }
  return (hashValue >>> 0).toString(16).padStart(8, "0");
}
