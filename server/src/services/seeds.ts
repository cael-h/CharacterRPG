import fs from 'fs';
import path from 'path';
import { db } from '../db.js';
import { writeCharacterProfileBundle } from './fileIO.js';
import { randomUUID as uuid } from 'crypto';

function parseFrontMatter(md: string) {
  const out: any = {};
  if (!md.startsWith('---\n')) return out;
  const end = md.indexOf('\n---\n', 4);
  if (end === -1) return out;
  const body = md.slice(4, end);
  for (const line of body.split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const k = line.slice(0, idx).trim();
    const v = line.slice(idx + 1).trim();
    if (k) out[k] = v;
  }
  return out;
}

export function importSeeds() {
  const dir = process.env.SEEDS_DIR || 'seeds';
  const base = path.join(dir, 'characters');
  if (!fs.existsSync(base)) return;
  for (const name of fs.readdirSync(base)) {
    const cdir = path.join(base, name);
    const profile = path.join(cdir, 'profile.md');
    if (!fs.existsSync(profile)) continue;
    const md = fs.readFileSync(profile, 'utf-8');
    const fm = parseFrontMatter(md);
    let system_prompt = md;
    if (md.startsWith('---\n')) {
      const endIdx = md.indexOf('\n---\n', 4);
      if (endIdx !== -1) system_prompt = md.slice(endIdx + 5);
    }
    let row = db.prepare('SELECT * FROM characters WHERE name=?').get(name);
    const now = Date.now();
    if (!row) {
      const id = uuid();
      const baseJson = { name, system_prompt, age: fm.age? Number(fm.age): null, birth_year: fm.birth_year? Number(fm.birth_year): null, voice: fm.voice||null, provider: fm.provider||null };
      db.prepare('INSERT INTO characters (id,name,voice,provider,system_prompt,memory_json,avatar_uri,profile_uri,birth_year,age,base_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(id, name, fm.voice||null, fm.provider||null, system_prompt, '{}', null, null, fm.birth_year? Number(fm.birth_year): null, fm.age? Number(fm.age): null, JSON.stringify(baseJson), now, now);
      writeCharacterProfileBundle(id, { name, system_prompt, age: baseJson.age, birth_year: baseJson.birth_year });
      row = { id, name } as any;
    } else {
      db.prepare('UPDATE characters SET system_prompt=?, updated_at=? WHERE id=?').run(system_prompt, now, row.id);
      db.prepare('UPDATE characters SET base_json=? WHERE id=?').run(JSON.stringify({ name: row.name, system_prompt, age: row.age, birth_year: row.birth_year, voice: row.voice, provider: row.provider }), row.id);
      writeCharacterProfileBundle(row.id, { name: row.name, system_prompt, age: row.age, birth_year: row.birth_year });
    }
    const docs = path.join(cdir, 'docs');
    if (fs.existsSync(docs) && row?.id) {
      const outDir = path.join(process.env.PROFILES_DIR || 'profiles', row.id, 'docs');
      fs.mkdirSync(outDir, { recursive: true });
      for (const f of fs.readdirSync(docs)) {
        const src = path.join(docs, f);
        const dst = path.join(outDir, f);
        try { fs.copyFileSync(src, dst); } catch {}
      }
    }
  }
}

export function importFromDocs() {
  const docsDir = 'docs';
  if (!fs.existsSync(docsDir)) return;
  for (const f of fs.readdirSync(docsDir)) {
    const m = f.match(/^Character_(.+)\.md$/i);
    if (!m) continue;
    const name = m[1];
    const md = fs.readFileSync(path.join(docsDir, f), 'utf-8');
    const now = Date.now();
    let row = db.prepare('SELECT * FROM characters WHERE name=?').get(name);
    if (!row) {
      const id = uuid();
      db.prepare('INSERT INTO characters (id,name,system_prompt,memory_json,created_at,updated_at,base_json) VALUES (?,?,?,?,?,?,?)')
        .run(id, name, md, '{}', now, now, JSON.stringify({ name, system_prompt: md }));
      writeCharacterProfileBundle(id, { name, system_prompt: md });
      const outDocs = path.join(process.env.PROFILES_DIR || 'profiles', id, 'docs');
      fs.mkdirSync(outDocs, { recursive: true });
      fs.writeFileSync(path.join(outDocs, f), md);
    } else {
      db.prepare('UPDATE characters SET system_prompt=?, base_json=?, updated_at=? WHERE id=?')
        .run(md, JSON.stringify({ name: row.name, system_prompt: md, age: row.age, birth_year: row.birth_year, voice: row.voice, provider: row.provider }), now, row.id);
      writeCharacterProfileBundle(row.id, { name: row.name, system_prompt: md, age: row.age, birth_year: row.birth_year });
      const outDocs = path.join(process.env.PROFILES_DIR || 'profiles', row.id, 'docs');
      fs.mkdirSync(outDocs, { recursive: true });
      fs.writeFileSync(path.join(outDocs, f), md);
    }
  }
}

