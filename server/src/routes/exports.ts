import { Router } from 'express';
import type { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { db } from '../db.js';
import type { SceneStateFullRow, CharacterRow } from '../types.js';

export const router = Router();

router.get('/transcripts/:sessionId', (req: Request<{ sessionId: string }>, res: Response) => {
  const dir = process.env.TRANSCRIPTS_DIR || 'transcripts';
  const p = path.join(dir, `${req.params.sessionId}.md`);
  if (!fs.existsSync(p)) return res.status(404).send('not found');
  res.type('text/markdown').send(fs.readFileSync(p, 'utf-8'));
});

router.get('/memories/:characterId', (req: Request<{ characterId: string }>, res: Response) => {
  const dir = process.env.MEMORIES_DIR || 'memories';
  const p = path.join(dir, `${req.params.characterId}.md`);
  if (!fs.existsSync(p)) return res.status(404).send('not found');
  res.type('text/markdown').send(fs.readFileSync(p, 'utf-8'));
});

router.get('/timelines/:ownerId', (req: Request<{ ownerId: string }>, res: Response) => {
  const dir = process.env.TIMELINES_DIR || 'timelines';
  const file = req.params.ownerId === 'global' ? 'global.md' : `${req.params.ownerId}.md`;
  const p = path.join(dir, file);
  if (!fs.existsSync(p)) return res.status(404).send('not found');
  res.type('text/markdown').send(fs.readFileSync(p, 'utf-8'));
});

router.get('/setting/:sessionId', (req: Request<{ sessionId: string }>, res: Response) => {
  const row = db
    .prepare('SELECT * FROM scene_state WHERE session_id=? ORDER BY updated_at DESC LIMIT 1')
    .get(req.params.sessionId) as SceneStateFullRow | undefined;
  if (!row) return res.status(404).json({ error: 'not_found' });
  try {
    res.json({ sessionId: req.params.sessionId, current: row.current_json ? JSON.parse(row.current_json) : null, updated_at: row.updated_at });
  } catch {
    res.json({ sessionId: req.params.sessionId, current: row.current_json, updated_at: row.updated_at });
  }
});

// Export character profile bundle main markdown
router.get('/profile/:characterId', (req: Request<{ characterId: string }>, res: Response) => {
  const id = req.params.characterId;
  const dir = process.env.PROFILES_DIR || 'profiles';
  const p = path.join(dir, id, 'profile.md');
  if (fs.existsSync(p)) {
    res.type('text/markdown').send(fs.readFileSync(p, 'utf-8'));
    return;
  }
  // Synthesize from DB if file not present
  const row = db.prepare('SELECT * FROM characters WHERE id=?').get(id) as CharacterRow | undefined;
  if (!row) return res.status(404).json({ error: 'not_found' });
  const lines: string[] = [];
  lines.push(`# ${row.name} — Base Profile`);
  if (row.age != null) lines.push(`- Age: ${row.age}`);
  if (row.birth_year != null) lines.push(`- Birth Year: ${row.birth_year}`);
  if (row.avatar_uri) lines.push(`- Avatar: ${row.avatar_uri}`);
  if (row.profile_uri) lines.push(`- Source: ${row.profile_uri}`);
  lines.push('');
  lines.push('## System Prompt');
  lines.push('');
  lines.push(row.system_prompt || '');
  res.type('text/markdown').send(lines.join('\n'));
});
