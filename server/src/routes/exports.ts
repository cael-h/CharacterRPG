import { Router } from 'express';
import fs from 'fs';
import path from 'path';

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

