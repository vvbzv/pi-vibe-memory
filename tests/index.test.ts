import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import piVibeMemory from "../src/index.js";
import { COMMAND_NAMES, TOOL_NAMES } from "../src/constants.js";

class FakePi {
  handlers = new Map<string, Function>();
  tools: any[] = [];
  commands = new Map<string, any>();

  on(name: string, handler: Function) { this.handlers.set(name, handler); }
  registerTool(tool: any) { this.tools.push(tool); }
  registerCommand(name: string, definition: any) { this.commands.set(name, definition); }
}

async function tempProject() {
  const root = await mkdtemp(path.join(os.tmpdir(), "pvm-index-"));
  await mkdir(path.join(root, ".pi"), { recursive: true });
  return root;
}

function fakeContext(cwd: string) {
  const notifications: Array<{ message: string; level?: string }> = [];
  return {
    cwd,
    sessionManager: { getSessionFile: () => path.join(cwd, ".pi", "session.jsonl") },
    ui: { notify: (message: string, level?: string) => notifications.push({ message, level }) },
    notifications,
  };
}

test("index registers namespaced tools, commands, and lifecycle hooks", () => {
  const pi = new FakePi();
  piVibeMemory(pi as any);

  assert.deepEqual(pi.tools.map((tool) => tool.name).sort(), Object.values(TOOL_NAMES).sort());
  assert.deepEqual([...pi.commands.keys()].sort(), Object.values(COMMAND_NAMES).sort());
  for (const event of ["session_start", "before_agent_start", "session_before_compact", "turn_end", "tool_execution_end", "session_shutdown"]) {
    assert.equal(typeof pi.handlers.get(event), "function", event);
  }
});

test("session_start loads config, opens runtime, warns on hard conflicts, and doctor command uses runtime", async () => {
  const root = await tempProject();
  await writeFile(path.join(root, ".pi", "settings.json"), JSON.stringify({
    packages: ["npm:pi-observational-memory"],
    "observational-memory": { passive: false },
    vibeMemory: { dbPath: "memory.db", hindsight: { enabled: false }, meditation: { mode: "off" } },
  }));
  const pi = new FakePi();
  piVibeMemory(pi as any);
  const ctx = fakeContext(root);

  await pi.handlers.get("session_start")?.({ reason: "startup" }, ctx);

  assert.ok(ctx.notifications.some((item) => /competing memory owner|pi-observational-memory/i.test(item.message) && item.level === "warning"));
  const before = await pi.handlers.get("before_agent_start")?.({ prompt: "hello", systemPrompt: "system" }, ctx);
  assert.deepEqual(before, undefined);

  await pi.commands.get(COMMAND_NAMES.doctor).handler("", ctx);
  assert.ok(ctx.notifications.some((item) => /doctor|issues found|ok/i.test(item.message)));
});

test("session_start treats uninstalled active observational-memory config as stale warning", async () => {
  const root = await tempProject();
  await writeFile(path.join(root, ".pi", "settings.json"), JSON.stringify({
    packages: ["git:github.com/vvbzv/pi-vibe-memory"],
    "observational-memory": { passive: false },
    vibeMemory: { dbPath: "memory.db", hindsight: { enabled: false }, meditation: { mode: "off" }, captureRawPrompts: true },
  }));
  const pi = new FakePi();
  piVibeMemory(pi as any);
  const ctx = fakeContext(root);

  await pi.handlers.get("session_start")?.({ reason: "startup" }, ctx);

  assert.ok(ctx.notifications.some((item) => /Stale observational-memory settings remain.*passive:false/i.test(item.message) && item.level === "warning"));
  assert.ok(!ctx.notifications.some((item) => /competing memory owner detected/i.test(item.message)));

  await pi.handlers.get("turn_end")?.({ turnIndex: 1, prompt: "Please inspect src/index.ts", message: { content: "Assistant edited src/index.ts for memory lifecycle" } }, ctx);
  const compact = await pi.handlers.get("session_before_compact")?.({ preparation: { firstKeptEntryId: "entry", tokensBefore: 1 }, branchEntries: [] }, ctx);
  assert.equal(compact.compaction.details.type, "pi-vibe-memory");

  await pi.commands.get(COMMAND_NAMES.doctor).handler("", ctx);
  const doctorMessage = ctx.notifications.at(-1)?.message ?? "";
  assert.match(doctorMessage, /config warnings: warn - Stale observational-memory settings/i);
  assert.doesNotMatch(doctorMessage, /Legacy replacement readiness: fail/i);
});

test("session_start surfaces settings config warnings", async () => {
  const root = await tempProject();
  await writeFile(path.join(root, ".pi", "settings.json"), JSON.stringify({
    vibeMemory: {
      dbPath: "memory.db",
      hindsight: { enabled: true, source: "mcp", mcpServer: "missing-hindsight" },
      meditation: { mode: "off" },
    },
  }));
  const pi = new FakePi();
  piVibeMemory(pi as any);
  const ctx = fakeContext(root);

  await pi.handlers.get("session_start")?.({ reason: "startup" }, ctx);

  assert.ok(ctx.notifications.some((item) => /Hindsight MCP source requested.*missing-hindsight/i.test(item.message) && item.level === "warning"));
});

test("before_agent_start hook returns appended system prompt after local capture", async () => {
  const root = await tempProject();
  await writeFile(path.join(root, ".pi", "settings.json"), JSON.stringify({
    vibeMemory: { dbPath: "memory.db", hindsight: { enabled: false }, meditation: { mode: "off" }, captureRawPrompts: true },
  }));
  const pi = new FakePi();
  piVibeMemory(pi as any);
  const ctx = fakeContext(root);

  await pi.handlers.get("session_start")?.({ reason: "startup" }, ctx);
  await pi.handlers.get("turn_end")?.({ turnIndex: 1, prompt: "Please inspect src/index.ts", message: { content: "Assistant edited src/index.ts for memory lifecycle" }, toolResults: [] }, ctx);
  const result = await pi.handlers.get("before_agent_start")?.({ prompt: "src/index.ts", systemPrompt: "system" }, ctx);

  assert.match(result.systemPrompt, /<pi_vibe_memory trust="untrusted">/);
  assert.match(result.systemPrompt, /src\/index.ts/);
});

test("session_before_compact hook returns owner compaction from local memory", async () => {
  const root = await tempProject();
  await writeFile(path.join(root, ".pi", "settings.json"), JSON.stringify({
    packages: [],
    "observational-memory": { passive: true },
    continuousLearning: { enabled: false },
    vibeMemory: { dbPath: "memory.db", hindsight: { enabled: false }, meditation: { mode: "off" }, captureRawPrompts: true },
  }));
  const pi = new FakePi();
  piVibeMemory(pi as any);
  const ctx = fakeContext(root);

  await pi.handlers.get("session_start")?.({ reason: "startup" }, ctx);
  await pi.handlers.get("turn_end")?.({ turnIndex: 1, prompt: "Please inspect src/index.ts", message: { content: "Assistant edited src/index.ts for memory lifecycle" }, toolResults: [] }, ctx);
  const result = await pi.handlers.get("session_before_compact")?.({
    preparation: { firstKeptEntryId: "entry-1", tokensBefore: 200, fileOps: { readFiles: ["src/index.ts"], modifiedFiles: [] } },
    branchEntries: [],
  }, ctx);

  assert.equal(result.compaction.firstKeptEntryId, "entry-1");
  assert.equal(result.compaction.tokensBefore, 200);
  assert.equal(result.compaction.details.type, "pi-vibe-memory");
  assert.match(result.compaction.summary, /Pi Vibe Memory Continuity/);
});



test("strictSingleOwner downgrades runtime to toolsOnly, disables compaction, and warns", async () => {
  const root = await tempProject();
  await writeFile(path.join(root, ".pi", "settings.json"), JSON.stringify({
    packages: ["npm:pi-observational-memory"],
    "observational-memory": { passive: false },
    vibeMemory: {
      dbPath: "memory.db",
      strictSingleOwner: true,
      hindsight: { enabled: false },
      meditation: { mode: "off" },
      captureRawPrompts: true,
      compaction: { mode: "owner" },
    },
  }));
  const pi = new FakePi();
  piVibeMemory(pi as any);
  const ctx = fakeContext(root);

  await pi.handlers.get("session_start")?.({ reason: "startup" }, ctx);

  assert.ok(ctx.notifications.some((item) => /strictSingleOwner.*toolsOnly/i.test(item.message) && item.level === "warning"));
  await pi.handlers.get("turn_end")?.({ turnIndex: 1, prompt: "Please inspect src/index.ts", message: { content: "Assistant edited src/index.ts for memory lifecycle" } }, ctx);
  assert.equal(await pi.handlers.get("before_agent_start")?.({ prompt: "src/index.ts", systemPrompt: "system" }, ctx), undefined);
  assert.equal(await pi.handlers.get("session_before_compact")?.({ preparation: { firstKeptEntryId: "entry", tokensBefore: 1 }, branchEntries: [] }, ctx), undefined);
});


test("session_shutdown closes database even when sync fails", async () => {
  const root = await tempProject();
  await writeFile(path.join(root, ".pi", "settings.json"), JSON.stringify({
    packages: [],
    "observational-memory": { passive: true },
    continuousLearning: { enabled: false },
    vibeMemory: { dbPath: "memory.db", hindsight: { baseUrl: "http://127.0.0.1:1", timeoutMs: 1 }, meditation: { mode: "off" }, sync: { maxBatchItems: 1 } },
  }));
  const pi = new FakePi();
  piVibeMemory(pi as any);
  const ctx = fakeContext(root);

  await pi.handlers.get("session_start")?.({ reason: "startup" }, ctx);
  const remember = pi.tools.find((tool) => tool.name === TOOL_NAMES.remember)!;
  await remember.execute("call1", { content: "Shutdown should close after sync failure", explicit: true }, new AbortController().signal);

  await assert.doesNotReject(() => pi.handlers.get("session_shutdown")?.({}, ctx));

  await pi.handlers.get("session_start")?.({ reason: "restart" }, ctx);
  assert.ok(!ctx.notifications.some((item) => /config\/runtime error/i.test(item.message)));
});
