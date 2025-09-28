import fs from 'fs';
import path from 'path';
<<<<<<< HEAD
import { profileDirFor } from './paths.js';
import { config } from '../config.js';
=======
>>>>>>> 6592229df14f2c8e73dc251dab1748a39fb567a2

function ensureDir(p: string) { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); }

export function docsDirFor(characterId: string) {
<<<<<<< HEAD
  const root = profileDirFor(characterId);
  const dir = path.join(root, 'docs');
=======
  const base = process.env.PROFILES_DIR || 'profiles';
  const dir = path.join(base, characterId, 'docs');
>>>>>>> 6592229df14f2c8e73dc251dab1748a39fb567a2
  ensureDir(dir);
  return dir;
}

export function listDocs(characterId: string) {
  const dir = docsDirFor(characterId);
  const files = fs.readdirSync(dir);
  return files.map(f => {
    const p = path.join(dir, f);
    const st = fs.statSync(p);
    return { name: f, size: st.size, mtimeMs: st.mtimeMs };
  });
}

export function deleteDoc(characterId: string, filename: string) {
  const dir = docsDirFor(characterId);
  const p = path.join(dir, filename);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

export function pathForDoc(characterId: string, filename: string) {
  const dir = docsDirFor(characterId);
  return path.join(dir, filename);
}
<<<<<<< HEAD
=======

>>>>>>> 6592229df14f2c8e73dc251dab1748a39fb567a2
