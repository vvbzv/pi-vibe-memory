export const PACKAGE_NAME = "pi-vibe-memory";
export const CONFIG_KEY = "vibeMemory";
export const DEFAULT_DB_RELATIVE_PATH = "vibe-memory/memory.db";
export const CUSTOM_ENTRY_TYPE = "pi-vibe-memory.event";

export const ALLOWED_MEMORY_KINDS = [
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
  "config_reference",
  "test_reference",
  "decision",
  "fact",
  "preference",
  "explicit_memory",
  "revision",
] as const;

export const MEMORY_SCOPES = ["project", "global", "personal", "workspace", "session"] as const;
export const REVIEW_ACTIONS = ["list", "approve_active", "approve_scoped", "keep_old", "mark_old_failed", "defer", "explain"] as const;

export const TOOL_NAMES = {
  recall: "vibe_memory_recall",
  remember: "vibe_memory_remember",
  explain: "vibe_memory_explain",
  status: "vibe_memory_status",
  sync: "vibe_memory_sync",
  import: "vibe_memory_import",
  meditate: "vibe_memory_meditate",
  review: "vibe_memory_review",
  reviewInstincts: "vibe_memory_review_instincts",
  compare: "vibe_memory_compare",
  revise: "vibe_memory_revise",
  doctor: "vibe_memory_doctor",
} as const;

export const COMMAND_NAMES = {
  status: "vibe-memory-status",
  view: "vibe-memory-view",
  sync: "vibe-memory-sync",
  import: "vibe-memory-import",
  meditate: "vibe-memory-meditate",
  review: "vibe-memory-review",
  reviewInstincts: "vibe-memory-review-instincts",
  disableInjection: "vibe-memory-disable-injection",
  doctor: "vibe-memory-doctor",
} as const;
