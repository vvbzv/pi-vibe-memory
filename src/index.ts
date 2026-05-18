import path from "node:path";
import { readFile } from "node:fs/promises";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { detectMemoryOwnerIssues, loadVibeMemorySettingsFromFiles, type NormalizedVibeMemorySettings } from "./config.js";
import { buildToolDefinitions } from "./tools.js";
import { registerVibeMemoryCommands } from "./commands.js";
import { DEFAULT_DB_RELATIVE_PATH, PACKAGE_NAME } from "./constants.js";
import { openVibeMemoryDb, type VibeMemoryDb } from "./storage/db.js";
import { VibeMemoryRepository } from "./storage/repository.js";
import { HindsightClient } from "./hindsight/client.js";
import { scrubSecrets } from "./scrub.js";
import { VibeMemoryRuntime } from "./runtime.js";

type UiContext = { cwd?: string; ui?: { notify?: (message: string, level?: "info" | "warning" | "error") => void } };
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
      const ownerIssues = detectMemoryOwnerIssues(rawSettings);
      const conflicts = ownerIssues.conflicts;
      const settingsWithWarnings = ownerIssues.warnings.length > 0
        ? { ...settings, configWarnings: [...settings.configWarnings, ...ownerIssues.warnings] }
        : settings;
      const effectiveSettings = settingsWithWarnings.strictSingleOwner && conflicts.length > 0
        ? { ...settingsWithWarnings, mode: "toolsOnly" as const, compaction: { ...settingsWithWarnings.compaction, enabled: false, mode: "off" as const } }
        : settingsWithWarnings;
      const dbPath = resolveDbPath(effectiveSettings, cwd);
      const db = openVibeMemoryDb(dbPath);
      const repository = new VibeMemoryRepository(db);
      const workspaceId = workspaceIdFor(cwd);
      const sessionId = sessionIdFor(cwd);

      repository.upsertWorkspace({ id: workspaceId, name: path.basename(cwd) || "workspace", rootPath: cwd });
      repository.startSession({ id: sessionId, workspaceId });

      const hindsight = effectiveSettings.hindsight.enabled
        ? new HindsightClient({
            baseUrl: effectiveSettings.hindsight.baseUrl,
            apiKey: effectiveSettings.hindsight.apiKey,
            apiKeyEnv: effectiveSettings.hindsight.apiKeyEnv,
            timeoutMs: effectiveSettings.hindsight.timeoutMs,
          })
        : undefined;

      state.db?.close();
      state.db = db;
      state.settings = effectiveSettings;
      state.conflicts = conflicts;
      state.runtime = new VibeMemoryRuntime({ settings: effectiveSettings, repository, hindsight: hindsight as any, workspaceId, sessionId, workspaceRoot: cwd, conflicts });

      for (const warning of effectiveSettings.configWarnings) notify(ctx, `${PACKAGE_NAME}: ${warning}`, "warning");
      for (const conflict of conflicts) notify(ctx, `${PACKAGE_NAME}: competing memory owner detected: ${conflict}`, "warning");
      if (settingsWithWarnings.strictSingleOwner && conflicts.length > 0) notify(ctx, `${PACKAGE_NAME}: strictSingleOwner conflict detected; runtime forced to toolsOnly and compaction disabled.`, "warning");
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

  (pi as any).on("session_before_compact", async (event: any, ctx: HookContext) => {
    if (!state.runtime) return undefined;
    try {
      return await state.runtime.beforeCompact(event);
    } catch (error) {
      if (state.settings?.compaction.failOpen !== false) {
        notify(ctx, `${PACKAGE_NAME}: compaction skipped: ${errorMessage(error)}`, "warning");
        return undefined;
      }
      throw error;
    }
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
      notify(ctx, `${PACKAGE_NAME}: turn capture failed: ${errorMessage(error)}`, "warning");
    }
  });

  (pi as any).on("tool_execution_end", async (event: any, ctx: HookContext) => {
    if (!state.runtime || !state.settings || state.settings.codeReferences.captureFromToolResults === false) return;
    if (!shouldCaptureToolEvent(event, state.settings.captureToolOutput)) return;
    const text = summarizeToolEvent(event);
    if (!text) return;
    try {
      await state.runtime.captureTurnEnd({
        turnId: `tool:${String(event?.toolCallId ?? event?.id ?? Date.now())}`,
        cwd: ctx.cwd ?? event?.cwd,
        assistantText: text,
      });
    } catch (error) {
      notify(ctx, `${PACKAGE_NAME}: tool capture failed: ${errorMessage(error)}`, "warning");
    }
  });

  (pi as any).on("session_shutdown", async () => {
    try {
      await state.runtime?.sync();
    } catch {
      // Sync failures should not prevent local database shutdown.
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

function notify(ctx: UiContext, message: string, level: "info" | "warning" | "error" = "info"): void {
  ctx.ui?.notify?.(message, level);
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function shouldCaptureToolEvent(event: any, mode: NormalizedVibeMemorySettings["captureToolOutput"]): boolean {
  if (mode === "off") return false;
  const hasError = Boolean(event?.error ?? event?.isError ?? event?.failed ?? event?.status === "error");
  if (mode === "errors") return hasError;
  return mode === "summaries";
}

function summarizeToolEvent(event: any): string | undefined {
  const toolName = firstString(event?.toolName, event?.tool_name, event?.name, event?.tool?.name) ?? "unknown";
  const toolId = firstString(event?.toolCallId, event?.tool_call_id, event?.callId, event?.id) ?? "unknown";
  const status = firstString(event?.status) ?? (event?.error || event?.isError || event?.failed ? "error" : "ok");
  const lines = [`tool=${toolName}`, `id=${toolId}`, `status=${status}`];

  const explicitSummary = firstString(event?.summary, event?.result?.summary, event?.output?.summary);
  if (explicitSummary) lines.push(`summary=${firstLine(explicitSummary)}`);

  const error = event?.error;
  if (error != null) {
    const errorName = errorClassName(error);
    const message = firstString(error?.message, typeof error === "string" ? error : undefined);
    lines.push(`error=${errorName}${message ? `: ${firstLine(message)}` : ""}`);
  }

  return scrubSecrets(lines.join("\n"), { maxChars: 600 });
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function firstLine(value: string): string {
  return value.split(/\r?\n/, 1)[0]?.trim() ?? "";
}

function errorClassName(error: unknown): string {
  if (error instanceof Error) return error.name || error.constructor.name || "Error";
  if (isPlainObject(error) && typeof error.name === "string" && error.name.trim()) return error.name.trim();
  return typeof error === "string" ? "Error" : "Object";
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
