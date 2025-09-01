import { Router } from 'express';
import { db } from '../db.js';
import { randomUUID as uuid } from 'crypto';

export const router = Router();

router.get('/', (_req, res) => {
  const rows = db.prepare('SELECT * FROM characters').all();
  res.json(rows);
});

router.post('/', (req, res) => {
  const id = uuid();
  const now = Date.now();
  const { name, voice, provider, system_prompt, memory_json, avatar_uri, age, birth_year } = req.body || {};
  db.prepare('INSERT INTO characters VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run(id, name, voice, provider, system_prompt, memory_json ?? '{}', avatar_uri ?? null, birth_year ?? null, age ?? null, now, now);
  res.json({ id });
});

router.patch('/:id', (req, res) => {
  const now = Date.now();
  const { name, voice, provider, system_prompt, memory_json, avatar_uri, age, birth_year } = req.body || {};
  const row = db.prepare('SELECT * FROM characters WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  const next = {
    name: name ?? row.name,
    voice: voice ?? row.voice,
    provider: provider ?? row.provider,
    system_prompt: system_prompt ?? row.system_prompt,
    memory_json: memory_json ?? row.memory_json,
    avatar_uri: avatar_uri ?? row.avatar_uri,
    age: age ?? row.age,
    birth_year: birth_year ?? row.birth_year,
  };
  db.prepare('UPDATE characters SET name=?, voice=?, provider=?, system_prompt=?, memory_json=?, avatar_uri=?, age=?, birth_year=?, updated_at=? WHERE id=?')
    .run(next.name, next.voice, next.provider, next.system_prompt, next.memory_json, next.avatar_uri, next.age, next.birth_year, now, req.params.id);
  res.json({ ok: true });
});
