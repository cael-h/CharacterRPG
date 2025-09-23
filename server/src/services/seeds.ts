import fs from 'fs';
import path from 'path';
import { db } from '../db.js';
import { writeCharacterProfileBundle } from './fileIO.js';
import { profileDirFor } from './paths.js';
import { randomUUID as uuid } from 'crypto';
import { config } from '../config.js';
import type { CharacterRow, CharacterNameRow, IdRow } from '../types.js';

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
    let row = db.prepare('SELECT * FROM characters WHERE name=?').get(name) as CharacterRow | undefined;
    const now = Date.now();
    if (!row) {
      const id = uuid();
      const baseJson = { name, system_prompt, age: fm.age? Number(fm.age): null, birth_year: fm.birth_year? Number(fm.birth_year): null, voice: fm.voice||null, provider: fm.provider||null };
      db.prepare('INSERT INTO characters (id,name,voice,provider,system_prompt,memory_json,avatar_uri,profile_uri,birth_year,age,base_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(id, name, fm.voice||null, fm.provider||null, system_prompt, '{}', null, null, fm.birth_year? Number(fm.birth_year): null, fm.age? Number(fm.age): null, JSON.stringify(baseJson), now, now);
      // Write profile bundle and seed per-character prompt files (generic/short/system)
      writeCharacterProfileBundle(id, { name, system_prompt, age: baseJson.age, birth_year: baseJson.birth_year });
      row = { id, name } as any;
    } else {
      db.prepare('UPDATE characters SET system_prompt=?, updated_at=? WHERE id=?').run(system_prompt, now, row.id);
      db.prepare('UPDATE characters SET base_json=? WHERE id=?').run(JSON.stringify({ name: row.name, system_prompt, age: row.age, birth_year: row.birth_year, voice: row.voice, provider: row.provider }), row.id);
      writeCharacterProfileBundle(row.id, { name: row.name, system_prompt, age: row.age, birth_year: row.birth_year });
    }
    const docs = path.join(cdir, 'docs');
    if (fs.existsSync(docs) && row?.id) {
      const outDir = path.join(config.dirs.profiles, row.id, 'docs');
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
    let row = db.prepare('SELECT * FROM characters WHERE name=?').get(name) as CharacterRow | undefined;
    if (!row) {
      const id = uuid();
      db.prepare('INSERT INTO characters (id,name,system_prompt,memory_json,created_at,updated_at,base_json) VALUES (?,?,?,?,?,?,?)')
        .run(id, name, md, '{}', now, now, JSON.stringify({ name, system_prompt: md }));
      writeCharacterProfileBundle(id, { name, system_prompt: md });
      const outDocs = path.join(config.dirs.profiles, id, 'docs');
      fs.mkdirSync(outDocs, { recursive: true });
      fs.writeFileSync(path.join(outDocs, f), md);
    } else {
      db.prepare('UPDATE characters SET system_prompt=?, base_json=?, updated_at=? WHERE id=?')
        .run(md, JSON.stringify({ name: row.name, system_prompt: md, age: row.age, birth_year: row.birth_year, voice: row.voice, provider: row.provider }), now, row.id);
      writeCharacterProfileBundle(row.id, { name: row.name, system_prompt: md, age: row.age, birth_year: row.birth_year });
      const outDocs = path.join(config.dirs.profiles, row.id, 'docs');
      fs.mkdirSync(outDocs, { recursive: true });
      fs.writeFileSync(path.join(outDocs, f), md);
    }
  }
}

// New: Import characters from a drop-in profiles structure.
// Allows users to place bundles under profiles/<Name>/ with optional subfolders:
// - long_char_profile/profile.md (or any .md within)
// - short_char_prompt/short.md (or any .md within)
// - generic_prompt/generic.md (or any .md within)
// - additional_context/* (copied into profiles/<id>/docs)
// - images/avatar.(png|jpg|jpeg|webp) → copied to uploads/avatars + set avatar_uri
// - memories/memories.md and timeline/timeline.md (optional; mirrored into bundle only)
export function importFromProfiles() {
  const base = config.dirs.profilesDropin;
  if (!fs.existsSync(base)) return;

  const isUuidish = (s: string) => /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(s);
  const looksManaged = (dirName: string) => /__/.test(dirName) && isUuidish(dirName.split('__').pop() || '');

  const readFirst = (paths: string[]): string | null => {
    for (const p of paths) {
      try {
        if (p && fs.existsSync(p) && fs.statSync(p).isFile()) return fs.readFileSync(p, 'utf-8');
      } catch {}
    }
    return null;
  };

  const firstFileIn = (dir: string, exts: string[]): string | null => {
    try {
      if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return null;
      const entries = fs.readdirSync(dir);
      for (const f of entries) {
        const p = path.join(dir, f);
        if (fs.statSync(p).isFile()) {
          const ext = path.extname(f).toLowerCase().replace('.', '');
          if (exts.length === 0 || exts.includes(ext)) return p;
        }
      }
    } catch {}
    return null;
  };

  const copyTree = (srcDir: string, dstDir: string) => {
    try { fs.mkdirSync(dstDir, { recursive: true }); } catch {}
    if (!fs.existsSync(srcDir)) return;
    for (const f of fs.readdirSync(srcDir)) {
      const s = path.join(srcDir, f);
      const d = path.join(dstDir, f);
      try {
        if (fs.statSync(s).isDirectory()) {
          copyTree(s, d);
        } else {
          fs.copyFileSync(s, d);
        }
      } catch {}
    }
  };

  const uploadsDir = config.dirs.uploads;
  const avatarsDir = path.join(uploadsDir, 'avatars');
  try { if (!fs.existsSync(avatarsDir)) fs.mkdirSync(avatarsDir, { recursive: true }); } catch {}

  for (const entry of fs.readdirSync(base)) {
    const dropDir = path.join(base, entry);
    try {
      if (!fs.statSync(dropDir).isDirectory()) continue;
    } catch { continue; }

    // Skip already-managed bundle directories like name__<uuid>
    if (looksManaged(entry)) continue;

    // Discover name and long profile content
    const longMdPathCandidates = [
      path.join(dropDir, 'profile.md'),
      firstFileIn(path.join(dropDir, 'long_char_profile'), ['md']),
    ].filter(Boolean) as string[];
    const longMd = readFirst(longMdPathCandidates) || '';

    // Try to infer name from # heading if present
    let name = entry.replace(/[_-]+/g, ' ').trim() || 'Character';
    const m = longMd.match(/^#\s+(.+?)\s*(?:—|-)\s*.*$/m);
    if (m && m[1]) name = m[1].trim();

    // Upsert character by name
    let row = db.prepare('SELECT * FROM characters WHERE name=?').get(name) as CharacterRow | undefined;
    const now = Date.now();
    if (!row) {
      const id = uuid();
      db.prepare('INSERT INTO characters (id,name,system_prompt,memory_json,created_at,updated_at,base_json) VALUES (?,?,?,?,?,?,?)')
        .run(id, name, longMd, '{}', now, now, JSON.stringify({ name, system_prompt: longMd }));
      writeCharacterProfileBundle(id, { name, system_prompt: longMd });
      row = db.prepare('SELECT * FROM characters WHERE id=?').get(id) as CharacterRow;
    } else {
      db.prepare('UPDATE characters SET system_prompt=?, base_json=?, updated_at=? WHERE id=?')
        .run(longMd || row.system_prompt || '', JSON.stringify({ name: row.name, system_prompt: longMd || row.system_prompt || '', age: row.age, birth_year: row.birth_year, voice: row.voice, provider: row.provider }), now, row.id);
      writeCharacterProfileBundle(row.id, { name: row.name, system_prompt: longMd || row.system_prompt || '' });
    }

    if (!row) continue;
    // Canonical bundle directory
    const bundleDir = profileDirFor(row.id, name);

    // Prompts: short & generic from drop-in aliases
    const shortSrc = readFirst([
      path.join(dropDir, 'prompt', 'short.md'),
      firstFileIn(path.join(dropDir, 'short_char_prompt'), ['md']) || '',
    ].filter(Boolean) as string[]);
    if (shortSrc != null) {
      const pdir = path.join(bundleDir, 'prompt');
      try { fs.mkdirSync(pdir, { recursive: true }); } catch {}
      fs.writeFileSync(path.join(pdir, 'short.md'), shortSrc);
    }

    const genericSrc = readFirst([
      path.join(dropDir, 'prompt', 'generic.md'),
      firstFileIn(path.join(dropDir, 'base_prompt'), ['md']) || '',
      firstFileIn(path.join(dropDir, 'generic_prompt'), ['md']) || '',
    ].filter(Boolean) as string[]);
    if (genericSrc != null) {
      const pdir = path.join(bundleDir, 'prompt');
      try { fs.mkdirSync(pdir, { recursive: true }); } catch {}
      fs.writeFileSync(path.join(pdir, 'generic.md'), genericSrc);
    }

    // Additional context docs
    const addlDir = path.join(dropDir, 'additional_context');
    if (fs.existsSync(addlDir) && fs.statSync(addlDir).isDirectory()) {
      const outDir = path.join(bundleDir, 'docs');
      copyTree(addlDir, outDir);
    }

    // Images → set avatar if available
    const imgDir = path.join(dropDir, 'images');
    const avatarPath = firstFileIn(imgDir, ['png', 'jpg', 'jpeg', 'webp']);
    if (avatarPath) {
      const ext = path.extname(avatarPath).toLowerCase().replace('.', '') || 'jpg';
      const hash = Buffer.from(path.basename(avatarPath) + Date.now()).toString('base64url').slice(0, 16);
      const filename = `${hash}.${ext}`;
      try { fs.copyFileSync(avatarPath, path.join(avatarsDir, filename));
        db.prepare('UPDATE characters SET avatar_uri=?, updated_at=? WHERE id=?').run(`/uploads/avatars/${filename}`, Date.now(), row.id);
      } catch {}
    }

    // Optional mirrors: memories/timeline from drop-in
    const memMd = readFirst([path.join(dropDir, 'memories', 'memories.md')]);
    if (memMd != null) {
      try {
        const mdir = path.join(bundleDir, 'memories');
        fs.mkdirSync(mdir, { recursive: true });
        fs.writeFileSync(path.join(mdir, 'memories.md'), memMd);
      } catch {}
    }
    const tlMd = readFirst([path.join(dropDir, 'timeline', 'timeline.md')]);
    if (tlMd != null) {
      try {
        const tdir = path.join(bundleDir, 'timeline');
        fs.mkdirSync(tdir, { recursive: true });
        fs.writeFileSync(path.join(tdir, 'timeline.md'), tlMd);
      } catch {}
    }
  }
}
