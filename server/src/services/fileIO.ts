import fs from 'fs';
import path from 'path';
import { db } from '../db.js';
import { profileDirFor, storyTimelinePath, transcriptPathFor } from './paths.js';
import { config } from '../config.js';
import type { IdRow } from '../types.js';

export function appendTranscript(sessionId: string, line: string) {
  const p = transcriptPathFor(sessionId);
  fs.appendFileSync(p, line + '\n');
}

export function writeCharacterMemory(characterId: string, text: string) {
  const dir = config.dirs.memories;
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, `${characterId}.md`);
  fs.appendFileSync(p, text + '\n');
  // Mirror into profiles/<id>/memories/memories.md if enabled
  if (config.flags.syncCharacterBundles) {
    try {
      const row = db.prepare('SELECT id FROM characters WHERE name=?').get(characterId) as IdRow | undefined;
      if (row?.id) {
        const base = config.dirs.profiles;
        const mdir = path.join(base, row.id, 'memories');
        if (!fs.existsSync(mdir)) fs.mkdirSync(mdir, { recursive: true });
        fs.appendFileSync(path.join(mdir, 'memories.md'), text + '\n');
      }
    } catch {}
  }
}

export function addTimelineEvent(ownerId: string | 'global', title: string, summary: string) {
  const dir = config.dirs.timelines;
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const file = ownerId === 'global' ? 'global.md' : `${ownerId}.md`;
  const p = path.join(dir, file);
  const line = `- [${new Date().toISOString()}] ${title} — ${summary}`;
  fs.appendFileSync(p, line + '\n');
  // Mirror into profiles/<id>/timeline/timeline.md for character timelines
  if (ownerId !== 'global' && config.flags.syncCharacterBundles) {
    try {
      const row = db.prepare('SELECT id FROM characters WHERE name=?').get(ownerId) as IdRow | undefined;
      if (row?.id) {
        const base = config.dirs.profiles;
        const tdir = path.join(base, row.id, 'timeline');
        if (!fs.existsSync(tdir)) fs.mkdirSync(tdir, { recursive: true });
        fs.appendFileSync(path.join(tdir, 'timeline.md'), line + '\n');
      }
    } catch {}
  }
}

export function addStoryTimelineEvent(storyId: string, title: string, summary: string, occurredAtIso?: string) {
  const p = storyTimelinePath(storyId);
  const line = `- [${occurredAtIso || new Date().toISOString()}] ${title} — ${summary}`;
  fs.appendFileSync(p, line + '\n');
}

export function writeCharacterProfileBundle(characterId: string, opts: {
  name: string;
  system_prompt: string;
  avatar_uri?: string | null;
  profile_uri?: string | null;
  age?: number | null;
  birth_year?: number | null;
}) {
  const folder = profileDirFor(characterId, opts.name);

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
    const tdir = config.dirs.timelines;
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
  // Ensure prompt folder exists and seed with current system + generic default if available
  try {
    const pdir = path.join(folder, 'prompt');
    if (!fs.existsSync(pdir)) fs.mkdirSync(pdir, { recursive: true });
    // Persist current system prompt snapshot
    fs.writeFileSync(path.join(pdir, 'system.md'), opts.system_prompt || '');

    // Preferred defaults from profiles/Default
    const defaultsDir = path.join(config.dirs.profilesDropin, 'Default');

    const genericPath = path.join(pdir, 'generic.md');
    if (!fs.existsSync(genericPath)) {
      const defaultGeneric = path.join(defaultsDir, 'generic.md');
      const legacyDocs = path.join('docs', 'General_Default_Char_Prompt_v3.md');
      if (fs.existsSync(defaultGeneric)) fs.copyFileSync(defaultGeneric, genericPath);
      else if (fs.existsSync(legacyDocs)) fs.copyFileSync(legacyDocs, genericPath);
      else fs.writeFileSync(genericPath, '# Generic Prompt (add profiles/Default/generic.md)\n');
    }

    const shortPath = path.join(pdir, 'short.md');
    if (!fs.existsSync(shortPath)) {
      const defaultShort = path.join(defaultsDir, 'short.md');
      if (fs.existsSync(defaultShort)) fs.copyFileSync(defaultShort, shortPath);
      else fs.writeFileSync(shortPath, `# Short Prompt for ${opts.name}\n`);
    }

    const reviewerPath = path.join(pdir, 'reviewer.md');
    if (!fs.existsSync(reviewerPath)) {
      const defaultReviewer = path.join(defaultsDir, 'reviewer.md');
      const legacyReviewer = path.join('docs', 'Reviewer_Default_Prompt.md');
      if (fs.existsSync(defaultReviewer)) fs.copyFileSync(defaultReviewer, reviewerPath);
      else if (fs.existsSync(legacyReviewer)) fs.copyFileSync(legacyReviewer, reviewerPath);
      else fs.writeFileSync(reviewerPath, '# Reviewer Prompt (add profiles/Default/reviewer.md)\n');
    }
  } catch {}
  return { profilePath };
}
