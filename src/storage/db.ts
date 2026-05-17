import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { SCHEMA_SQL, SCHEMA_VERSION } from "./schema.js";

export type VibeMemoryDb = Database.Database;

export function openVibeMemoryDb(dbPath: string): VibeMemoryDb {
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("foreign_keys = ON");

  assertFts5Support(db);
  migrate(db);
  ensureMetadataTable(db);

  return db;
}

function assertFts5Support(db: VibeMemoryDb): void {
  try {
    db.prepare("CREATE VIRTUAL TABLE temp.__pvm_fts_check USING fts5(value)").run();
    db.prepare("DROP TABLE temp.__pvm_fts_check").run();
  } catch (error) {
    throw new Error(`SQLite FTS5 is required for pi-vibe-memory: ${(error as Error).message}`);
  }
}

function migrate(db: VibeMemoryDb): void {
  const current = db.pragma("user_version", { simple: true }) as number;
  if (current === SCHEMA_VERSION) return;
  if (current !== 0) {
    throw new Error(`Unsupported pi-vibe-memory schema version ${current}; expected ${SCHEMA_VERSION}`);
  }

  const applySchema = db.transaction(() => {
    db.exec(SCHEMA_SQL);
    db.pragma(`user_version = ${SCHEMA_VERSION}`);
  });
  applySchema();
}


function ensureMetadataTable(db: VibeMemoryDb): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS repository_metadata (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}
