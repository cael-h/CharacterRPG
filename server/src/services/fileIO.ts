import fs from 'fs';
import path from 'path';
import { db } from '../db.js';

export function appendTranscript(sessionId: string, line: string) {
  const dir = process.env.TRANSCRIPTS_DIR || 'transcripts';
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, `${sessionId}.md`);
  fs.appendFileSync(p, line + '\n');
}

export function writeCharacterMemory(characterId: string, text: string) {
  const dir = process.env.MEMORIES_DIR || 'memories';
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, `${characterId}.md`);
  fs.appendFileSync(p, text + '\n');
  // Mirror into profiles/<id>/memories/memories.md if enabled
  if (String(process.env.SYNC_CHARACTER_BUNDLES ?? 'true').toLowerCase() !== 'false') {
    try {
      const row = db.prepare('SELECT id FROM characters WHERE name=?').get(characterId);
      if (row?.id) {
        const base = process.env.PROFILES_DIR || 'profiles';
        const mdir = path.join(base, row.id, 'memories');
        if (!fs.existsSync(mdir)) fs.mkdirSync(mdir, { recursive: true });
        fs.appendFileSync(path.join(mdir, 'memories.md'), text + '\n');
      }
    } catch {}
  }
}

export function addTimelineEvent(ownerId: string | 'global', title: string, summary: string) {
  const dir = process.env.TIMELINES_DIR || 'timelines';
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const file = ownerId === 'global' ? 'global.md' : `${ownerId}.md`;
  const p = path.join(dir, file);
  const line = `- [${new Date().toISOString()}] ${title} — ${summary}`;
  fs.appendFileSync(p, line + '\n');
  // Mirror into profiles/<id>/timeline/timeline.md for character timelines
  if (ownerId !== 'global' && String(process.env.SYNC_CHARACTER_BUNDLES ?? 'true').toLowerCase() !== 'false') {
    try {
      const row = db.prepare('SELECT id FROM characters WHERE name=?').get(ownerId);
      if (row?.id) {
        const base = process.env.PROFILES_DIR || 'profiles';
        const tdir = path.join(base, row.id, 'timeline');
        if (!fs.existsSync(tdir)) fs.mkdirSync(tdir, { recursive: true });
        fs.appendFileSync(path.join(tdir, 'timeline.md'), line + '\n');
      }
    } catch {}
  }
}

export function writeCharacterProfileBundle(characterId: string, opts: {
  name: string;
  system_prompt: string;
  avatar_uri?: string | null;
  profile_uri?: string | null;
  age?: number | null;
  birth_year?: number | null;
}) {
  const dir = process.env.PROFILES_DIR || 'profiles';
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const folder = path.join(dir, characterId);
  if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });

  const profilePath = path.join(folder, 'profile.md');
  const lines: string[] = [];
  lines.push(`# ${opts.name} — Base Profile`);
  lines.push('');
  if (opts.age != null) lines.push(`- Age: ${opts.age}`);
  if (opts.birth_year != null) lines.push(`- Birth Year: ${opts.birth_year}`);
  if (opts.avatar_uri) lines.push(`- Avatar: ${opts.avatar_uri}`);
  if (opts.profile_uri) lines.push(`- Source: ${opts.profile_uri}`);
  lines.push('');
  lines.push('## System Prompt');
  lines.push('');
  lines.push(opts.system_prompt || '');
  lines.push('');
  // Snapshot a copy of the per-character timeline into the bundle if present
  try {
    const tdir = process.env.TIMELINES_DIR || 'timelines';
    const tpath = path.join(tdir, `${opts.name}.md`);
    if (fs.existsSync(tpath)) {
      const tcopy = path.join(folder, 'timeline.md');
      fs.copyFileSync(tpath, tcopy);
      lines.push('## Core Timeline (snapshot)');
      lines.push('See timeline.md in this folder.');
      lines.push('');
    }
  } catch {}

  fs.writeFileSync(profilePath, lines.join('\n'));
  return { profilePath };
}
