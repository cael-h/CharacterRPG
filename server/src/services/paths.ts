import fs from 'fs';
import path from 'path';
import { db } from '../db.js';
import { config } from '../config.js';
import type { CharacterNameRow, StorySummaryRow, StoryLinkRow } from '../types.js';

function ensureDir(p: string) { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); }

function slugify(name: string) {
  return String(name || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'character';
}

export function profileDirFor(characterId: string, name?: string) {
  const base = config.dirs.profiles;
  let nm = name;
  if (!nm) {
    try {
      const row = db.prepare('SELECT name FROM characters WHERE id=?').get(characterId) as CharacterNameRow | undefined;
      nm = row?.name || 'character';
    } catch { nm = 'character'; }
  }
  const slug = slugify(nm!);
  const preferred = path.join(base, `${slug}__${characterId}`);
  if (fs.existsSync(preferred)) return preferred;
  const legacy = path.join(base, characterId);
  // Migrate legacy to preferred if possible; otherwise create preferred
  try {
    if (fs.existsSync(legacy)) {
      try { fs.renameSync(legacy, preferred); } catch { ensureDir(preferred); }
    } else {
      ensureDir(preferred);
    }
  } catch { ensureDir(preferred); }
  return preferred;
}

export function storyDirFor(storyId: string) {
  const base = config.dirs.transcripts;
  // Lookup story name for friendly folder naming
  let name = 'story';
  try {
    const row = db.prepare('SELECT name FROM stories WHERE id=?').get(storyId) as StorySummaryRow | undefined;
    name = row?.name || 'story';
  } catch {}
  const slug = slugify(name);
  const dir = path.join(base, 'stories', `${slug}__${storyId}`);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function transcriptPathFor(sessionId: string) {
  // If the session is linked to a story, and grouping is enabled, nest under story folder.
  if (config.flags.groupTranscriptsByStory !== false) {
    try {
      const row = db
        .prepare('SELECT s.story_id, t.name as story_name FROM session_story s JOIN stories t ON t.id=s.story_id WHERE s.session_id=?')
        .get(sessionId) as StoryLinkRow | undefined;
      if (row?.story_id) {
        const dir = storyDirFor(row.story_id);
        return path.join(dir, `session-${sessionId}.md`);
      }
    } catch {}
  }
  // Fallback to legacy location
  const dir = config.dirs.transcripts;
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${sessionId}.md`);
}

export function storyTimelinePath(storyId: string) {
  const base = config.dirs.timelines;
  let name = 'story';
  try {
    const row = db.prepare('SELECT name FROM stories WHERE id=?').get(storyId) as StorySummaryRow | undefined;
    name = row?.name || 'story';
  } catch {}
  const slug = slugify(name);
  const tdir = path.join(base, 'stories');
  if (!fs.existsSync(tdir)) fs.mkdirSync(tdir, { recursive: true });
  return path.join(tdir, `${slug}__${storyId}.md`);
}
