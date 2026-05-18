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
    migrationStatus: {
      continuousLearning: { dryRunCompleted: true, applied: true, needsReview: 0 },
    },
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

test("runDoctorChecks surfaces config warnings without making the summary fail", () => {
  const result = runDoctorChecks({
    settings: DEFAULT_SETTINGS,
    configWarnings: ["Hindsight MCP source requested but server \"hindsight\" was not found"],
  });

  assert.equal(result.ok, true);
  const check = result.checks.find((item) => item.name === "config warnings");
  assert.equal(check?.status, "warn");
  assert.match(check?.message ?? "", /Hindsight MCP source requested/);
  assert.deepEqual(check?.details, ["Hindsight MCP source requested but server \"hindsight\" was not found"]);
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
  assert.equal(result.safeToUninstallLegacy, false);
  assert.equal(result.checks.find((check) => check.name === "Legacy replacement readiness")?.status, "fail");
  assert.equal(result.checks.find((check) => check.name === "database health")?.status, "pass");
  assert.equal(result.checks.find((check) => check.name === "hindsight health")?.status, "pass");
});

test("runDoctorChecks reports legacy replacement readiness when migration is known", () => {
  const result = runDoctorChecks({
    settings: DEFAULT_SETTINGS,
    conflicts: [],
    database: { status: "ok", message: "SQLite reachable" },
    hindsight: { status: "offline", message: "Hindsight server is not running" },
    toolNames: Object.values(TOOL_NAMES),
    commandNames: Object.values(COMMAND_NAMES),
    migrationStatus: {
      continuousLearning: { dryRunCompleted: true, applied: true, needsReview: 0 },
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.safeToUninstallLegacy, true);
  assert.deepEqual(result.legacyRemovalAdvice, [
    "pi-vibe-memory is ready to replace npm:pi-observational-memory and npm:pi-continuous-learning.",
    "Remove the legacy packages from Pi settings and keep only npm:pi-vibe-memory as the memory owner.",
  ]);
  assert.equal(result.checks.find((check) => check.name === "Legacy replacement readiness")?.status, "pass");
});

test("runDoctorChecks blocks legacy uninstall readiness when legacy owners are active", () => {
  const result = runDoctorChecks({
    settings: DEFAULT_SETTINGS,
    conflicts: ["pi-observational-memory appears active"],
    database: { status: "ok", message: "SQLite reachable" },
    toolNames: Object.values(TOOL_NAMES),
    commandNames: Object.values(COMMAND_NAMES),
    migrationStatus: {
      continuousLearning: { dryRunCompleted: true, applied: true, needsReview: 0 },
    },
  });

  assert.equal(result.safeToUninstallLegacy, false);
  assert.equal(result.checks.find((check) => check.name === "Legacy replacement readiness")?.status, "fail");
  assert.equal(result.checks.find((check) => check.name === "Legacy replacement readiness")?.message, "Competing memory owner cleanup required before legacy replacement is ready.");
  assert.ok(result.legacyRemovalAdvice.some((item) => item.includes("Resolve competing memory owners")));
});

test("runDoctorChecks treats stale legacy config as warning, not uninstall blocker", () => {
  const staleWarning = "Stale observational-memory settings remain in ~/.pi/agent/settings.json with passive:false, but npm:pi-observational-memory is not installed; set observational-memory.passive=true or remove that block.";
  const result = runDoctorChecks({
    settings: DEFAULT_SETTINGS,
    configWarnings: [staleWarning],
    conflicts: [],
    database: { status: "ok", message: "SQLite reachable" },
    toolNames: Object.values(TOOL_NAMES),
    commandNames: Object.values(COMMAND_NAMES),
    migrationStatus: {
      continuousLearning: { dryRunCompleted: true, applied: true, needsReview: 0 },
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.safeToUninstallLegacy, true);
  assert.equal(result.checks.find((check) => check.name === "config warnings")?.status, "warn");
  assert.equal(result.checks.find((check) => check.name === "Legacy replacement readiness")?.status, "pass");
  assert.ok(!result.legacyRemovalAdvice.some((item) => item.includes("Resolve competing memory owners")));
});

test("runDoctorChecks blocks legacy uninstall readiness when migration status is missing", () => {
  const result = runDoctorChecks({
    settings: DEFAULT_SETTINGS,
    conflicts: [],
    database: { status: "ok", message: "SQLite reachable" },
    toolNames: Object.values(TOOL_NAMES),
    commandNames: Object.values(COMMAND_NAMES),
  });

  assert.equal(result.ok, true);
  assert.equal(result.safeToUninstallLegacy, false);
  assert.equal(result.checks.find((check) => check.name === "Legacy replacement readiness")?.status, "warn");
  assert.ok(result.legacyRemovalAdvice.some((item) => item.includes("Run /vibe-memory-import continuous-learning --dry-run")));
});

test("runDoctorChecks blocks legacy uninstall readiness after preview-only migration", () => {
  const result = runDoctorChecks({
    settings: DEFAULT_SETTINGS,
    conflicts: [],
    database: { status: "ok", message: "SQLite reachable" },
    toolNames: Object.values(TOOL_NAMES),
    commandNames: Object.values(COMMAND_NAMES),
    migrationStatus: {
      continuousLearning: { dryRunCompleted: true, applied: false, needsReview: 0 },
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.safeToUninstallLegacy, false);
  assert.equal(result.checks.find((check) => check.name === "Legacy replacement readiness")?.status, "warn");
  assert.ok(result.legacyRemovalAdvice.some((item) => item.includes("apply the import explicitly")));
});
