import { COMMAND_NAMES, TOOL_NAMES } from "./constants.js";

type CheckStatus = "pass" | "warn" | "fail";
type ProbeStatus = "ok" | "error";
type HindsightStatus = ProbeStatus | "offline";

type SettingsInput = {
  enabled?: boolean;
  mode?: string;
  promptBudgetChars?: number;
  captureRawPrompts?: boolean;
  configWarnings?: string[];
  revision?: RevisionInput;
  compaction?: {
    mode?: string;
  };
};

type RevisionInput = {
  enabled?: boolean;
  maxPromptItems?: number;
  destructiveDeleteMode?: boolean;
  deleteMode?: boolean | string;
};

type ProbeInput<T extends string> = {
  status: T;
  message?: string;
  details?: unknown;
};

type MigrationStatusInput = {
  continuousLearning?: {
    dryRunCompleted?: boolean;
    applied?: boolean;
    status?: string;
    needsReview?: number;
  };
};

export type DoctorCheck = {
  name: string;
  status: CheckStatus;
  message: string;
  details?: unknown;
};

export type DoctorResult = {
  ok: boolean;
  checks: DoctorCheck[];
  safeToUninstallLegacy: boolean;
  legacyRemovalAdvice: string[];
};

export type DoctorInput = {
  settings?: SettingsInput;
  conflicts?: string[];
  database?: ProbeInput<ProbeStatus>;
  hindsight?: ProbeInput<HindsightStatus>;
  toolNames?: readonly string[];
  commandNames?: readonly string[];
  revision?: RevisionInput;
  migrationStatus?: MigrationStatusInput;
  configWarnings?: string[];
};

const TOKEN_LIGHT_PROMPT_BUDGET = 3500;
const FAIL_PROMPT_BUDGET = 8000;
const FORBIDDEN_NAME_PATTERN = /(^|[_-])(forget|delete)($|[_-])|^recall$|(^|[_-])fact[_-]|(^|[_-])instinct[_-]/i;

const REQUIRED_LEGACY_REPLACEMENT_TOOLS = [
  TOOL_NAMES.review,
  TOOL_NAMES.doctor,
  TOOL_NAMES.import,
  TOOL_NAMES.remember,
  TOOL_NAMES.recall,
] as const;

const REQUIRED_LEGACY_REPLACEMENT_COMMANDS = [
  COMMAND_NAMES.review,
  COMMAND_NAMES.doctor,
  COMMAND_NAMES.import,
] as const;

const READY_TO_REMOVE_LEGACY_ADVICE = [
  "pi-vibe-memory is ready to replace npm:pi-observational-memory and npm:pi-continuous-learning.",
  "Remove the legacy packages from Pi settings and keep only npm:pi-vibe-memory as the memory owner.",
] as const;

function missingNames(required: readonly string[], available: readonly string[] | undefined): string[] {
  const names = new Set(available ?? required);
  return required.filter((name) => !names.has(name));
}

function hasAppliedMigrationStatus(migrationStatus: MigrationStatusInput | undefined): boolean {
  const continuousLearning = migrationStatus?.continuousLearning;
  if (!continuousLearning) return false;
  if (continuousLearning.applied === true) return true;
  return typeof continuousLearning.status === "string" && ["imported", "complete", "completed"].includes(continuousLearning.status);
}

function checkLegacyReplacementReadiness(input: DoctorInput): { check: DoctorCheck; safeToUninstallLegacy: boolean; legacyRemovalAdvice: string[] } {
  const blockers: string[] = [];
  const advice: string[] = [];

  if (input.settings?.enabled !== true) blockers.push("Enable vibeMemory.enabled.");
  if (input.settings?.mode !== "owner") blockers.push('Set vibeMemory.mode to "owner".');
  if (input.settings?.compaction?.mode !== "owner") blockers.push('Set vibeMemory.compaction.mode to "owner".');

  const missingTools = missingNames(REQUIRED_LEGACY_REPLACEMENT_TOOLS, input.toolNames);
  if (missingTools.length > 0) blockers.push(`Register required tools: ${missingTools.join(", ")}.`);

  const missingCommands = missingNames(REQUIRED_LEGACY_REPLACEMENT_COMMANDS, input.commandNames);
  if (missingCommands.length > 0) blockers.push(`Register required commands: ${missingCommands.join(", ")}.`);

  if ((input.conflicts ?? []).length > 0) blockers.push("Resolve competing memory owners before removing legacy packages.");
  if (input.database?.status !== "ok") blockers.push("Run doctor with a passing database health probe.");

  const migrationApplied = hasAppliedMigrationStatus(input.migrationStatus);
  if (!migrationApplied) advice.push("Run /vibe-memory-import continuous-learning --dry-run, then apply the import explicitly when the preview is correct.");

  if (blockers.length > 0) {
    const onlyCompetingOwnerBlocker = blockers.length === 1 && blockers[0] === "Resolve competing memory owners before removing legacy packages.";
    return {
      safeToUninstallLegacy: false,
      legacyRemovalAdvice: [...blockers, ...advice],
      check: {
        name: "Legacy replacement readiness",
        status: "fail",
        message: onlyCompetingOwnerBlocker
          ? "Competing memory owner cleanup required before legacy replacement is ready."
          : "Not safe to uninstall legacy memory packages yet.",
        details: [...blockers, ...advice],
      },
    };
  }

  if (advice.length > 0) {
    return {
      safeToUninstallLegacy: false,
      legacyRemovalAdvice: advice,
      check: {
        name: "Legacy replacement readiness",
        status: "warn",
        message: "Migration status is not known, so legacy removal is not ready yet.",
        details: advice,
      },
    };
  }

  return {
    safeToUninstallLegacy: true,
    legacyRemovalAdvice: [...READY_TO_REMOVE_LEGACY_ADVICE],
    check: {
      name: "Legacy replacement readiness",
      status: "pass",
      message: "Safe to uninstall legacy memory packages after settings are updated.",
    },
  };
}

function checkSettings(settings: SettingsInput | undefined): DoctorCheck {
  const issues: string[] = [];
  const warnings: string[] = [];

  if (!settings) {
    return { name: "settings", status: "warn", message: "No settings provided for doctor sanity check." };
  }

  if (settings.enabled === false) warnings.push("vibeMemory.enabled is false");
  if (settings.mode && !["owner", "passive", "toolsOnly"].includes(settings.mode)) issues.push(`mode is invalid: ${settings.mode}`);

  if (typeof settings.promptBudgetChars !== "number" || !Number.isFinite(settings.promptBudgetChars)) {
    issues.push("promptBudgetChars is missing or invalid");
  } else if (settings.promptBudgetChars > FAIL_PROMPT_BUDGET) {
    issues.push(`promptBudgetChars ${settings.promptBudgetChars} is too high for token-light memory`);
  } else if (settings.promptBudgetChars > TOKEN_LIGHT_PROMPT_BUDGET) {
    warnings.push(`promptBudgetChars ${settings.promptBudgetChars} exceeds token-light target ${TOKEN_LIGHT_PROMPT_BUDGET}`);
  }

  if (settings.captureRawPrompts === true) warnings.push("captureRawPrompts should stay false by default");

  if (issues.length > 0) return { name: "settings", status: "fail", message: issues.join("; "), details: issues };
  if (warnings.length > 0) return { name: "settings", status: "warn", message: warnings.join("; "), details: warnings };
  return { name: "settings", status: "pass", message: "Settings are enabled, token-light, and avoid raw prompt capture." };
}

function checkConfigWarnings(warnings: string[] | undefined): DoctorCheck {
  if (warnings && warnings.length > 0) {
    return {
      name: "config warnings",
      status: "warn",
      message: warnings.join("; "),
      details: warnings,
    };
  }
  return { name: "config warnings", status: "pass", message: "No configuration warnings reported." };
}

function checkConflicts(conflicts: string[] | undefined): DoctorCheck {
  if (conflicts && conflicts.length > 0) {
    return {
      name: "conflicts",
      status: "fail",
      message: `${conflicts.length} competing memory owner${conflicts.length === 1 ? "" : "s"} detected.`,
      details: conflicts,
    };
  }
  return { name: "conflicts", status: "pass", message: "No competing memory owners reported." };
}

function checkDatabase(database: ProbeInput<ProbeStatus> | undefined): DoctorCheck {
  if (!database) return { name: "database health", status: "pass", message: "No database probe provided; skipped." };
  if (database.status === "ok") return { name: "database health", status: "pass", message: database.message ?? "Database probe passed.", details: database.details };
  return { name: "database health", status: "fail", message: database.message ?? "Database probe failed.", details: database.details };
}

function checkHindsight(hindsight: ProbeInput<HindsightStatus> | undefined): DoctorCheck {
  if (!hindsight) return { name: "hindsight health", status: "pass", message: "No Hindsight probe provided; skipped." };
  if (hindsight.status === "ok") return { name: "hindsight health", status: "pass", message: hindsight.message ?? "Hindsight probe passed.", details: hindsight.details };
  if (hindsight.status === "offline") return { name: "hindsight health", status: "warn", message: hindsight.message ?? "Hindsight is offline; local memory can continue.", details: hindsight.details };
  return { name: "hindsight health", status: "fail", message: hindsight.message ?? "Hindsight probe failed.", details: hindsight.details };
}

function hasExpectedNamespace(name: string): boolean {
  return name.startsWith("vibe_memory_") || name.startsWith("vibe-memory-");
}

function checkSafetyNames(toolNames: readonly string[] | undefined, commandNames: readonly string[] | undefined): DoctorCheck {
  const names = [...(toolNames ?? Object.values(TOOL_NAMES)), ...(commandNames ?? Object.values(COMMAND_NAMES))];
  const unsafe = names.filter((name) => !hasExpectedNamespace(name) || FORBIDDEN_NAME_PATTERN.test(name));

  if (unsafe.length > 0) {
    return {
      name: "safety names",
      status: "fail",
      message: "Tool/command names must be namespaced and avoid destructive or generic memory names.",
      details: unsafe,
    };
  }

  return { name: "safety names", status: "pass", message: "Tool and command names are namespaced and non-destructive." };
}

function checkRevisionSafety(settings: SettingsInput | undefined, revision: RevisionInput | undefined): DoctorCheck {
  const revisionSettings = revision ?? settings?.revision;
  if (!revisionSettings) return { name: "revision safety", status: "pass", message: "No destructive revision mode reported." };

  if (revisionSettings.destructiveDeleteMode === true || revisionSettings.deleteMode === true || revisionSettings.deleteMode === "destructive") {
    return {
      name: "revision safety",
      status: "fail",
      message: "Revision must supersede or inhibit old knowledge, not destructively delete it.",
    };
  }

  if (revisionSettings.enabled === false) {
    return {
      name: "revision safety",
      status: "warn",
      message: "Comparative revision is disabled; old knowledge will not be superseded automatically.",
    };
  }

  return { name: "revision safety", status: "pass", message: "Revision safety is non-destructive." };
}

export function runDoctorChecks(input: DoctorInput = {}): DoctorResult {
  const readiness = checkLegacyReplacementReadiness(input);
  const baseChecks = [
    checkSettings(input.settings),
    checkConfigWarnings(input.configWarnings ?? input.settings?.configWarnings),
    checkConflicts(input.conflicts),
    checkDatabase(input.database),
    checkHindsight(input.hindsight),
    checkSafetyNames(input.toolNames, input.commandNames),
    checkRevisionSafety(input.settings, input.revision),
  ];
  const checks = [...baseChecks, readiness.check];

  return {
    ok: baseChecks.every((check) => check.status !== "fail"),
    checks,
    safeToUninstallLegacy: readiness.safeToUninstallLegacy,
    legacyRemovalAdvice: readiness.legacyRemovalAdvice,
  };
}
