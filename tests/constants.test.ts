import test from "node:test";
import assert from "node:assert/strict";
import {
  COMMAND_NAMES,
  CONFIG_KEY,
  CUSTOM_ENTRY_TYPE,
  DEFAULT_DB_RELATIVE_PATH,
  PACKAGE_NAME,
  TOOL_NAMES,
  ALLOWED_MEMORY_KINDS,
} from "../src/constants.js";

test("public names are Pi-specific and collision-resistant", () => {
  assert.equal(PACKAGE_NAME, "pi-vibe-memory");
  assert.equal(CONFIG_KEY, "vibeMemory");
  assert.equal(DEFAULT_DB_RELATIVE_PATH, "vibe-memory/memory.db");
  assert.equal(CUSTOM_ENTRY_TYPE, "pi-vibe-memory.event");

  for (const name of Object.values(TOOL_NAMES)) {
    assert.match(name, /^vibe_memory_/);
    assert.notEqual(name, "recall");
    assert.ok(!name.startsWith("fact_"));
    assert.ok(!name.startsWith("instinct_"));
    assert.ok(!/forget|delete/.test(name));
  }

  for (const name of Object.values(COMMAND_NAMES)) {
    assert.match(name, /^vibe-memory-/);
    assert.ok(!/forget|delete/.test(name));
  }
});


test("typed memory kinds include continuous-learning replacement and existing local kinds", () => {
  for (const kind of [
    "project_fact",
    "user_preference",
    "project_decision",
    "environment_fact",
    "behavior_instinct",
    "risk_note",
    "revision_note",
    "turn_summary",
    "code_reference",
    "doc_reference",
  ]) {
    assert.ok(ALLOWED_MEMORY_KINDS.includes(kind as any), `${kind} should be allowed`);
  }
});
