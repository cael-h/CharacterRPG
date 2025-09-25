import fs from 'fs';
import path from 'path';
import { profileDirFor } from './paths.js';
import { config } from '../config.js';

function ensureDir(p: string) { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); }

export function docsDirFor(characterId: string) {
  const root = profileDirFor(characterId);
  const dir = path.join(root, 'docs');
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
