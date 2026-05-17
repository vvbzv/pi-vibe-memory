import { COMMAND_NAMES } from "./constants.js";
import { runDoctorChecks } from "./doctor.js";
import type { VibeMemoryRuntime } from "./tools.js";

type CommandContext = {
  ui?: { notify?: (message: string, level?: "info" | "warning" | "error") => void };
};

type Registrar = {
  registerCommand: (name: string, definition: { description: string; handler: (args: string, ctx: CommandContext) => Promise<void> }) => void;
};

type RuntimeGetter = () => VibeMemoryRuntime | undefined;

export function registerVibeMemoryCommands(pi: Registrar, getRuntime: RuntimeGetter): void {
  register(pi, COMMAND_NAMES.status, "Show pi-vibe-memory status", async (_args, ctx) => {
    const result = await callRuntime(getRuntime(), "status", {}, "status unavailable");
    notify(ctx, `pi-vibe-memory: ${formatBrief(result)}`);
  });

  register(pi, COMMAND_NAMES.stats, "Show pi-vibe-memory stats", async (_args, ctx) => {
    const result = await callRuntime(getRuntime(), "stats", {}, "stats unavailable");
    notify(ctx, formatStats(result));
  });

  register(pi, COMMAND_NAMES.view, "Show recent pi-vibe-memory references", async (_args, ctx) => {
    const result = await callRuntime(getRuntime(), "recall", { query: "recent", limit: 5 }, "no memory available");
    notify(ctx, `pi-vibe-memory references (untrusted): ${formatBrief(result)}`);
  });

  register(pi, COMMAND_NAMES.sync, "Flush pi-vibe-memory sync queue", async (_args, ctx) => {
    const result = await callRuntime(getRuntime(), "sync", {}, "sync unavailable");
    notify(ctx, `pi-vibe-memory sync: ${formatBrief(result)}`);
  });

  register(pi, COMMAND_NAMES.import, "Preview pi-vibe-memory legacy import", async (args, ctx) => {
    const parsed = parseImportArgs(args);
    if ("error" in parsed) {
      notify(ctx, parsed.error, "error");
      return;
    }

    const result = await callRuntime(getRuntime(), "import", parsed.params, "import preview unavailable");
    notify(ctx, `pi-vibe-memory import ${parsed.params.dryRun === false ? "result" : "preview"}: ${formatBrief(result)}`);
  });

  register(pi, COMMAND_NAMES.meditate, "Run pi-vibe-memory meditation", async (_args, ctx) => {
    const result = await callRuntime(getRuntime(), "meditate", {}, "meditation unavailable");
    notify(ctx, `pi-vibe-memory meditation: ${formatBrief(result)}`);
  });

  register(pi, COMMAND_NAMES.review, "Review pi-vibe-memory candidates", async (args, ctx) => {
    const result = await callRuntime(getRuntime(), "review", parseReviewArgs(args), "no review items available");
    notify(ctx, `pi-vibe-memory review (untrusted): ${formatBrief(result)}`);
  });

  register(pi, COMMAND_NAMES.reviewInstincts, "Review pi-vibe-memory working instincts", async (_args, ctx) => {
    const result = await callRuntime(getRuntime(), "reviewInstincts", {}, "no instincts available");
    notify(ctx, `pi-vibe-memory instincts (untrusted): ${formatBrief(result)}`);
  });

  register(pi, COMMAND_NAMES.disableInjection, "Disable pi-vibe-memory prompt injection for this runtime", async (_args, ctx) => {
    const result = await callRuntime(getRuntime(), "status", { disableInjection: true }, "injection disable not wired yet");
    notify(ctx, `pi-vibe-memory injection: ${formatBrief(result)}`, "warning");
  });

  register(pi, COMMAND_NAMES.doctor, "Run pi-vibe-memory doctor", async (_args, ctx) => {
    const runtime = getRuntime();
    const result = runtime?.doctor ? await runtime.doctor({}) : runDoctorChecks();
    notify(ctx, formatDoctor(result));
  });
}

function register(pi: Registrar, name: string, description: string, handler: (args: string, ctx: CommandContext) => Promise<void>): void {
  pi.registerCommand(name, { description, handler });
}

async function callRuntime(runtime: VibeMemoryRuntime | undefined, method: keyof VibeMemoryRuntime, params: Record<string, unknown>, fallback: unknown): Promise<unknown> {
  const fn = runtime?.[method];
  return typeof fn === "function" ? fn.call(runtime, params) : fallback;
}

function notify(ctx: CommandContext, message: string, level: "info" | "warning" | "error" = "info"): void {
  ctx.ui?.notify?.(message, level);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function formatBrief(value: unknown): string {
  if (value == null) return "none";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? "" : "s"}`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.status === "string") return record.status;
    if (typeof record.message === "string") return record.message;
    if (typeof record.ok === "boolean") return record.ok ? "ok" : "issues found";
  }
  return String(value);
}

function formatStats(result: unknown): string {
  if (!isRecord(result)) return `pi-vibe-memory stats: ${formatBrief(result)}`;
  const storage = isRecord(result.storage) ? result.storage : {};
  const observations = isRecord(storage.observations) ? storage.observations : {};
  const instincts = isRecord(storage.instincts) ? storage.instincts : {};
  const sync = isRecord(result.sync) ? result.sync : {};
  const review = isRecord(result.review) ? result.review : {};
  const compaction = isRecord(result.compaction) ? result.compaction : {};
  const promptBudget = isRecord(result.promptBudget) ? result.promptBudget : {};
  return [
    `pi-vibe-memory stats: ${stringValue(result.status) ?? "unknown"}`,
    `memory: ${num(observations.total)} observations, ${num(instincts.total)} instincts, ${num(review.observations) + num(review.instincts)} needs review`,
    `sync: ${num(sync.pending)} pending, ${num(sync.failed)} failed, Hindsight ${stringValue(sync.hindsight) ?? "unknown"}`,
    `compaction: ${stringValue(compaction.mode) ?? "unknown"}${compaction.ownerActive === true ? " owner-active" : ""}`,
    `prompt budget: ${num(promptBudget.chars)} chars`,
  ].join("\n");
}

function formatDoctor(result: unknown): string {
  const doctor = result as { ok?: boolean; checks?: Array<{ name?: string; status?: string; message?: string; details?: unknown }> } | undefined;
  if (!doctor || !Array.isArray(doctor.checks)) return `pi-vibe-memory doctor: ${formatBrief(result)}`;
  const summary = doctor.ok === false ? "issues found" : "ok";
  const lines = doctor.checks
    .filter((check) => check.status !== "pass")
    .map((check) => {
      const detailText = Array.isArray(check.details) && check.details.length > 0 ? ` Details: ${check.details.join("; ")}` : "";
      return `${check.name}: ${check.status} - ${check.message}${detailText}`;
    });
  return [`pi-vibe-memory doctor: ${summary}`, ...lines].join("\n");
}

function parseReviewArgs(args: string): Record<string, unknown> {
  const parts = args.trim().split(/\s+/).filter(Boolean);
  return { action: parts[0] ?? "list", id: parts[1] };
}

function parseImportArgs(args: string): { params: Record<string, unknown> } | { error: string } {
  const parts = args.trim().split(/\s+/).filter(Boolean);
  const [source, ...flags] = parts;
  if (!source) return { error: "Usage: /vibe-memory-import <source> [--dry-run|--apply] [--explicit] [--path <path>|--path=<path>]" };

  const params: Record<string, unknown> = { source, dryRun: true };

  for (let index = 0; index < flags.length; index += 1) {
    const flag = flags[index];
    if (flag === "--dry-run") {
      params.dryRun = true;
    } else if (flag === "--apply") {
      params.dryRun = false;
    } else if (flag === "--explicit") {
      params.explicit = true;
    } else if (flag === "--path") {
      const value = flags[index + 1];
      if (!value || value.startsWith("--")) return { error: "Missing value for --path." };
      params.path = value;
      index += 1;
    } else if (flag.startsWith("--path=")) {
      const value = flag.slice("--path=".length);
      if (!value) return { error: "Missing value for --path." };
      params.path = value;
    } else if (flag.startsWith("--")) {
      return { error: `Unsupported flag: ${flag}. Supported flags: --dry-run, --apply, --explicit, --path.` };
    } else {
      return { error: `Unexpected argument: ${flag}. Source must be the first token.` };
    }
  }

  return { params };
}
