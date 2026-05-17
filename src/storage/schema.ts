export const SCHEMA_VERSION = 1;

export const MEMORY_STATUSES = ["active", "superseded", "historical", "working", "needs_review"] as const;

export const SCHEMA_SQL = `
CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  root_path TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  branch_id TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  model TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE raw_events (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  entry_id TEXT,
  parent_entry_id TEXT,
  kind TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  content_json TEXT NOT NULL,
  scrubbed INTEGER NOT NULL DEFAULT 1,
  token_estimate INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE observations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  session_id TEXT REFERENCES sessions(id),
  kind TEXT NOT NULL,
  scope TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  source_event_ids_json TEXT NOT NULL DEFAULT '[]',
  tags_json TEXT NOT NULL DEFAULT '[]',
  confidence REAL NOT NULL DEFAULT 0.5,
  trust REAL NOT NULL DEFAULT 0.7,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'superseded', 'historical', 'working', 'needs_review')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  synced_at TEXT,
  hindsight_document_id TEXT
);

CREATE INDEX observations_workspace_status_updated_idx
  ON observations(workspace_id, status, updated_at);

CREATE TABLE artifact_references (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  session_id TEXT REFERENCES sessions(id),
  observation_id TEXT REFERENCES observations(id),
  path TEXT NOT NULL,
  artifact_type TEXT NOT NULL,
  symbol TEXT,
  line_start INTEGER,
  line_end INTEGER,
  source_event_ids_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(workspace_id, path, artifact_type, symbol, line_start, line_end)
);

CREATE INDEX artifact_references_workspace_path_idx
  ON artifact_references(workspace_id, path);

CREATE TABLE meditation_runs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  session_id TEXT REFERENCES sessions(id),
  trigger TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  error TEXT,
  input_observation_ids_json TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE instinct_candidates (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  session_id TEXT REFERENCES sessions(id),
  meditation_run_id TEXT REFERENCES meditation_runs(id),
  kind TEXT NOT NULL,
  trigger TEXT,
  action TEXT,
  content TEXT NOT NULL,
  evidence_observation_ids_json TEXT NOT NULL DEFAULT '[]',
  confidence REAL NOT NULL DEFAULT 0.5,
  status TEXT NOT NULL DEFAULT 'working' CHECK (status IN ('active', 'superseded', 'historical', 'working', 'needs_review')),
  durable_approved INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT
);

CREATE INDEX instinct_candidates_workspace_status_idx
  ON instinct_candidates(workspace_id, status, confidence);

CREATE TABLE memory_revisions (
  id TEXT PRIMARY KEY,
  old_observation_id TEXT NOT NULL REFERENCES observations(id),
  new_observation_id TEXT NOT NULL REFERENCES observations(id),
  relation TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX memory_revisions_old_idx ON memory_revisions(old_observation_id, created_at);
CREATE INDEX memory_revisions_new_idx ON memory_revisions(new_observation_id, created_at);

CREATE TABLE trust_adjustments (
  id TEXT PRIMARY KEY,
  observation_id TEXT NOT NULL REFERENCES observations(id),
  delta REAL NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE sync_queue (
  id TEXT PRIMARY KEY,
  observation_id TEXT REFERENCES observations(id),
  operation TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX sync_queue_created_idx ON sync_queue(created_at);

CREATE VIRTUAL TABLE observations_fts USING fts5(
  observation_id UNINDEXED,
  workspace_id UNINDEXED,
  title,
  content,
  kind,
  scope
);
`;
