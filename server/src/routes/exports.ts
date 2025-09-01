import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { db } from '../db.js';

export const router = Router();

router.get('/transcripts/:sessionId', (req, res) => {
  const dir = process.env.TRANSCRIPTS_DIR || 'transcripts';
  const p = path.join(dir, `${req.params.sessionId}.md`);
  if (!fs.existsSync(p)) return res.status(404).send('not found');
  res.type('text/markdown').send(fs.readFileSync(p, 'utf-8'));
});

router.get('/memories/:characterId', (req, res) => {
  const dir = process.env.MEMORIES_DIR || 'memories';
  const p = path.join(dir, `${req.params.characterId}.md`);
  if (!fs.existsSync(p)) return res.status(404).send('not found');
  res.type('text/markdown').send(fs.readFileSync(p, 'utf-8'));
});

router.get('/timelines/:ownerId', (req, res) => {
  const dir = process.env.TIMELINES_DIR || 'timelines';
  const file = req.params.ownerId === 'global' ? 'global.md' : `${req.params.ownerId}.md`;
  const p = path.join(dir, file);
  if (!fs.existsSync(p)) return res.status(404).send('not found');
  res.type('text/markdown').send(fs.readFileSync(p, 'utf-8'));
});

router.get('/setting/:sessionId', (req, res) => {
  const row = db.prepare('SELECT * FROM scene_state WHERE session_id=? ORDER BY updated_at DESC LIMIT 1').get(req.params.sessionId);
  if (!row) return res.status(404).json({ error: 'not_found' });
  try {
    res.json({ sessionId: req.params.sessionId, current: JSON.parse(row.current_json), updated_at: row.updated_at });
  } catch {
    res.json({ sessionId: req.params.sessionId, current: row.current_json, updated_at: row.updated_at });
  }
});
