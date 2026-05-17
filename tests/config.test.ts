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
  assert.equal(settings.hindsight.baseUrl, "http://localhost:8888");
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
  assert.throws(() => normalizeSettings({ instincts: { minEvidence: 0 } }), /instincts\.minEvidence/);
  assert.throws(() => normalizeSettings({ revision: { maxPromptItems: 0 } }), /revision\.maxPromptItems/);
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

test("detectConflicts warns about known memory owners", () => {
  const conflicts = detectConflicts({
    packages: ["npm:pi-observational-memory", "npm:pi-continuous-learning", "git:github.com/GeneGulanesJr/LaPis"],
    "observational-memory": { passive: false },
  });

  assert.ok(conflicts.some((c) => c.includes("pi-observational-memory")));
  assert.ok(conflicts.some((c) => c.includes("pi-continuous-learning")));
  assert.ok(conflicts.some((c) => c.includes("LaPis")));
});
