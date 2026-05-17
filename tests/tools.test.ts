import test from "node:test";
import assert from "node:assert/strict";
import { registerVibeMemoryCommands } from "../src/commands.js";
import { COMMAND_NAMES, TOOL_NAMES } from "../src/constants.js";
import { buildToolDefinitions } from "../src/tools.js";
import { VibeMemoryRuntime } from "../src/runtime.js";
import { normalizeSettings } from "../src/config.js";

test("tools use only vibe_memory namespace", () => {
  const tools = buildToolDefinitions(() => ({}));
  const names = tools.map((tool) => tool.name);
  assert.deepEqual(names.sort(), Object.values(TOOL_NAMES).sort());
  assert.ok(!names.includes("recall"));
  assert.ok(!names.some((name) => name.startsWith("fact_")));
  assert.ok(!names.some((name) => name.startsWith("instinct_")));
  assert.ok(!names.some((name) => /forget|delete/i.test(name)));
});

test("remember requires explicit confirmation before writing", async () => {
  let wrote = false;
  const [remember] = buildToolDefinitions(() => ({
    remember: async () => {
      wrote = true;
      return { id: "obs1" };
    },
  })).filter((tool) => tool.name === TOOL_NAMES.remember);

  const result = await remember.execute("call1", { content: "Store this" }, new AbortController().signal);

  assert.equal(wrote, false);
  assert.match(result.content[0].text, /confirmation-needed/i);
  assert.match(result.content[0].text, /untrusted reference/i);
  assert.equal(result.details.status, "confirmation-needed");
});

test("remember writes only with explicit confirmation", async () => {
  let wroteContent = "";
  const [remember] = buildToolDefinitions(() => ({
    remember: async (params) => {
      wroteContent = String(params.content);
      return { id: "obs1", status: "stored" };
    },
  })).filter((tool) => tool.name === TOOL_NAMES.remember);

  const result = await remember.execute("call1", { content: "Decision: use Pi APIs", explicit: true }, new AbortController().signal);

  assert.equal(wroteContent, "Decision: use Pi APIs");
  assert.match(result.content[0].text, /stored/i);
  assert.match(result.content[0].text, /untrusted reference/i);
});

test("revise requires explicit confirmation before writing", async () => {
  let revised = false;
  const [revise] = buildToolDefinitions(() => ({
    revise: async () => {
      revised = true;
      return { id: "rev1" };
    },
  })).filter((tool) => tool.name === TOOL_NAMES.revise);

  const result = await revise.execute("call1", { oldId: "old1", newContent: "new", reason: "superseded" }, new AbortController().signal);

  assert.equal(revised, false);
  assert.equal(result.details.status, "confirmation-needed");
  assert.match(result.content[0].text, /confirmation-needed/i);
  assert.match(result.content[0].text, /non-destructive/i);
});

test("recall labels returned memory as untrusted reference data", async () => {
  const [recall] = buildToolDefinitions(() => ({
    recall: async () => [{ id: "obs1", content: "Prior decision" }],
  })).filter((tool) => tool.name === TOOL_NAMES.recall);

  const result = await recall.execute("call1", { query: "decision" }, new AbortController().signal);

  assert.match(result.content[0].text, /untrusted reference data/i);
  assert.match(result.content[0].text, /Prior decision/);
});

test("import tool accepts supplied records and exposes explicit migration path only", async () => {
  let importedParams: Record<string, unknown> | undefined;
  const [importTool] = buildToolDefinitions(() => ({
    import: async (params) => {
      importedParams = params;
      return { status: "imported", count: Array.isArray(params.records) ? params.records.length : 0 };
    },
  })).filter((tool) => tool.name === TOOL_NAMES.import);

  assert.ok(importTool.parameters.properties && "path" in (importTool.parameters.properties as Record<string, unknown>));
  assert.match(JSON.stringify(importTool.parameters), /explicit local continuous-learning migration path/i);
  assert.ok("records" in (importTool.parameters.properties as Record<string, unknown>));

  const records = [{ id: "legacy1", content: "old fact" }];
  const result = await importTool.execute("call1", { source: "observational-memory", records, dryRun: false }, new AbortController().signal);

  assert.deepEqual(importedParams?.records, records);
  assert.equal(importedParams?.dryRun, false);
  assert.match(result.content[0].text, /imported/i);
});

test("import tool prepares JSON-ish string records from weaker models", async () => {
  const [importTool] = buildToolDefinitions(() => ({ import: async (params) => params })).filter((tool) => tool.name === TOOL_NAMES.import);

  const prepared = importTool.prepareArguments?.({
    source: "observational-memory",
    dryRun: false,
    records: "[{'id': 'legacy1', 'content': 'legacy imported memory'}]",
  }) as Record<string, unknown>;

  assert.deepEqual(prepared.records, [{ id: "legacy1", content: "legacy imported memory" }]);
});


test("typed memory and review tool schemas expose safe filters and actions", async () => {
  const tools = buildToolDefinitions(() => ({ review: async (params) => ({ status: "ok", params }) }));
  const remember = tools.find((tool) => tool.name === TOOL_NAMES.remember)!;
  const recall = tools.find((tool) => tool.name === TOOL_NAMES.recall)!;
  const review = tools.find((tool) => tool.name === TOOL_NAMES.review)!;

  const rememberProps = remember.parameters.properties as Record<string, unknown>;
  const recallProps = recall.parameters.properties as Record<string, unknown>;
  const reviewProps = review.parameters.properties as Record<string, unknown>;

  assert.ok("kind" in rememberProps);
  assert.ok("scope" in rememberProps);
  assert.ok("tags" in rememberProps);
  assert.ok("kind" in recallProps);
  assert.ok("status" in recallProps);
  assert.ok("includeHistorical" in recallProps);
  assert.ok("action" in reviewProps);
  assert.ok(!JSON.stringify(review.parameters).match(/delete|forget|reject/i));

  const result = await review.execute("call1", { action: "list" }, new AbortController().signal);
  assert.match(result.content[0].text, /review/i);
});


test("tool callbacks preserve VibeMemoryRuntime method binding", async () => {
  const repository = {
    observations: [] as any[],
    appendRawEvent() {},
    addObservation(input: any) { this.observations.push(input); },
    searchObservations() { return this.observations; },
    listPendingSyncJobs() { return []; },
  };
  const runtime = new VibeMemoryRuntime({
    settings: normalizeSettings({ hindsight: { enabled: false }, meditation: { mode: "off" } }),
    repository,
    workspaceId: "ws1",
    sessionId: "s1",
  });
  const tools = buildToolDefinitions(() => runtime);
  const remember = tools.find((tool) => tool.name === TOOL_NAMES.remember)!;
  const recall = tools.find((tool) => tool.name === TOOL_NAMES.recall)!;
  const doctor = tools.find((tool) => tool.name === TOOL_NAMES.doctor)!;

  const rememberResult = await remember.execute("call1", { content: "Decision: preserve method binding", explicit: true }, new AbortController().signal);
  const recallResult = await recall.execute("call2", { query: "binding" }, new AbortController().signal);
  const doctorResult = await doctor.execute("call3", {}, new AbortController().signal);

  assert.match(rememberResult.content[0].text, /stored/i);
  assert.match(recallResult.content[0].text, /preserve method binding/);
  assert.match(doctorResult.content[0].text, /pi-vibe-memory doctor/i);
});

test("doctor tool falls back to deterministic doctor checks", async () => {
  const [doctor] = buildToolDefinitions(() => ({})).filter((tool) => tool.name === TOOL_NAMES.doctor);

  const result = await doctor.execute("call1", {}, new AbortController().signal);

  assert.match(result.content[0].text, /pi-vibe-memory doctor/i);
  assert.ok(Array.isArray(result.details.checks));
});

test("doctor command includes warning details instead of hiding non-pass checks", async () => {
  const notifications: Array<{ message: string; level?: string }> = [];
  const commands = new Map<string, { handler: (args: string, ctx: { ui?: { notify?: (message: string, level?: string) => void } }) => Promise<void> }>();
  const pi = {
    registerCommand(name: string, definition: { handler: (args: string, ctx: { ui?: { notify?: (message: string, level?: string) => void } }) => Promise<void> }) {
      commands.set(name, definition);
    },
  };

  registerVibeMemoryCommands(pi, () => ({
    doctor: async () => ({
      ok: true,
      safeToUninstallLegacy: false,
      legacyRemovalAdvice: ["Apply migration first."],
      checks: [
        { name: "settings", status: "pass", message: "ok" },
        { name: "hindsight health", status: "warn", message: "Hindsight is offline" },
        { name: "Legacy replacement readiness", status: "warn", message: "Migration status is not known", details: ["Apply migration first."] },
      ],
    }),
  }));

  await commands.get(COMMAND_NAMES.doctor)!.handler("", { ui: { notify: (message, level) => notifications.push({ message, level }) } });

  assert.match(notifications[0]?.message ?? "", /hindsight health: warn - Hindsight is offline/);
  assert.match(notifications[0]?.message ?? "", /Legacy replacement readiness: warn - Migration status is not known/);
  assert.match(notifications[0]?.message ?? "", /Apply migration first/);
});



test("remember and revise report not-configured instead of stored when runtime is unavailable", async () => {
  const tools = buildToolDefinitions(() => undefined);
  const remember = tools.find((tool) => tool.name === TOOL_NAMES.remember)!;
  const revise = tools.find((tool) => tool.name === TOOL_NAMES.revise)!;

  const rememberResult = await remember.execute("call1", { content: "Decision: unavailable runtime", explicit: true }, new AbortController().signal);
  assert.equal(rememberResult.details.status, "not-configured");
  assert.equal(rememberResult.details.stored, false);
  assert.doesNotMatch(rememberResult.content[0].text, /Memory stored/i);

  const reviseResult = await revise.execute("call2", { oldId: "old", newContent: "new", reason: "runtime unavailable", explicit: true }, new AbortController().signal);
  assert.equal(reviseResult.details.status, "not-configured");
  assert.equal(reviseResult.details.revised, false);
  assert.doesNotMatch(reviseResult.content[0].text, /revision recorded/i);
});

test("disable injection command uses Pi warning level", async () => {
  const notifications: Array<{ message: string; level?: string }> = [];
  const commands = new Map<string, { handler: (args: string, ctx: { ui?: { notify?: (message: string, level?: string) => void } }) => Promise<void> }>();
  const pi = {
    registerCommand(name: string, definition: { handler: (args: string, ctx: { ui?: { notify?: (message: string, level?: string) => void } }) => Promise<void> }) {
      commands.set(name, definition);
    },
  };

  registerVibeMemoryCommands(pi, () => ({ status: async () => ({ status: "owner", injectionDisabled: true }) }));
  await commands.get(COMMAND_NAMES.disableInjection)!.handler("", { ui: { notify: (message, level) => notifications.push({ message, level }) } });

  assert.equal(notifications[0]?.level, "warning");
});

test("commands use vibe-memory namespace and fake registrar", () => {
  const registered: string[] = [];
  const pi = {
    registerCommand(name: string, _definition: unknown) {
      registered.push(name);
    },
  };

  registerVibeMemoryCommands(pi, () => ({}));

  assert.deepEqual(registered.sort(), Object.values(COMMAND_NAMES).sort());
  for (const command of registered) {
    assert.match(command, /^vibe-memory-/);
  }
});

test("import command parses source and supported flags", async () => {
  let importParams: Record<string, unknown> | undefined;
  const commands = new Map<string, { handler: (args: string, ctx: { ui?: { notify?: (message: string, level?: string) => void } }) => Promise<void> }>();
  const pi = {
    registerCommand(name: string, definition: { handler: (args: string, ctx: { ui?: { notify?: (message: string, level?: string) => void } }) => Promise<void> }) {
      commands.set(name, definition);
    },
  };

  registerVibeMemoryCommands(pi, () => ({
    import: async (params) => {
      importParams = params;
      return { status: "preview" };
    },
  }));

  await commands.get(COMMAND_NAMES.import)!.handler("continuous-learning --dry-run --explicit --path /tmp/legacy", {});

  assert.deepEqual(importParams, {
    source: "continuous-learning",
    dryRun: true,
    explicit: true,
    path: "/tmp/legacy",
  });

  await commands.get(COMMAND_NAMES.import)!.handler("continuous-learning --apply --path=/tmp/applied", {});

  assert.deepEqual(importParams, {
    source: "continuous-learning",
    dryRun: false,
    path: "/tmp/applied",
  });
});

test("import command rejects unsupported flags without calling runtime", async () => {
  let called = false;
  const notifications: Array<{ message: string; level?: string }> = [];
  const commands = new Map<string, { handler: (args: string, ctx: { ui?: { notify?: (message: string, level?: string) => void } }) => Promise<void> }>();
  const pi = {
    registerCommand(name: string, definition: { handler: (args: string, ctx: { ui?: { notify?: (message: string, level?: string) => void } }) => Promise<void> }) {
      commands.set(name, definition);
    },
  };

  registerVibeMemoryCommands(pi, () => ({
    import: async () => {
      called = true;
      return { status: "preview" };
    },
  }));

  await commands.get(COMMAND_NAMES.import)!.handler("continuous-learning --unknown", {
    ui: { notify: (message, level) => notifications.push({ message, level }) },
  });

  assert.equal(called, false);
  assert.equal(notifications[0]?.level, "error");
  assert.match(notifications[0]?.message ?? "", /Unsupported flag: --unknown/);
});
