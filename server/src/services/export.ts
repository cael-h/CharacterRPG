import fs from 'fs';
import path from 'path';
import { db } from '../db.js';
import { config } from '../config.js';
import { profileDirFor } from './paths.js';
import type { CharacterIdNameRow } from '../types.js';

function slugify(name: string) {
  return String(name || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'character';
}

function ensureDir(p: string) { try { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); } catch {} }

function copyTree(srcDir: string, dstDir: string) {
  ensureDir(dstDir);
  if (!fs.existsSync(srcDir)) return;
  for (const e of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const s = path.join(srcDir, e.name);
    const d = path.join(dstDir, e.name);
    try {
      if (e.isDirectory()) copyTree(s, d);
      else fs.copyFileSync(s, d);
    } catch {}
  }
}

export function exportToDropin(characterId: string) {
  const dropRoot = config.dirs.profilesDropin;
  ensureDir(dropRoot);
  // Resolve character
  const row = db.prepare('SELECT id, name FROM characters WHERE id=?').get(characterId) as CharacterIdNameRow | undefined;
  if (!row) throw new Error('not_found');
  const name = row.name as string;
  const baseName = name || 'Character';
  const baseSlug = slugify(baseName);
  // Choose target folder, avoid overwrite by suffixing -2, -3, ...
  let targetName = baseSlug;
  let candidate = path.join(dropRoot, targetName);
  let i = 2;
  while (fs.existsSync(candidate)) {
    targetName = `${baseSlug}-${i++}`;
    candidate = path.join(dropRoot, targetName);
  }
  const targetDir = candidate;
  // Copy from canonical runtime bundle
  const srcBundle = profileDirFor(row.id, baseName);
  copyTree(srcBundle, targetDir);
  // Ensure the profile.md title line reflects the unsuffixed character name
  try {
    const prof = path.join(targetDir, 'profile.md');
    if (fs.existsSync(prof)) {
      const txt = fs.readFileSync(prof, 'utf-8');
      const out = txt.replace(/^#\s+.*?—\s+Base Profile.*$/m, `# ${baseName} — Base Profile`);
      fs.writeFileSync(prof, out);
    }
  } catch {}
  return { targetDir, targetName };
}
