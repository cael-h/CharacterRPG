import fs from 'fs';
import path from 'path';

export function storiesRootFor(characterId: string) {
  const base = process.env.PROFILES_DIR || 'profiles';
  return path.join(base, characterId, 'stories');
}

export function listStories(characterId: string): string[] {
  const root = storiesRootFor(characterId);
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .sort();
}

export function ensureUniqueStoryName(characterId: string, desired: string): string {
  const root = storiesRootFor(characterId);
  fs.mkdirSync(root, { recursive: true });
  let name = desired || 'story1';
  if (!fs.existsSync(path.join(root, name))) return name;
  // If exists, append -2, -3, etc.
  let i = 2;
  while (fs.existsSync(path.join(root, `${name}-${i}`))) i++;
  return `${name}-${i}`;
}

export function appendSessionToStory(characterId: string, story: string, sessionId: string) {
  const root = storiesRootFor(characterId);
  const dir = path.join(root, story);
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(path.join(dir, 'sessions.txt'), sessionId + '\n');
  const idx = path.join(root, 'index.md');
  const line = `- ${story}: ${sessionId}`;
  fs.appendFileSync(idx, line + '\n');
}

