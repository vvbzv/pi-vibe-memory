import test from "node:test";
import assert from "node:assert/strict";
import { registerVibeMemoryCommands } from "../src/commands.js";
import { COMMAND_NAMES, TOOL_NAMES } from "../src/constants.js";
import { buildToolDefinitions } from "../src/tools.js";

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

test("doctor tool uses runtime doctor when available", async () => {
  let called = false;
  const [doctor] = buildToolDefinitions(() => ({
    doctor: async () => {
      called = true;
      return { ok: true, checks: [{ name: "runtime", status: "pass", message: "ok" }] };
    },
  })).filter((tool) => tool.name === TOOL_NAMES.doctor);

  const result = await doctor.execute("call1", {}, new AbortController().signal);

  assert.equal(called, true);
  assert.match(result.content[0].text, /runtime: pass/);
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
