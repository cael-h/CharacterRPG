import { Router } from 'express';
import type { Request, Response } from 'express';
import { db } from '../db.js';
import { storyDirFor, storyTimelinePath } from '../services/paths.js';
import { addEvent } from '../services/timeline.js';
import fs from 'fs';
import path from 'path';
import type {
  CharacterIdNameRow,
  StorySummaryRow,
  StoryParticipantRow,
  SessionStoryRow,
  SessionSummaryRow,
  TimelineIdRow,
  TimelineEventRow,
} from '../types.js';

export const router = Router();

function participantsFor(storyId: string) {
  try {
    const rows = db
      .prepare('SELECT character_id, aware_of_json FROM story_participants WHERE story_id=?')
      .all(storyId) as StoryParticipantRow[];
    const out: Array<{ id: string; name: string | null; aware_of: unknown }> = [];
    for (const r of rows) {
      const c = db
        .prepare('SELECT id, name FROM characters WHERE id=?')
        .get(r.character_id) as CharacterIdNameRow | undefined;
      if (c) {
        let aware: unknown = null;
        if (r.aware_of_json) {
          try { aware = JSON.parse(r.aware_of_json); } catch {}
        }
        out.push({ id: c.id, name: c.name, aware_of: aware });
      }
    }
    return out;
  } catch { return []; }
}

function sessionsFor(storyId: string) {
  try {
    const rows = db
      .prepare('SELECT s.session_id as session_id FROM session_story s WHERE s.story_id=?')
      .all(storyId) as SessionStoryRow[];
    const out: SessionSummaryRow[] = [];
    for (const r of rows) {
      const s = db
        .prepare('SELECT id, title, started_at, ended_at FROM sessions WHERE id=?')
        .get(r.session_id) as SessionSummaryRow | undefined;
      if (s) out.push(s);
    }
    return out;
  } catch { return []; }
}

router.get('/', (_req: Request, res: Response) => {
  try {
    const rows = db
      .prepare('SELECT id, name, created_at, updated_at FROM stories ORDER BY created_at DESC')
      .all() as StorySummaryRow[];
    const items = rows.map((r) => {
      const dir = storyDirFor(r.id);
      const transcripts_dir = dir;
      const timeline_path = storyTimelinePath(r.id);
      const parts = participantsFor(r.id);
      const sess = sessionsFor(r.id);
      return { ...r, participants: parts, sessions: sess, folders: { transcripts_dir, timeline_path, exists: fs.existsSync(transcripts_dir) } };
    });
    res.json(items);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

router.get('/:id', (req: Request<{ id: string }>, res: Response) => {
  try {
    const r = db
      .prepare('SELECT id, name, created_at, updated_at FROM stories WHERE id=?')
      .get(req.params.id) as StorySummaryRow | undefined;
    if (!r) return res.status(404).json({ error: 'not_found' });
    const dir = storyDirFor(r.id);
    const transcripts = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.md')).map(f => path.join(dir, f)) : [];
    const parts = participantsFor(r.id);
    const sess = sessionsFor(r.id);
    res.json({ ...r, participants: parts, sessions: sess, folders: { transcripts_dir: dir, timeline_path: storyTimelinePath(r.id) }, transcripts });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// Append a story timeline event
router.post('/:id/timeline', (req: Request<{ id: string }, unknown, { title?: string; summary?: string; occurred_at?: number; location?: string; participants?: unknown }>, res: Response) => {
  const storyId = req.params.id;
  const row = db.prepare('SELECT id FROM stories WHERE id=?').get(storyId) as { id: string } | undefined;
  if (!row) return res.status(404).json({ error: 'not_found' });
  const { title, summary, occurred_at, location, participants } = req.body || {};
  if (!title || !summary) return res.status(400).json({ error: 'bad_request' });
  try {
    const participantArr = Array.isArray(participants) ? participants.map((p) => String(p)) : undefined;
    addEvent({ scope: 'story', ownerId: storyId, title, summary, occurredAt: occurred_at ? Number(occurred_at) : undefined, location, participants: participantArr });
    res.json({ ok: true, path: storyTimelinePath(storyId) });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// Get story timeline (JSON events and/or markdown content)
router.get('/:id/timeline', (req: Request<{ id: string }, unknown, unknown, { md?: string; format?: string }>, res: Response) => {
  const storyId = req.params.id;
  const wantMd = String(req.query.md || req.query.format || '').toLowerCase() === 'md' || String(req.query.md||'') === '1';
  try {
    const story = db.prepare('SELECT id, name FROM stories WHERE id=?').get(storyId) as StorySummaryRow | undefined;
    if (!story) return res.status(404).json({ error: 'not_found' });
    const trow = db
      .prepare('SELECT id FROM timelines WHERE scope=? AND owner_id IS ?')
      .get('story', storyId) as TimelineIdRow | undefined;
    const events = trow
      ? db
          .prepare('SELECT occurred_at, title, summary, location, participants_json FROM timeline_events WHERE timeline_id=? ORDER BY occurred_at ASC')
          .all(trow.id) as TimelineEventRow[]
      : [];
    const normalizedEvents = Array.isArray(events)
      ? events.map((e) => ({
          occurred_at: e.occurred_at,
          occurred_iso: new Date(Number(e.occurred_at || 0)).toISOString(),
          title: e.title,
          summary: e.summary,
          location: e.location,
          participants: (() => {
            try { return JSON.parse(e.participants_json || '[]'); }
            catch { return []; }
          })(),
        }))
      : [];
    const p = storyTimelinePath(storyId);
    const exists = fs.existsSync(p);
    if (wantMd && exists) {
      try { res.setHeader('Content-Type', 'text/markdown'); return res.status(200).send(fs.readFileSync(p, 'utf-8')); }
      catch (e) { return res.status(500).json({ error: String(e) }); }
    }
    res.json({ id: storyId, name: story.name, path: p, exists, events: normalizedEvents });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});
