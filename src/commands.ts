import { COMMAND_NAMES } from "./constants.js";
import { runDoctorChecks } from "./doctor.js";
import type { VibeMemoryRuntime } from "./tools.js";

type CommandContext = {
  ui?: { notify?: (message: string, level?: "info" | "warn" | "error") => void };
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

  register(pi, COMMAND_NAMES.view, "Show recent pi-vibe-memory references", async (_args, ctx) => {
    const result = await callRuntime(getRuntime(), "recall", { query: "recent", limit: 5 }, "no memory available");
    notify(ctx, `pi-vibe-memory references (untrusted): ${formatBrief(result)}`);
  });

  register(pi, COMMAND_NAMES.sync, "Flush pi-vibe-memory sync queue", async (_args, ctx) => {
    const result = await callRuntime(getRuntime(), "sync", {}, "sync unavailable");
    notify(ctx, `pi-vibe-memory sync: ${formatBrief(result)}`);
  });

  register(pi, COMMAND_NAMES.import, "Preview pi-vibe-memory legacy import", async (args, ctx) => {
    const result = await callRuntime(getRuntime(), "import", { source: args.trim(), dryRun: true }, "import preview unavailable");
    notify(ctx, `pi-vibe-memory import preview: ${formatBrief(result)}`);
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
    notify(ctx, `pi-vibe-memory injection: ${formatBrief(result)}`, "warn");
  });

  register(pi, COMMAND_NAMES.doctor, "Run pi-vibe-memory doctor", async (_args, ctx) => {
    const runtime = getRuntime();
    const result = runtime?.doctor ? await runtime.doctor({}) : runDoctorChecks();
    notify(ctx, `pi-vibe-memory doctor: ${formatBrief(result)}`);
  });
}

function register(pi: Registrar, name: string, description: string, handler: (args: string, ctx: CommandContext) => Promise<void>): void {
  pi.registerCommand(name, { description, handler });
}

async function callRuntime(runtime: VibeMemoryRuntime | undefined, method: keyof VibeMemoryRuntime, params: Record<string, unknown>, fallback: unknown): Promise<unknown> {
  const fn = runtime?.[method];
  return typeof fn === "function" ? fn.call(runtime, params) : fallback;
}

function notify(ctx: CommandContext, message: string, level: "info" | "warn" | "error" = "info"): void {
  ctx.ui?.notify?.(message, level);
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

function parseReviewArgs(args: string): Record<string, unknown> {
  const parts = args.trim().split(/\s+/).filter(Boolean);
  return { action: parts[0] ?? "list", id: parts[1] };
}
