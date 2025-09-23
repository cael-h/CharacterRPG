import { db } from '../db.js';
import { randomUUID as uuid } from 'crypto';
import type { SceneStateFullRow } from '../types.js';

type SettingDelta = Record<string, unknown> & { time?: string };

export function updateSetting(sessionId: string, delta: SettingDelta) {
  // Merge new state with existing
  const now = Date.now();
  const row = db
    .prepare('SELECT * FROM scene_state WHERE session_id=? ORDER BY updated_at DESC LIMIT 1')
    .get(sessionId) as SceneStateFullRow | undefined;
  const current = row?.current_json
    ? JSON.parse(row.current_json)
    : { locations: [], participants: [], time: new Date().toISOString() };
  const next = { ...current, ...delta };
  const id = uuid();
  db.prepare('INSERT INTO scene_state VALUES (?,?,?,?)').run(id, sessionId, JSON.stringify(next), now);
}
