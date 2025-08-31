import fs from 'fs';
import path from 'path';

type Entry = {
  ts: number;
  sessionId: string;
  model: string;
  role: 'player'|'npc';
  textLen: number;
  approxTokens: number;
};

function approxTokenCount(text: string) {
  // Rough heuristic: ~4 chars/token average
  return Math.max(1, Math.round(text.length / 4));
}

export function recordUsage(sessionId: string, model: string, role: 'player'|'npc', text: string) {
  const dir = process.env.USAGE_DIR || 'usage';
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, `${sessionId}.jsonl`);
  const entry: Entry = { ts: Date.now(), sessionId, model, role, textLen: text.length, approxTokens: approxTokenCount(text) };
  fs.appendFileSync(p, JSON.stringify(entry) + '\n');
}

