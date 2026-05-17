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

test("import tool accepts supplied records and does not expose path scanning", async () => {
  let importedParams: Record<string, unknown> | undefined;
  const [importTool] = buildToolDefinitions(() => ({
    import: async (params) => {
      importedParams = params;
      return { status: "imported", count: Array.isArray(params.records) ? params.records.length : 0 };
    },
  })).filter((tool) => tool.name === TOOL_NAMES.import);

  assert.ok(importTool.parameters.properties && !("path" in (importTool.parameters.properties as Record<string, unknown>)));
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
