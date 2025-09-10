import { Router } from 'express';
import { db } from '../db.js';
import { randomUUID as uuid } from 'crypto';
import fs from 'fs';
import path from 'path';
import { writeCharacterProfileBundle } from '../services/fileIO.js';
import multer from 'multer';
import { importFromDocs } from '../services/seeds.js';
import { loadFacts, saveFacts, extractFactsRules, metaPathFor } from '../services/meta.js';

export const router = Router();
const upload = multer({ limits: { fileSize: 5 * 1024 * 1024 } });

router.get('/', (_req, res) => {
  const rows = db.prepare('SELECT * FROM characters').all();
  res.json(rows);
});

router.post('/', (req, res) => {
  const id = uuid();
  const now = Date.now();
  const { name, voice, provider, system_prompt, memory_json, avatar_uri, profile_uri, age, birth_year } = req.body || {};
  const base = JSON.stringify({ name, voice, provider, system_prompt, avatar_uri, profile_uri, age, birth_year });
  db.prepare('INSERT INTO characters (id,name,voice,provider,system_prompt,memory_json,avatar_uri,profile_uri,birth_year,age,base_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(id, name, voice, provider, system_prompt, memory_json ?? '{}', avatar_uri ?? null, profile_uri ?? null, birth_year ?? null, age ?? null, base, now, now);
  res.json({ id });
});

router.patch('/:id', (req, res) => {
  const now = Date.now();
  const { name, voice, provider, system_prompt, memory_json, avatar_uri, profile_uri, age, birth_year } = req.body || {};
  const row = db.prepare('SELECT * FROM characters WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  const next = {
    name: name ?? row.name,
    voice: voice ?? row.voice,
    provider: provider ?? row.provider,
    system_prompt: system_prompt ?? row.system_prompt,
    memory_json: memory_json ?? row.memory_json,
    avatar_uri: avatar_uri ?? row.avatar_uri,
    profile_uri: profile_uri ?? row.profile_uri,
    age: age ?? row.age,
    birth_year: birth_year ?? row.birth_year,
  };
  db.prepare('UPDATE characters SET name=?, voice=?, provider=?, system_prompt=?, memory_json=?, avatar_uri=?, profile_uri=?, age=?, birth_year=?, updated_at=? WHERE id=?')
    .run(next.name, next.voice, next.provider, next.system_prompt, next.memory_json, next.avatar_uri, next.profile_uri, next.age, next.birth_year, now, req.params.id);
  res.json({ ok: true });
});

// Save Profile: capture current fields into base_json and write a Markdown profile bundle under profiles/<id>/
router.post('/:id/save-profile', (req, res) => {
  const row = db.prepare('SELECT * FROM characters WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  const base = {
    name: row.name,
    voice: row.voice,
    provider: row.provider,
    system_prompt: row.system_prompt,
    avatar_uri: row.avatar_uri,
    profile_uri: row.profile_uri,
    age: row.age,
    birth_year: row.birth_year,
  };
  db.prepare('UPDATE characters SET base_json=?, updated_at=? WHERE id=?')
    .run(JSON.stringify(base), Date.now(), req.params.id);
  const { profilePath } = writeCharacterProfileBundle(req.params.id, {
    name: row.name,
    system_prompt: row.system_prompt,
    avatar_uri: row.avatar_uri,
    profile_uri: row.profile_uri,
    age: row.age,
    birth_year: row.birth_year,
  });
  try {
    const base = process.env.PROFILES_DIR || 'profiles';
    const path = require('path');
    const fs = require('fs');
    const dir = path.join(base, req.params.id, 'prompt');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'system.md'), row.system_prompt || '');
  } catch {}
  res.json({ ok: true, profile_path: profilePath });
});


// Import base profile from Markdown (multipart 'file')
router.post('/:id/import-base', upload.single('file'), (req, res) => {
  const row = db.prepare('SELECT * FROM characters WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  if (!req.file) return res.status(400).json({ error: 'no_file' });
  const md = req.file.buffer.toString('utf-8');
  const now = Date.now();
  db.prepare('UPDATE characters SET system_prompt=?, base_json=?, updated_at=? WHERE id=?')
    .run(md, JSON.stringify({ name: row.name, system_prompt: md, age: row.age, birth_year: row.birth_year, voice: row.voice, provider: row.provider }), now, row.id);
  const { profilePath } = writeCharacterProfileBundle(row.id, { name: row.name, system_prompt: md, age: row.age, birth_year: row.birth_year });
  try {
    const base = process.env.PROFILES_DIR || 'profiles';
    const path = require('path');
    const fs = require('fs');
    const dir = path.join(base, row.id, 'prompt');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'system.md'), md);
  } catch {}
  res.json({ ok: true, profile_path: profilePath });
});

// Reset Character: restore fields from base_json and clear per-character memories/timeline files and rows
router.post('/:id/reset', (req, res) => {
  const row = db.prepare('SELECT * FROM characters WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  let base: any;
  try { base = row.base_json ? JSON.parse(row.base_json) : null; } catch {}
  if (!base) {
    base = { name: row.name, voice: row.voice, provider: row.provider, system_prompt: row.system_prompt, avatar_uri: row.avatar_uri, profile_uri: row.profile_uri, age: row.age, birth_year: row.birth_year };
    db.prepare('UPDATE characters SET base_json=? WHERE id=?').run(JSON.stringify(base), req.params.id);
  }
  const now = Date.now();
  db.prepare('UPDATE characters SET name=?, voice=?, provider=?, system_prompt=?, avatar_uri=?, profile_uri=?, age=?, birth_year=?, updated_at=? WHERE id=?')
    .run(base.name, base.voice, base.provider, base.system_prompt, base.avatar_uri ?? null, base.profile_uri ?? null, base.age ?? null, base.birth_year ?? null, now, req.params.id);

  // Clear per-character memories (rows + file)
  db.prepare('DELETE FROM memories WHERE character_id=?').run(row.name);
  const memDir = process.env.MEMORIES_DIR || 'memories';
  const memPath = path.join(memDir, `${row.name}.md`);
  try { if (fs.existsSync(memPath)) fs.unlinkSync(memPath); } catch {}

  // Clear per-character timeline (db + file)
  const trow = db.prepare('SELECT id FROM timelines WHERE scope=? AND owner_id IS ?').get('character', row.name);
  if (trow?.id) {
    db.prepare('DELETE FROM timeline_events WHERE timeline_id=?').run(trow.id);
    db.prepare('DELETE FROM timelines WHERE id=?').run(trow.id);
  }
  const tdir = process.env.TIMELINES_DIR || 'timelines';
  const tpath = path.join(tdir, `${row.name}.md`);
  try { if (fs.existsSync(tpath)) fs.unlinkSync(tpath); } catch {}

  res.json({ ok: true });
});

// Delete Character: remove row, memories/timeline files & rows, attempt avatar cleanup
router.delete('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM characters WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });

  // DB cleanup
  db.prepare('DELETE FROM memories WHERE character_id=?').run(row.name);
  const trow = db.prepare('SELECT id FROM timelines WHERE scope=? AND owner_id IS ?').get('character', row.name);
  if (trow?.id) {
    db.prepare('DELETE FROM timeline_events WHERE timeline_id=?').run(trow.id);
    db.prepare('DELETE FROM timelines WHERE id=?').run(trow.id);
  }
  db.prepare('DELETE FROM characters WHERE id=?').run(req.params.id);

  // Files: memories and timeline
  const memDir = process.env.MEMORIES_DIR || 'memories';
  const memPath = path.join(memDir, `${row.name}.md`);
  try { if (fs.existsSync(memPath)) fs.unlinkSync(memPath); } catch {}
  const tdir = process.env.TIMELINES_DIR || 'timelines';
  const tpath = path.join(tdir, `${row.name}.md`);
  try { if (fs.existsSync(tpath)) fs.unlinkSync(tpath); } catch {}

  // Attempt to remove avatar file if stored under uploads
  try {
    const uri = row.avatar_uri as string | null;
    if (uri && uri.startsWith('/uploads/')) {
      const rel = uri.replace('/uploads/', '');
      const base = process.env.UPLOADS_DIR || 'uploads';
      const f = path.join(base, rel);
      if (fs.existsSync(f)) fs.unlinkSync(f);
    }
  } catch {}

  res.json({ ok: true });
});

// Import any Character_*.md found in /docs immediately
router.post('/import-from-docs', (_req, res) => {
  try { importFromDocs(); res.json({ ok: true }); } catch (e) { res.status(500).json({ error: String(e) }); }
});

// Facts (meta) endpoints
router.get('/:id/meta', (req, res) => {
  const row = db.prepare('SELECT * FROM characters WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  const facts = loadFacts(req.params.id) || { name: row.name };
  res.json(facts);
});

router.post('/:id/meta', (req, res) => {
  const row = db.prepare('SELECT * FROM characters WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  try { saveFacts(req.params.id, req.body || { name: row.name }); res.json({ ok: true }); }
  catch (e) { res.status(400).json({ error: String(e) }); }
});

router.post('/:id/extract-meta', async (req, res) => {
  const row = db.prepare('SELECT * FROM characters WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  const mode = (req.body && req.body.mode) || 'auto';
  try {
    let facts;
    if (mode === 'llm') {
      const { extractFactsLLM } = await import('../services/meta.js');
      facts = await extractFactsLLM(req.params.id, row.name, { model: req.body?.reviewer_model, apiKey: (req as any).providerKey });
    } else if (mode === 'rules' || mode === 'auto') {
      facts = extractFactsRules(req.params.id, row.name);
    }
    if (!facts) facts = { name: row.name, provenance: { generated_at: new Date().toISOString(), reason: 'empty' } } as any;
    saveFacts(req.params.id, facts);
    res.json({ ok: true, facts });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// Manual sync: rebuild the profiles/<id> bundle from DB and runtime files

router.post('/:id/sync-files', (req, res) => {
  const row = db.prepare('SELECT * FROM characters WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  const fs = require('fs');
  const path = require('path');
  const base = process.env.PROFILES_DIR || 'profiles';
  const root = path.join(base, req.params.id);
  try { fs.mkdirSync(root, { recursive: true }); } catch {}
  try {
    const pdir = path.join(root, 'prompt');
    fs.mkdirSync(pdir, { recursive: true });
    fs.writeFileSync(path.join(pdir, 'system.md'), row.system_prompt || '');
  } catch {}
  try {
    const tdir = process.env.TIMELINES_DIR || 'timelines';
    const tsrc = path.join(tdir, row.name + '.md');
    if (fs.existsSync(tsrc)) {
      const tdest = path.join(root, 'timeline');
      fs.mkdirSync(tdest, { recursive: true });
      fs.copyFileSync(tsrc, path.join(tdest, 'timeline.md'));
    }
  } catch {}
  try {
    const mdir = process.env.MEMORIES_DIR || 'memories';
    const msrc = path.join(mdir, row.name + '.md');
    if (fs.existsSync(msrc)) {
      const mdest = path.join(root, 'memories');
      fs.mkdirSync(mdest, { recursive: true });
      fs.copyFileSync(msrc, path.join(mdest, 'memories.md'));
    }
  } catch {}
  try {
    const list = db.prepare('SELECT id, title, started_at, participants_json FROM sessions').all();
    const ids = list
      .filter((s) => String(s && s.participants_json || '').includes(req.params.id))
      .map((s) => '- ' + ((s && s.title) || 'Session') + ' (' + s.id + ')');
    const tdir = path.join(root, 'transcripts');
    fs.mkdirSync(tdir, { recursive: true });
    const lines = ['# Transcripts', '', ...ids];
    fs.writeFileSync(path.join(tdir, 'index.md'), lines.join('\n'));
  } catch {}
  res.json({ ok: true });
});
