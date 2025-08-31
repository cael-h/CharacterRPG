import { db } from '../db.js';
import { randomUUID as uuid } from 'crypto';
import { addTimelineEvent } from './fileIO.js';

export function ensureTimeline(scope: 'global' | 'character', ownerId: string | null) {
  const row = db.prepare('SELECT * FROM timelines WHERE scope=? AND owner_id IS ?').get(scope, ownerId);
  if (!row) {
    db.prepare('INSERT INTO timelines VALUES (?,?,?,?,?)').run(uuid(), scope, ownerId, Date.now(), Date.now());
  }
}

export function addEvent(opts: {
  scope: 'global' | 'character';
  ownerId: string | null; // null for global
  occurredAt?: number;
  title: string;
  summary: string;
  location?: string;
  participants?: string[];
  sources?: any;
}) {
  ensureTimeline(opts.scope, opts.ownerId ?? null);
  const trow = db.prepare('SELECT id FROM timelines WHERE scope=? AND owner_id IS ?').get(opts.scope, opts.ownerId ?? null);
  const id = uuid();
  const now = Date.now();
  const occurred = opts.occurredAt ?? now;
  db.prepare('INSERT INTO timeline_events VALUES (?,?,?,?,?,?,?,?,?)')
    .run(
      id,
      trow.id,
      occurred,
      opts.title,
      opts.summary,
      opts.location ?? null,
      JSON.stringify(opts.participants ?? []),
      JSON.stringify(opts.sources ?? {}),
      now
    );
  addTimelineEvent(opts.ownerId ?? 'global', opts.title, opts.summary);
}

