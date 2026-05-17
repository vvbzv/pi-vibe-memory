export const PACKAGE_NAME = "pi-vibe-memory";
export const CONFIG_KEY = "vibeMemory";
export const DEFAULT_DB_RELATIVE_PATH = "vibe-memory/memory.db";
export const CUSTOM_ENTRY_TYPE = "pi-vibe-memory.event";

export const TOOL_NAMES = {
  recall: "vibe_memory_recall",
  remember: "vibe_memory_remember",
  explain: "vibe_memory_explain",
  status: "vibe_memory_status",
  sync: "vibe_memory_sync",
  import: "vibe_memory_import",
  meditate: "vibe_memory_meditate",
  reviewInstincts: "vibe_memory_review_instincts",
  compare: "vibe_memory_compare",
  revise: "vibe_memory_revise",
} as const;

export const COMMAND_NAMES = {
  status: "vibe-memory-status",
  view: "vibe-memory-view",
  sync: "vibe-memory-sync",
  import: "vibe-memory-import",
  meditate: "vibe-memory-meditate",
  reviewInstincts: "vibe-memory-review-instincts",
  disableInjection: "vibe-memory-disable-injection",
} as const;
