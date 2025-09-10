import Database from 'better-sqlite3';

export const db = new Database('rpg.sqlite');

db.exec(`
CREATE TABLE IF NOT EXISTS characters (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  voice TEXT,
  provider TEXT,
  system_prompt TEXT NOT NULL,
  memory_json TEXT NOT NULL,
  avatar_uri TEXT,
  profile_uri TEXT,
  birth_year INTEGER,
  age INTEGER,
  base_json TEXT,
  created_at INTEGER,
  updated_at INTEGER
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  title TEXT,
  provider TEXT,
  participants_json TEXT NOT NULL,
  started_at INTEGER,
  ended_at INTEGER
);
CREATE TABLE IF NOT EXISTS turns (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  role TEXT,
  speaker TEXT,
  text TEXT,
  audio_path TEXT,
  created_at INTEGER,
  meta_json TEXT
);
CREATE TABLE IF NOT EXISTS capsules (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  speaker TEXT,
  tail_text TEXT,
  resume_hint TEXT,
  hook TEXT,
  drop_if TEXT,
  ttl_ms INTEGER,
  created_at INTEGER
);
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  character_id TEXT,
  session_id TEXT,
  text TEXT,
  scope_json TEXT,
  sources_json TEXT,
  created_at INTEGER
);
CREATE TABLE IF NOT EXISTS scene_state (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  current_json TEXT,
  updated_at INTEGER
);
CREATE TABLE IF NOT EXISTS snapshots (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  turn_id TEXT,
  payload_json TEXT,
  created_at INTEGER
);
CREATE TABLE IF NOT EXISTS timelines (
  id TEXT PRIMARY KEY,
  scope TEXT,
  owner_id TEXT,
  created_at INTEGER,
  updated_at INTEGER
);
CREATE TABLE IF NOT EXISTS timeline_events (
  id TEXT PRIMARY KEY,
  timeline_id TEXT,
  occurred_at INTEGER,
  title TEXT,
  summary TEXT,
  location TEXT,
  participants_json TEXT,
  sources_json TEXT,
  created_at INTEGER
);
`);

// Best-effort migrations for older DBs (add missing columns)
try { db.prepare('ALTER TABLE characters ADD COLUMN age INTEGER').run(); } catch {}
try { db.prepare('ALTER TABLE characters ADD COLUMN birth_year INTEGER').run(); } catch {}
try { db.prepare('ALTER TABLE characters ADD COLUMN profile_uri TEXT').run(); } catch {}
try { db.prepare('ALTER TABLE characters ADD COLUMN base_json TEXT').run(); } catch {}
