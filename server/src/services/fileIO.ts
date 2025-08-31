import fs from 'fs';
import path from 'path';

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
}

export function addTimelineEvent(ownerId: string | 'global', title: string, summary: string) {
  const dir = process.env.TIMELINES_DIR || 'timelines';
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const file = ownerId === 'global' ? 'global.md' : `${ownerId}.md`;
  const p = path.join(dir, file);
  const line = `- [${new Date().toISOString()}] ${title} — ${summary}`;
  fs.appendFileSync(p, line + '\n');
}

