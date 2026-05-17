import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, writeFile } from "node:fs/promises";
import {
  DEFAULT_SETTINGS,
  detectConflicts,
  loadVibeMemorySettingsFromFiles,
  normalizeSettings,
} from "../src/config.js";

async function tempDir() {
  return mkdtemp(path.join(os.tmpdir(), "pvm-config-"));
}

test("normalizeSettings applies safe token-light defaults", () => {
  const settings = normalizeSettings({});
  assert.equal(settings.enabled, true);
  assert.equal(settings.mode, "owner");
  assert.equal(settings.promptBudgetChars, DEFAULT_SETTINGS.promptBudgetChars);
  assert.ok(settings.promptBudgetChars <= 3500);
  assert.equal(settings.hindsight.source, "rest");
  assert.equal(settings.hindsight.baseUrl, "http://localhost:8888");
  assert.equal(settings.hindsight.mcpServer, "hindsight");
  assert.equal(settings.hindsight.recallScope, "hybrid");
  assert.equal(settings.hindsight.bankWideLimit, 1);
  assert.equal(settings.captureRawPrompts, false);
  assert.equal(settings.codeReferences.enabled, true);
  assert.equal(settings.codeReferences.maxPerPrompt, 2);
  assert.equal(settings.meditation.mode, "passive");
  assert.equal(settings.meditation.sameSession, true);
  assert.equal(settings.instincts.requireApprovalForDurable, true);
  assert.equal(settings.instincts.maxPromptItems, 2);
  assert.equal(settings.revision.enabled, true);
  assert.equal(settings.revision.maxPromptItems, 1);
});

test("normalizeSettings rejects invalid numbers and modes", () => {
  assert.throws(() => normalizeSettings({ mode: "bad" }), /mode/);
  assert.throws(() => normalizeSettings({ promptBudgetChars: 0 }), /promptBudgetChars/);
  assert.throws(() => normalizeSettings({ sync: { debounceMs: -1 } }), /debounceMs/);
  assert.throws(() => normalizeSettings({ codeReferences: { maxPerPrompt: 0 } }), /codeReferences\.maxPerPrompt/);
  assert.throws(() => normalizeSettings({ meditation: { mode: "auto" } }), /meditation\.mode/);
  assert.throws(() => normalizeSettings({ hindsight: { source: "sdk" } }), /hindsight\.source/);
  assert.throws(() => normalizeSettings({ hindsight: { recallScope: "everything" } }), /hindsight\.recallScope/);
  assert.throws(() => normalizeSettings({ instincts: { minEvidence: 0 } }), /instincts\.minEvidence/);
  assert.throws(() => normalizeSettings({ revision: { maxPromptItems: 0 } }), /revision\.maxPromptItems/);
});


test("normalizeSettings rejects unsafe dbPath values", () => {
  assert.throws(() => normalizeSettings({ dbPath: "/tmp/pi-vibe-memory.db" }), /dbPath/);
  assert.throws(() => normalizeSettings({ dbPath: "../pi-vibe-memory.db" }), /dbPath/);
  assert.throws(() => normalizeSettings({ dbPath: "safe/../pi-vibe-memory.db" }), /dbPath/);
  assert.equal(normalizeSettings({ dbPath: "safe/pi-vibe-memory.db" }).dbPath, "safe/pi-vibe-memory.db");
});

test("normalizeSettings enables owner compaction by default", () => {
  const settings = normalizeSettings({});

  assert.deepEqual(settings.compaction, {
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
  });
});

test("normalizeSettings validates compaction settings", () => {
  const settings = normalizeSettings({
    compaction: {
      enabled: false,
      mode: "observe",
      maxSummaryChars: 1200,
      maxObservations: 2,
      maxInstincts: 1,
      maxFacts: 3,
      maxArtifacts: 4,
      maxRevisions: 1,
      includePreviousSummary: false,
      includeFileOps: false,
      failOpen: false,
    },
  });

  assert.equal(settings.compaction.enabled, false);
  assert.equal(settings.compaction.mode, "observe");
  assert.equal(settings.compaction.maxSummaryChars, 1200);
  assert.equal(settings.compaction.maxObservations, 2);
  assert.equal(settings.compaction.maxInstincts, 1);
  assert.equal(settings.compaction.maxFacts, 3);
  assert.equal(settings.compaction.maxArtifacts, 4);
  assert.equal(settings.compaction.maxRevisions, 1);
  assert.equal(settings.compaction.includePreviousSummary, false);
  assert.equal(settings.compaction.includeFileOps, false);
  assert.equal(settings.compaction.failOpen, false);

  assert.throws(() => normalizeSettings({ compaction: { mode: "passive" } }), /compaction\.mode/);
  assert.throws(() => normalizeSettings({ compaction: { maxSummaryChars: 0 } }), /compaction\.maxSummaryChars/);
  assert.throws(() => normalizeSettings({ compaction: { maxObservations: -1 } }), /compaction\.maxObservations/);
  assert.throws(() => normalizeSettings({ compaction: { maxInstincts: 1.5 } }), /compaction\.maxInstincts/);
  assert.throws(() => normalizeSettings({ compaction: { maxFacts: "6" } }), /compaction\.maxFacts/);
});

test("loadVibeMemorySettingsFromFiles merges project over global", async () => {
  const root = await tempDir();
  const globalPath = path.join(root, "global.json");
  const projectPath = path.join(root, "project.json");

  await writeFile(globalPath, JSON.stringify({ vibeMemory: { promptBudgetChars: 1000, hindsight: { bank: "global" } } }));
  await writeFile(projectPath, JSON.stringify({ vibeMemory: { promptBudgetChars: 2000 } }));

  const settings = await loadVibeMemorySettingsFromFiles([globalPath, projectPath]);
  assert.equal(settings.promptBudgetChars, 2000);
  assert.equal(settings.hindsight.bank, "global");
});

test("loadVibeMemorySettingsFromFiles can bootstrap Hindsight REST settings from MCP config", async () => {
  const root = await tempDir();
  const settingsPath = path.join(root, "settings.json");
  const mcpPath = path.join(root, "custom-mcp.json");

  await writeFile(settingsPath, JSON.stringify({ vibeMemory: { hindsight: { source: "mcp", mcpServer: "hindsight" } } }));
  await writeFile(mcpPath, JSON.stringify({
    mcpServers: {
      hindsight: {
        url: "http://192.168.1.112:8888/mcp/pi-agent/",
        headers: { Authorization: "Bearer secret-token" },
      },
    },
  }));

  const settings = await loadVibeMemorySettingsFromFiles([settingsPath], { agentDir: "/unused", mcpConfigPath: mcpPath });
  assert.equal(settings.hindsight.source, "mcp");
  assert.equal(settings.hindsight.baseUrl, "http://192.168.1.112:8888");
  assert.equal(settings.hindsight.apiKey, "secret-token");
  assert.equal(settings.hindsight.bank, "pi-agent");

  await writeFile(settingsPath, JSON.stringify({ vibeMemory: { hindsight: { source: "mcp", bank: "custom-bank" } } }));
  const explicitBank = await loadVibeMemorySettingsFromFiles([settingsPath], { mcpConfigPath: mcpPath });
  assert.equal(explicitBank.hindsight.bank, "custom-bank");
});

test("loadVibeMemorySettingsFromFiles disables MCP Hindsight when configured server is missing", async () => {
  const root = await tempDir();
  const settingsPath = path.join(root, "settings.json");
  const mcpPath = path.join(root, "custom-mcp.json");

  await writeFile(settingsPath, JSON.stringify({ vibeMemory: { hindsight: { source: "mcp", mcpServer: "missing" } } }));
  await writeFile(mcpPath, JSON.stringify({ mcpServers: { other: { url: "http://10.0.0.2:8888/mcp/team/sse" } } }));

  const settings = await loadVibeMemorySettingsFromFiles([settingsPath], { mcpConfigPath: mcpPath });

  assert.equal(settings.hindsight.enabled, false);
  assert.equal(settings.hindsight.baseUrl, DEFAULT_SETTINGS.hindsight.baseUrl);
  assert.ok(settings.configWarnings.some((warning) => /missing.*not found|disabled/i.test(warning)));
});

test("loadVibeMemorySettingsFromFiles derives bank from /mcp/<bank>/sse path segment", async () => {
  const root = await tempDir();
  const settingsPath = path.join(root, "settings.json");
  const mcpPath = path.join(root, "custom-mcp.json");

  await writeFile(settingsPath, JSON.stringify({ vibeMemory: { hindsight: { source: "mcp", mcpServer: "hindsight" } } }));
  await writeFile(mcpPath, JSON.stringify({ mcpServers: { hindsight: { url: "http://192.168.1.112:8888/mcp/team-memory/sse" } } }));

  const settings = await loadVibeMemorySettingsFromFiles([settingsPath], { mcpConfigPath: mcpPath });

  assert.equal(settings.hindsight.baseUrl, "http://192.168.1.112:8888");
  assert.equal(settings.hindsight.bank, "team-memory");
});

test("detectConflicts ignores passive or disabled migration-only legacy config", () => {
  assert.deepEqual(detectConflicts({
    packages: ["npm:pi-observational-memory"],
    "observational-memory": { passive: true },
  }), []);

  assert.deepEqual(detectConflicts({ continuousLearning: { enabled: false } }), []);
  assert.deepEqual(detectConflicts({
    packages: ["npm:pi-continuous-learning"],
    continuousLearning: { enabled: false },
  }), []);
});

test("detectConflicts warns about known memory owners", () => {
  const conflicts = detectConflicts({
    packages: ["npm:pi-observational-memory", "npm:pi-continuous-learning", "git:github.com/GeneGulanesJr/LaPis"],
    "observational-memory": { passive: false },
  });

  assert.ok(conflicts.some((c) => c.includes("pi-observational-memory")));
  assert.ok(conflicts.some((c) => c.includes("pi-continuous-learning")));
  assert.ok(conflicts.some((c) => c.includes("LaPis")));
});
