import { Router } from 'express';
import { db } from '../db.js';
import { randomUUID as uuid } from 'crypto';

export const router = Router();

router.post('/', (req, res) => {
  const id = uuid();
  const { title, provider, participants } = req.body || {};
  db.prepare('INSERT INTO sessions VALUES (?,?,?,?,?,?)')
    .run(id, title ?? 'Scene', provider ?? 'gemini', JSON.stringify(participants ?? []), Date.now(), null);
  res.json({ id });
});

router.post('/:id/end', (req, res) => {
  db.prepare('UPDATE sessions SET ended_at=? WHERE id=?').run(Date.now(), req.params.id);
  res.json({ ok: true });
});

