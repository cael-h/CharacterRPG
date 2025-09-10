import { Router } from 'express';
import { db } from '../db.js';
import { ensureUniqueStoryName, appendSessionToStory } from '../services/story.js';
import { randomUUID as uuid } from 'crypto';

export const router = Router();

router.post('/', (req, res) => {
  const id = uuid();
  const { title, provider, participants, story, story_mode } = req.body || {};
  db.prepare('INSERT INTO sessions VALUES (?,?,?,?,?,?)')
    .run(id, title ?? 'Scene', provider ?? 'gemini', JSON.stringify(participants ?? []), Date.now(), null);
  // Auto-extract facts if missing and write story mapping
  try {
    const first = Array.isArray(participants) && participants[0]?.id;
    if (first) {
      const { loadFacts, extractFactsRules, saveFacts } = require('../services/meta.js');
      const facts = loadFacts(first);
      if (!facts) {
        const c = db.prepare('SELECT name FROM characters WHERE id=?').get(first);
        if (c?.name) saveFacts(first, extractFactsRules(first, c.name));
      }
      let s = story;
      if (!s || typeof s !== 'string' || !s.trim()) s = 'story1';
      s = s.trim();
      if (story_mode === 'continue') {
        // Continue: use provided name as-is (create if missing)
        appendSessionToStory(first, s, id);
      } else {
        // New (or default): ensure uniqueness to avoid overwrite
        const uniq = ensureUniqueStoryName(first, s);
        appendSessionToStory(first, uniq, id);
      }
    }
  } catch {}
  res.json({ id });
});

router.post('/:id/end', (req, res) => {
  db.prepare('UPDATE sessions SET ended_at=? WHERE id=?').run(Date.now(), req.params.id);
  res.json({ ok: true });
});
