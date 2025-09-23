import { Router } from 'express';
import type { Request, Response } from 'express';
import { db } from '../db.js';
import { randomUUID as uuid } from 'crypto';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { exportToDropin } from '../services/export.js';
import { importFromDocs, importFromProfiles } from '../services/seeds.js';
import { writeCharacterProfileBundle } from '../services/fileIO.js';
import { config } from '../config.js';
import { loadFacts, saveFacts, extractFactsRules, metaPathFor } from '../services/meta.js';
import { writeFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { profileDirFor } from '../services/paths.js';
import { scanDropin } from '../services/importDebug.js';
import type { BodyRequest, CharacterRow, CharacterUpsertBody, CharacterPatchBody, SimpleIdRow, SessionListRow, TypedRequest } from '../types.js';

export const router = Router();
const upload = multer({ limits: { fileSize: 5 * 1024 * 1024 } });

router.get('/', (_req: Request, res: Response) => {
  const rows = db.prepare('SELECT * FROM characters').all() as CharacterRow[];
  res.json(rows);
});

router.post('/', (req: BodyRequest<CharacterUpsertBody>, res: Response) => {
  const id = uuid();
  const now = Date.now();
  const body = (req.body ?? {}) as CharacterUpsertBody;
  const { name, voice, provider, system_prompt, memory_json, avatar_uri, profile_uri, age, birth_year } = body;
  if (!name) return res.status(400).json({ error: 'missing_name' });
  const base = JSON.stringify({ name, voice, provider, system_prompt, avatar_uri, profile_uri, age, birth_year });
  db.prepare('INSERT INTO characters (id,name,voice,provider,system_prompt,memory_json,avatar_uri,profile_uri,birth_year,age,base_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(id, name, voice ?? null, provider ?? null, system_prompt ?? '', memory_json ?? '{}', avatar_uri ?? null, profile_uri ?? null, birth_year ?? null, age ?? null, base, now, now);
  try {
    // Create initial profile bundle and seed prompt files (system/generic/short)
    writeCharacterProfileBundle(id, {
      name,
      system_prompt: system_prompt || '',
      avatar_uri: avatar_uri ?? null,
      profile_uri: profile_uri ?? null,
      age: age ?? null,
      birth_year: birth_year ?? null,
    });
    // Optional: export to character_profiles when enabled
    try {
      if (config.flags.autoExportProfilesBack && String(name||'') !== 'Default') exportToDropin(id);
    } catch {}
  } catch {}
  res.json({ id });
});

router.patch('/:id', (req: TypedRequest<{ id: string }, CharacterPatchBody>, res: Response) => {
  const now = Date.now();
  const body = (req.body ?? {}) as CharacterPatchBody;
  const { name, voice, provider, system_prompt, memory_json, avatar_uri, profile_uri, age, birth_year } = body;
  const row = db.prepare('SELECT * FROM characters WHERE id=?').get(req.params.id) as CharacterRow | undefined;
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
router.post('/:id/save-profile', (req: Request<{ id: string }>, res: Response) => {
  const row = db.prepare('SELECT * FROM characters WHERE id=?').get(req.params.id) as CharacterRow | undefined;
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
    const dir = path.join(profileDirFor(req.params.id), 'prompt');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'system.md'), row.system_prompt || '');
  } catch {}
  try { if (config.flags.autoExportProfilesBack && String(row.name||'') !== 'Default') exportToDropin(req.params.id); } catch {}
  res.json({ ok: true, profile_path: profilePath });
});


// Import base profile from Markdown (multipart 'file')
router.post('/:id/import-base', upload.single('file'), (req: Request<{ id: string }>, res: Response) => {
  const row = db.prepare('SELECT * FROM characters WHERE id=?').get(req.params.id) as CharacterRow | undefined;
  if (!row) return res.status(404).json({ error: 'not_found' });
  if (!req.file) return res.status(400).json({ error: 'no_file' });
  const md = req.file.buffer.toString('utf-8');
  const now = Date.now();
  db.prepare('UPDATE characters SET system_prompt=?, base_json=?, updated_at=? WHERE id=?')
    .run(md, JSON.stringify({ name: row.name, system_prompt: md, age: row.age, birth_year: row.birth_year, voice: row.voice, provider: row.provider }), now, row.id);
  const { profilePath } = writeCharacterProfileBundle(row.id, { name: row.name, system_prompt: md, age: row.age, birth_year: row.birth_year });
  try {
    const dir = path.join(profileDirFor(row.id), 'prompt');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'system.md'), md);
  } catch {}
  try { if (config.flags.autoExportProfilesBack && String(row.name||'') !== 'Default') exportToDropin(row.id); } catch {}
  res.json({ ok: true, profile_path: profilePath });
});

// Reset Character: restore fields from base_json and clear per-character memories/timeline files and rows
router.post('/:id/reset', (req: Request<{ id: string }>, res: Response) => {
  const row = db.prepare('SELECT * FROM characters WHERE id=?').get(req.params.id) as CharacterRow | undefined;
  if (!row) return res.status(404).json({ error: 'not_found' });
  let base: CharacterUpsertBody | null = null;
  try { base = row.base_json ? (JSON.parse(row.base_json) as CharacterUpsertBody) : null; } catch {}
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
  const trow = db.prepare('SELECT id FROM timelines WHERE scope=? AND owner_id IS ?').get('character', row.name) as SimpleIdRow | undefined;
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
router.delete('/:id', (req: Request<{ id: string }>, res: Response) => {
  const row = db.prepare('SELECT * FROM characters WHERE id=?').get(req.params.id) as CharacterRow | undefined;
  if (!row) return res.status(404).json({ error: 'not_found' });

  // DB cleanup
  db.prepare('DELETE FROM memories WHERE character_id=?').run(row.name);
  const trow = db.prepare('SELECT id FROM timelines WHERE scope=? AND owner_id IS ?').get('character', row.name) as SimpleIdRow | undefined;
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

// Clone Character: duplicate a character and its profile bundle under a new name
router.post('/:id/clone', (req: Request<{ id: string }>, res: Response) => {
  const src = db.prepare('SELECT * FROM characters WHERE id=?').get(req.params.id) as CharacterRow | undefined;
  if (!src) return res.status(404).json({ error: 'not_found' });
  const body = (req.body ?? {}) as { name?: string };
  const name = body.name && body.name.trim().length ? body.name : `${src.name} Copy`;
  const id = uuid();
  const now = Date.now();
  db.prepare('INSERT INTO characters (id,name,voice,provider,system_prompt,memory_json,avatar_uri,profile_uri,birth_year,age,base_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(id, name, src.voice, src.provider, src.system_prompt, '{}', src.avatar_uri, src.profile_uri, src.birth_year, src.age, src.base_json, now, now);
  // Copy profile bundle directory if present
  try {
    const from = profileDirFor(src.id, src.name);
    const to = profileDirFor(id, name);
    try { fs.rmSync(to, { recursive: true, force: true }); } catch {}
    try {
      if ((fs as any).cpSync) (fs as any).cpSync(from, to, { recursive: true });
      else {
        // Fallback: mkdir + copy files shallow
        const copyDir = (a:string,b:string)=>{
          fs.mkdirSync(b,{recursive:true});
          for (const entry of fs.readdirSync(a,{withFileTypes:true})){
            const ap=path.join(a,entry.name); const bp=path.join(b,entry.name);
            if (entry.isDirectory()) copyDir(ap,bp); else fs.copyFileSync(ap,bp);
          }
        };
        copyDir(from,to);
      }
      // Update top-level profile.md title if exists
      const prof = path.join(to,'profile.md');
      try { if (fs.existsSync(prof)) {
        const txt = fs.readFileSync(prof,'utf-8');
        const out = txt.replace(/^#\s+.*?—\s+Base Profile.*$/m, `# ${name} — Base Profile`);
        fs.writeFileSync(prof,out);
      }} catch {}
    } catch {}
  } catch {}
  res.json({ id, name });
});

// Import any Character_*.md found in /docs immediately
router.post('/import-from-docs', (_req: Request, res: Response) => {
  try { importFromDocs(); res.json({ ok: true }); } catch (e) { res.status(500).json({ error: String(e) }); }
});

// New: Import from drop-in profiles/<Name>/ bundles
router.post('/import-from-profiles', (_req: Request, res: Response) => {
  try { importFromProfiles(); res.json({ ok: true }); } catch (e) { res.status(500).json({ error: String(e) }); }
});

// Bulk refresh: overwrite all characters' prompt/generic.md from docs/General_Default_Char_Prompt_v3.md
router.post('/refresh-generic', (_req: Request, res: Response) => {
  try {
    // Prefer profiles/Default/generic.md; fall back to docs/General_Default_Char_Prompt_v3.md
    const defaultGeneric = path.join(config.dirs.profilesDropin, 'Default', 'generic.md');
    const docsGeneric = path.join('docs', 'General_Default_Char_Prompt_v3.md');
    let source: string | undefined;
    try { if (existsSync(defaultGeneric)) source = defaultGeneric; } catch {}
    if (!source) { try { if (existsSync(docsGeneric)) source = docsGeneric; } catch {} }
    if (!source) return res.status(400).json({ error: 'missing_generic', tried: [defaultGeneric, docsGeneric] });
    const content = readFileSync(source, 'utf-8');
    const rows = db.prepare('SELECT id FROM characters').all() as SimpleIdRow[];
    let count = 0;
    for (const r of rows) {
      const dir = path.join(profileDirFor(r.id), 'prompt');
      try { mkdirSync(dir, { recursive: true }); } catch {}
      writeFileSync(path.join(dir, 'generic.md'), content);
      count++;
    }
    res.json({ ok: true, updated: count, source });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// Facts (meta) endpoints
router.get('/:id/meta', (req: Request<{ id: string }>, res: Response) => {
  const row = db.prepare('SELECT * FROM characters WHERE id=?').get(req.params.id) as CharacterRow | undefined;
  if (!row) return res.status(404).json({ error: 'not_found' });
  const facts = loadFacts(req.params.id) || { name: row.name };
  res.json(facts);
});

router.post('/:id/meta', (req: Request<{ id: string }>, res: Response) => {
  const row = db.prepare('SELECT * FROM characters WHERE id=?').get(req.params.id) as CharacterRow | undefined;
  if (!row) return res.status(404).json({ error: 'not_found' });
  try { saveFacts(req.params.id, req.body || { name: row.name }); res.json({ ok: true }); }
  catch (e) { res.status(400).json({ error: String(e) }); }
});

router.post('/:id/extract-meta', async (req: Request<{ id: string }>, res: Response) => {
  const row = db.prepare('SELECT * FROM characters WHERE id=?').get(req.params.id) as CharacterRow | undefined;
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

router.post('/:id/sync-files', (req: Request<{ id: string }>, res: Response) => {
  const row = db.prepare('SELECT * FROM characters WHERE id=?').get(req.params.id) as CharacterRow | undefined;
  if (!row) return res.status(404).json({ error: 'not_found' });
  const root = profileDirFor(req.params.id);
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
    const list = db.prepare('SELECT id, title, started_at, participants_json FROM sessions').all() as SessionListRow[];
    const ids = list
      .filter((s) => String((s && s.participants_json) || '').includes(req.params.id))
      .map((s) => '- ' + ((s && s.title) || 'Session') + ' (' + s.id + ')');
    const tdir = path.join(root, 'transcripts');
    fs.mkdirSync(tdir, { recursive: true });
    const lines = ['# Transcripts', '', ...ids];
    fs.writeFileSync(path.join(tdir, 'index.md'), lines.join('\n'));
  } catch {}
  res.json({ ok: true });
});

// Export runtime bundle back to drop-in directory (avoids overwrite by suffixing directory name)
router.post('/:id/export-to-dropin', (req: Request<{ id: string }>, res: Response) => {
  try {
    const out = exportToDropin(req.params.id);
    res.json({ ok: true, target: out });
  } catch (e) {
    res.status(400).json({ error: String(e) });
  }
});

// Debug: show resolved drop-in path and discoverable entries
router.get('/import-debug', (_req: Request, res: Response) => {
  try {
    res.json(scanDropin());
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// Manual trigger: import from profilesDropin now
router.post('/import-now', (_req: Request, res: Response) => {
  try {
    const scan = scanDropin();
    importFromProfiles();
    const rows = db.prepare('SELECT id,name FROM characters').all();
    res.json({ ok: true, ...scan, count: rows.length, names: rows.map((r: any) => r.name) });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});
