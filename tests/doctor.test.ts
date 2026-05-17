import test from "node:test";
import assert from "node:assert/strict";
import { COMMAND_NAMES, TOOL_NAMES } from "../src/constants.js";
import { DEFAULT_SETTINGS } from "../src/config.js";
import { runDoctorChecks } from "../src/doctor.js";

test("runDoctorChecks passes for safe defaults and healthy probes", () => {
  const result = runDoctorChecks({
    settings: DEFAULT_SETTINGS,
    conflicts: [],
    database: { status: "ok", message: "SQLite reachable" },
    hindsight: { status: "ok", message: "Hindsight reachable" },
    toolNames: Object.values(TOOL_NAMES),
    commandNames: Object.values(COMMAND_NAMES),
    revision: DEFAULT_SETTINGS.revision,
  });

  assert.equal(result.ok, true);
  assert.ok(result.checks.length >= 5);
  assert.ok(result.checks.every((check) => check.status === "pass"));
  assert.ok(result.checks.some((check) => check.name === "settings"));
  assert.ok(result.checks.some((check) => check.name === "safety names"));
});

test("runDoctorChecks reports warnings without making the summary fail", () => {
  const result = runDoctorChecks({
    settings: {
      ...DEFAULT_SETTINGS,
      captureRawPrompts: true,
      promptBudgetChars: 4500,
    },
    conflicts: [],
    hindsight: { status: "offline", message: "Hindsight server is not running" },
    revision: { ...DEFAULT_SETTINGS.revision, enabled: false },
  });

  assert.equal(result.ok, true);

  const statuses = Object.fromEntries(result.checks.map((check) => [check.name, check.status]));
  assert.equal(statuses.settings, "warn");
  assert.equal(statuses["hindsight health"], "warn");
  assert.equal(statuses["revision safety"], "warn");
  assert.match(result.checks.find((check) => check.name === "settings")?.message ?? "", /captureRawPrompts/i);
});

test("runDoctorChecks fails on high token budget, conflicts, failed probes, and unsafe names", () => {
  const result = runDoctorChecks({
    settings: {
      ...DEFAULT_SETTINGS,
      promptBudgetChars: 9000,
    },
    conflicts: ["pi-observational-memory appears active"],
    database: { status: "error", message: "cannot open database" },
    hindsight: { status: "error", message: "connection refused" },
    toolNames: ["vibe_memory_recall", "forget_memory", "vibe_memory_fact_write"],
    commandNames: ["vibe-memory-status", "delete-memory"],
    revision: {
      enabled: true,
      maxPromptItems: 1,
      destructiveDeleteMode: true,
    },
  });

  assert.equal(result.ok, false);

  const statuses = Object.fromEntries(result.checks.map((check) => [check.name, check.status]));
  assert.equal(statuses.settings, "fail");
  assert.equal(statuses.conflicts, "fail");
  assert.equal(statuses["database health"], "fail");
  assert.equal(statuses["hindsight health"], "fail");
  assert.equal(statuses["safety names"], "fail");
  assert.equal(statuses["revision safety"], "fail");

  assert.match(result.checks.find((check) => check.name === "settings")?.message ?? "", /promptBudgetChars/i);
  assert.deepEqual(result.checks.find((check) => check.name === "conflicts")?.details, [
    "pi-observational-memory appears active",
  ]);
});

test("runDoctorChecks accepts omitted optional probes as deterministic passes", () => {
  const result = runDoctorChecks({
    settings: { enabled: true, mode: "toolsOnly", promptBudgetChars: 3500, captureRawPrompts: false },
    conflicts: [],
  });

  assert.equal(result.ok, true);
  assert.equal(result.checks.find((check) => check.name === "database health")?.status, "pass");
  assert.equal(result.checks.find((check) => check.name === "hindsight health")?.status, "pass");
});
